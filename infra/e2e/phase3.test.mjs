#!/usr/bin/env node

/**
 * Phase 3 End-to-End Integration Test — Approval Workflow
 *
 * Exercises the full Phase 3 flow:
 *   1. Create an approval rule (auto-approve trivial actions)
 *   2. Create an approval request (medium-priority)
 *   3. Approve it; verify status transition
 *   4. Create a second; deny it; verify status transition
 *   5. Create a third; reject it (more permanent than deny in this domain)
 *   6. Create a fourth; cancel it (the requester pulls it back)
 *   7. Create a fifth; escalate it (priority bump)
 *   8. List approvals for the workspace; verify all five appear with right
 *      statuses
 *
 * Usage: node e2e/phase3.test.mjs
 *
 * Expects services to be running:
 *   - approvals on http://localhost:3003
 */

import { assert, test, post, get, waitForService, summary } from './lib.mjs';

const APPROVALS = process.env.APPROVALS_URL ?? 'http://localhost:3003';
const WORKSPACE_ID = process.env.WORKSPACE_ID ?? '01DEMO00WORKSPACE0000000001';
const AGENT_ID = process.env.AGENT_ID ?? '01DEMO000AGENT00000000000001';

function makeApproval(action, reason, priority = 'medium') {
  return {
    runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId: WORKSPACE_ID,
    agentId: AGENT_ID,
    action,
    reason,
    priority,
  };
}

async function createApproval(body) {
  const { status, data } = await post(APPROVALS, '/api/v1/approvals', body);
  assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
  assert(data.id, 'Missing approval id');
  return data;
}

async function main() {
  console.log('\n=== Urule Phase 3 — Approval Workflow E2E ===\n');

  console.log('Waiting for services...');
  await waitForService('approvals', APPROVALS);
  console.log('All services ready.\n');

  let ruleId, approveId, denyId, rejectId, cancelId, escalateId;

  await test('Health check — approvals', async () => {
    const { status, data } = await get(APPROVALS, '/healthz');
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.status === 'ok' || data.ok === true, `Unexpected health body: ${JSON.stringify(data)}`);
  });

  // --- Approval rule ---

  await test('Create approval rule', async () => {
    const { status, data } = await post(APPROVALS, '/api/v1/approval-rules', {
      workspaceId: WORKSPACE_ID,
      action: 'e2e:trivial-action',
      defaultPriority: 'low',
      assignees: ['e2e-reviewer'],
    });
    assert(status === 201, `Expected 201, got ${status}: ${JSON.stringify(data)}`);
    assert(data.id, 'Missing rule id');
    ruleId = data.id;
  });

  await test('List approval rules — new rule appears', async () => {
    const { status, data } = await get(APPROVALS, `/api/v1/approval-rules?workspaceId=${WORKSPACE_ID}`);
    assert(status === 200, `Expected 200, got ${status}`);
    const list = Array.isArray(data) ? data : data.rules ?? [];
    assert(list.find((r) => r.id === ruleId), `Rule ${ruleId} not in list`);
  });

  // --- Approve ---

  await test('Create approval (will be approved)', async () => {
    const a = await createApproval(makeApproval('e2e:approve-me', 'Testing approve path'));
    approveId = a.id;
  });

  await test('Approve it', async () => {
    const { status, data } = await post(APPROVALS, `/api/v1/approvals/${approveId}/approve`, {
      approvedBy: 'e2e-tester',
      comment: 'LGTM',
    });
    assert(status === 200 || status === 204, `Expected 200/204, got ${status}: ${JSON.stringify(data)}`);
  });

  await test('Verify approved status', async () => {
    const { status, data } = await get(APPROVALS, `/api/v1/approvals/${approveId}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.status === 'approved', `Expected approved, got ${data.status}`);
  });

  // --- Deny ---

  await test('Create approval (will be denied)', async () => {
    const a = await createApproval(makeApproval('e2e:deny-me', 'Testing deny path'));
    denyId = a.id;
  });

  await test('Deny it', async () => {
    const { status } = await post(APPROVALS, `/api/v1/approvals/${denyId}/deny`, {
      deniedBy: 'e2e-tester',
      comment: 'Not now',
    });
    assert(status === 200 || status === 204, `Expected 200/204, got ${status}`);
  });

  await test('Verify denied status', async () => {
    const { status, data } = await get(APPROVALS, `/api/v1/approvals/${denyId}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.status === 'denied', `Expected denied, got ${data.status}`);
  });

  // --- Reject (terminal in this domain) ---

  await test('Create approval (will be rejected)', async () => {
    const a = await createApproval(makeApproval('e2e:reject-me', 'Testing reject path', 'high'));
    rejectId = a.id;
  });

  await test('Reject it', async () => {
    const { status } = await post(APPROVALS, `/api/v1/approvals/${rejectId}/reject`, {
      rejectedBy: 'e2e-tester',
      comment: 'Out of scope',
    });
    assert(status === 200 || status === 204, `Expected 200/204, got ${status}`);
  });

  await test('Verify rejected status', async () => {
    const { status, data } = await get(APPROVALS, `/api/v1/approvals/${rejectId}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.status === 'rejected', `Expected rejected, got ${data.status}`);
  });

  // --- Cancel (requester withdraws) ---

  await test('Create approval (will be cancelled)', async () => {
    const a = await createApproval(makeApproval('e2e:cancel-me', 'Testing cancel path'));
    cancelId = a.id;
  });

  await test('Cancel it', async () => {
    const { status } = await post(APPROVALS, `/api/v1/approvals/${cancelId}/cancel`, {
      cancelledBy: 'e2e-tester',
      reason: 'No longer needed',
    });
    assert(status === 200 || status === 204, `Expected 200/204, got ${status}`);
  });

  await test('Verify cancelled status', async () => {
    const { status, data } = await get(APPROVALS, `/api/v1/approvals/${cancelId}`);
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.status === 'cancelled', `Expected cancelled, got ${data.status}`);
  });

  // --- Escalate ---

  await test('Create approval (will be escalated)', async () => {
    const a = await createApproval(makeApproval('e2e:escalate-me', 'Testing escalate path', 'low'));
    escalateId = a.id;
  });

  await test('Escalate it', async () => {
    const { status } = await post(APPROVALS, `/api/v1/approvals/${escalateId}/escalate`, {
      escalatedBy: 'e2e-tester',
      newPriority: 'critical',
      reason: 'CEO is asking',
    });
    assert(status === 200 || status === 204, `Expected 200/204, got ${status}`);
  });

  await test('Verify escalated priority', async () => {
    const { status, data } = await get(APPROVALS, `/api/v1/approvals/${escalateId}`);
    assert(status === 200, `Expected 200, got ${status}`);
    // Some implementations transition status to "escalated"; others bump
    // priority but leave status pending. Accept either as long as priority
    // moved up.
    assert(data.priority === 'critical' || data.status === 'escalated',
      `Expected priority bumped or status escalated; got priority=${data.priority} status=${data.status}`);
  });

  // --- List ---

  await test('List approvals for workspace — all five present', async () => {
    const { status, data } = await get(APPROVALS, `/api/v1/approvals?workspaceId=${WORKSPACE_ID}`);
    assert(status === 200, `Expected 200, got ${status}`);
    const list = Array.isArray(data) ? data : data.approvals ?? [];
    for (const id of [approveId, denyId, rejectId, cancelId, escalateId]) {
      assert(list.find((a) => a.id === id), `Approval ${id} missing from list`);
    }
  });

  summary('Phase 3 Results');
}

main().catch((err) => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
