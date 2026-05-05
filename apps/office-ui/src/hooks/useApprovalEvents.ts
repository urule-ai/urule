"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNotificationCenterStore } from "@/store/useNotificationCenterStore";

/*
 * Subscribe to the approvals firehose for a workspace and surface every
 * APPROVAL_REQUESTED / DECIDED / ESCALATED event into:
 *   1. The persisted notification center (deep-link → /office/approvals#:id)
 *   2. React Query — invalidate the ["approvals", ...] keys so any open
 *      approvals page / widget refetches the canonical list.
 *
 * Channel: `${ADAPTER_URL}/api/v1/ws/workspaces/:wsId` — provided by
 * langgraph-adapter's NATS-backed broadcaster (see approval-broadcaster.ts).
 *
 * Auto-reconnect with exponential backoff capped at 30s. The polling-based
 * approvals page keeps working unchanged if the WS never connects, so this
 * hook is purely additive: failure modes degrade silently.
 */

interface ApprovalWsMessage {
  type: "approval";
  topic: string;
  data: {
    approvalId: string;
    workspaceId?: string;
    status?: string;
    priority?: "low" | "medium" | "high" | "critical";
    riskLevel?: "low" | "medium" | "high" | "critical";
    title?: string;
    action?: string;
    decidedBy?: string;
    decision?: string;
  };
}

const TOPIC_REQUESTED = "urule.approvals.approval.requested";
const TOPIC_DECIDED = "urule.approvals.approval.decided";
const TOPIC_ESCALATED = "urule.approvals.approval.escalated";

function adapterWsUrl(workspaceId: string): string {
  const base = process.env["NEXT_PUBLIC_ADAPTER_URL"] ?? "http://localhost:3002";
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/api/v1/ws/workspaces/${encodeURIComponent(workspaceId)}`;
}

export function useApprovalEvents(workspaceId: string = "default"): void {
  const add = useNotificationCenterStore((s) => s.add);
  const queryClient = useQueryClient();
  const reconnectAttempts = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function connect() {
      if (cancelled) return;
      try {
        socket = new WebSocket(adapterWsUrl(workspaceId));
      } catch {
        scheduleReconnect();
        return;
      }

      socket.addEventListener("open", () => {
        reconnectAttempts.current = 0;
      });

      socket.addEventListener("message", (ev) => {
        let msg: ApprovalWsMessage;
        try {
          msg = JSON.parse(String(ev.data)) as ApprovalWsMessage;
        } catch {
          return;
        }
        if (msg?.type !== "approval" || !msg.data?.approvalId) return;

        const { approvalId, title, priority, riskLevel, action, decision, decidedBy } = msg.data;
        const severity = priority ?? riskLevel;

        if (msg.topic === TOPIC_REQUESTED) {
          add({
            kind: severity === "critical" || severity === "high" ? "warning" : "info",
            title: title ?? "New approval requested",
            body: action ? `Action: ${action}` : undefined,
            href: `/office/approvals#${approvalId}`,
            source: "approval",
          });
        } else if (msg.topic === TOPIC_DECIDED) {
          add({
            kind: decision === "approved" ? "success" : decision === "denied" ? "error" : "info",
            title: title ?? "Approval decided",
            body: decidedBy ? `${decision ?? "decided"} by ${decidedBy}` : decision,
            href: `/office/approvals#${approvalId}`,
            source: "approval",
          });
        } else if (msg.topic === TOPIC_ESCALATED) {
          add({
            kind: "warning",
            title: title ?? "Approval escalated",
            body: "Reassigned for review",
            href: `/office/approvals#${approvalId}`,
            source: "approval",
          });
        }

        // Pull the new state into any mounted approvals query.
        queryClient.invalidateQueries({ queryKey: ["approvals"] });
      });

      socket.addEventListener("close", scheduleReconnect);
      socket.addEventListener("error", () => {
        // 'error' is followed by 'close'; let close handle reconnect.
      });
    }

    function scheduleReconnect() {
      if (cancelled) return;
      reconnectAttempts.current += 1;
      const delay = Math.min(30_000, 500 * 2 ** Math.min(reconnectAttempts.current, 6));
      reconnectTimer = setTimeout(connect, delay);
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (socket && socket.readyState <= 1) socket.close();
    };
  }, [workspaceId, add, queryClient]);
}
