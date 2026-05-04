#!/usr/bin/env node
// Test orchestrator: runs phase{1..4}.test.mjs in series. Honors PHASE=N to
// scope to a single phase.
import { spawn } from 'node:child_process';

const phases = ['1', '2', '3', '4'];
const target = process.env.PHASE ?? 'all';
const wanted = target === 'all' ? phases : phases.filter((p) => p === target);

if (wanted.length === 0) {
  console.error(`Unknown PHASE=${target}; expected one of: ${phases.join(', ')} or 'all'`);
  process.exit(1);
}

let totalFailed = 0;

for (const phase of wanted) {
  console.log(`\n>>> Running phase ${phase}\n`);
  const code = await new Promise((resolve) => {
    const child = spawn('node', [`phase${phase}.test.mjs`], { stdio: 'inherit' });
    child.on('exit', (c) => resolve(c ?? 1));
  });
  if (code !== 0) totalFailed++;
}

if (totalFailed > 0) {
  console.error(`\n!!! ${totalFailed} phase(s) failed.`);
  process.exit(1);
}
console.log('\n=== All phases passed ===\n');
