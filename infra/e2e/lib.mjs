// Shared helpers for the phase-N E2E tests. Each phase imports these and
// supplies its own `main()` — keeps the test files focused on the flow under
// test rather than re-defining HTTP plumbing five times.

let passed = 0;
let failed = 0;

export function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

export async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    console.log('PASS');
    passed++;
  } catch (err) {
    console.log('FAIL');
    console.error(`    ${err.message}`);
    failed++;
  }
}

export async function post(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

export async function get(base, path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, data: await res.json().catch(() => null) };
}

export async function del(base, path) {
  const res = await fetch(`${base}${path}`, { method: 'DELETE' });
  return {
    status: res.status,
    data: res.status === 204 ? null : await res.json().catch(() => null),
  };
}

export async function patch(base, path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

export async function waitForService(name, url, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${url}/healthz`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${name} not ready at ${url}/healthz after ${maxRetries * 2}s`);
}

export function summary(label) {
  console.log(`\n=== ${label}: ${passed} passed, ${failed} failed, ${passed + failed} total ===\n`);
  if (failed > 0) process.exit(1);
}
