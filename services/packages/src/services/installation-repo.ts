import { and, desc, eq } from 'drizzle-orm';
import { ulid } from 'ulid';
import type { Database } from '../db/connection.js';
import { installations as installationsTable } from '../db/schema/installations.js';
import { versionHistory } from '../db/schema/version-history.js';

/**
 * Persistence boundary for the packages service. Production uses
 * `DrizzleInstallationRepo`; tests use the Map-backed `InMemoryInstallationRepo`
 * — same external contract, no postgres needed in CI.
 *
 * Why a repo and not raw drizzle?: pg-mem's postgres-js adapter doesn't
 * play well with drizzle's query-builder shapes (resolution gaps in
 * `pg.default`, missing `pg-server`). A purpose-built interface gives us
 * deterministic in-process tests for free, and the surface is tiny —
 * 8 methods covering the entire lifecycle.
 */
export interface InstallationRecord {
  id: string;
  workspaceId: string;
  packageName: string;
  version: string;
  type: string;
  status: string;
  config: Record<string, unknown>;
  installedAt: Date;
  updatedAt: Date;
}

export interface InstallationRepo {
  insert(record: InstallationRecord): Promise<void>;
  update(id: string, patch: Partial<Omit<InstallationRecord, 'id'>>): Promise<InstallationRecord | undefined>;
  getById(id: string): Promise<InstallationRecord | undefined>;
  listByWorkspace(workspaceId: string): Promise<InstallationRecord[]>;
  delete(id: string): Promise<boolean>;

  /** Append a row to the version history for `installationId`. */
  appendVersion(installationId: string, version: string): Promise<void>;
  /** Latest history rows ordered newest-first. */
  getHistory(installationId: string): Promise<Array<{ id: string; version: string; recordedAt: Date }>>;
  /** Delete a single history row by id. */
  deleteHistoryRow(historyId: string): Promise<void>;
}

/* ---------- Drizzle-backed implementation (production) ---------- */

export class DrizzleInstallationRepo implements InstallationRepo {
  constructor(private db: Database) {}

  async insert(r: InstallationRecord): Promise<void> {
    await this.db.insert(installationsTable).values({
      id: r.id,
      workspaceId: r.workspaceId,
      packageName: r.packageName,
      version: r.version,
      type: r.type,
      status: r.status,
      config: r.config,
      installedAt: r.installedAt,
      updatedAt: r.updatedAt,
    });
  }

  async update(id: string, patch: Partial<Omit<InstallationRecord, 'id'>>): Promise<InstallationRecord | undefined> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.workspaceId !== undefined) set.workspaceId = patch.workspaceId;
    if (patch.packageName !== undefined) set.packageName = patch.packageName;
    if (patch.version !== undefined) set.version = patch.version;
    if (patch.type !== undefined) set.type = patch.type;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.config !== undefined) set.config = patch.config;

    const [row] = await this.db
      .update(installationsTable)
      .set(set)
      .where(eq(installationsTable.id, id))
      .returning();
    return row ? rowToRecord(row) : undefined;
  }

  async getById(id: string): Promise<InstallationRecord | undefined> {
    const [row] = await this.db.select().from(installationsTable).where(eq(installationsTable.id, id));
    return row ? rowToRecord(row) : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<InstallationRecord[]> {
    const rows = await this.db.select().from(installationsTable).where(eq(installationsTable.workspaceId, workspaceId));
    return rows.map(rowToRecord);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db
      .delete(installationsTable)
      .where(eq(installationsTable.id, id))
      .returning({ id: installationsTable.id });
    return rows.length > 0;
  }

  async appendVersion(installationId: string, version: string): Promise<void> {
    await this.db.insert(versionHistory).values({
      id: ulid(),
      installationId,
      version,
      recordedAt: new Date(),
    });
  }

  async getHistory(installationId: string): Promise<Array<{ id: string; version: string; recordedAt: Date }>> {
    const rows = await this.db
      .select()
      .from(versionHistory)
      .where(eq(versionHistory.installationId, installationId))
      .orderBy(desc(versionHistory.recordedAt));
    return rows.map((r) => ({ id: r.id, version: r.version, recordedAt: r.recordedAt }));
  }

  async deleteHistoryRow(historyId: string): Promise<void> {
    await this.db.delete(versionHistory).where(and(eq(versionHistory.id, historyId)));
  }
}

function rowToRecord(row: {
  id: string;
  workspaceId: string;
  packageName: string;
  version: string;
  type: string;
  status: string;
  config: unknown;
  installedAt: Date;
  updatedAt: Date;
}): InstallationRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    packageName: row.packageName,
    version: row.version,
    type: row.type,
    status: row.status,
    config: (row.config as Record<string, unknown>) ?? {},
    installedAt: row.installedAt,
    updatedAt: row.updatedAt,
  };
}

/* ---------- In-memory implementation (tests) ---------- */

export class InMemoryInstallationRepo implements InstallationRepo {
  private installs = new Map<string, InstallationRecord>();
  // Append-only stack per installation; newest entries appended at the end.
  private history = new Map<string, Array<{ id: string; version: string; recordedAt: Date }>>();

  async insert(r: InstallationRecord): Promise<void> {
    this.installs.set(r.id, { ...r, config: { ...r.config } });
  }

  async update(id: string, patch: Partial<Omit<InstallationRecord, 'id'>>): Promise<InstallationRecord | undefined> {
    const existing = this.installs.get(id);
    if (!existing) return undefined;
    const merged = { ...existing, ...patch, updatedAt: new Date() };
    this.installs.set(id, merged);
    return merged;
  }

  async getById(id: string): Promise<InstallationRecord | undefined> {
    const row = this.installs.get(id);
    return row ? { ...row } : undefined;
  }

  async listByWorkspace(workspaceId: string): Promise<InstallationRecord[]> {
    return Array.from(this.installs.values())
      .filter((r) => r.workspaceId === workspaceId)
      .map((r) => ({ ...r }));
  }

  async delete(id: string): Promise<boolean> {
    const had = this.installs.delete(id);
    this.history.delete(id);
    return had;
  }

  async appendVersion(installationId: string, version: string): Promise<void> {
    const list = this.history.get(installationId) ?? [];
    // Bump the timestamp by 1ms per append so the newest-first ordering is
    // stable even when several appends land within the same millisecond.
    const recordedAt = new Date(Date.now() + list.length);
    list.push({ id: ulid(), version, recordedAt });
    this.history.set(installationId, list);
  }

  async getHistory(installationId: string): Promise<Array<{ id: string; version: string; recordedAt: Date }>> {
    return [...(this.history.get(installationId) ?? [])].reverse();
  }

  async deleteHistoryRow(historyId: string): Promise<void> {
    for (const [installationId, list] of this.history) {
      const idx = list.findIndex((r) => r.id === historyId);
      if (idx !== -1) {
        list.splice(idx, 1);
        if (list.length === 0) this.history.delete(installationId);
        return;
      }
    }
  }
}
