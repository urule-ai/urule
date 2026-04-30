#!/usr/bin/env bash
# Runs `npm run typecheck` and `npm test` across the urule-repos workspace —
# both the monorepo packages/services and the standalone GitHub repos.
# No Docker, no external services.
#
# Exits 0 if every testable repo passes both gates, non-zero otherwise.
#
# Skips apps/office-ui (no test script — see ROADMAP §2.3).
#
# Special ordering: packages/auth-middleware runs FIRST with its full deps
# (fastify + @fastify/jwt) in place so its own typecheck/tests pass. After
# that completes, we call `npm run clean:peers` to strip the nested fastify
# install — leaving it there causes every consumer to fail typecheck with a
# TypeProvider/DecorationMethod mismatch (see ROADMAP §2.5).
#
# If you re-run `npm install` inside packages/auth-middleware, the nested
# fastify comes back and you must re-run this script to re-clean it.
#
# Usage:
#   bash scripts/test-all.sh

set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# auth-middleware first so we can clean its nested peers before consumers typecheck.
# Paths are relative to the urule-repos workspace root.
REPOS=(
  urule/packages/auth-middleware
  urule/packages/spec
  urule/packages/events
  urule/packages/authz
  urule/services/registry
  urule/services/state
  urule/services/packages
  urule/services/packagehub
  urule/services/governance
  urule/plugins/backstage
  orchestrator-contract
  widget-sdk
  langgraph-adapter
  runtime-broker
  mcp-gateway
  approvals
  channel-router
  goose-adapter
)

SKIPPED=(
  "urule/apps/office-ui (no test script — see ROADMAP §2.3)"
)

g=$'\033[0;32m'; r=$'\033[0;31m'; y=$'\033[0;33m'; b=$'\033[1m'; n=$'\033[0m'

fail_list=()
pass_count=0
total_tests=0

for repo in "${REPOS[@]}"; do
  dir="$ROOT/$repo"
  if [ ! -f "$dir/package.json" ]; then
    printf "  %s⚠%s  %-45s missing package.json\n" "$y" "$n" "$repo"
    fail_list+=("$repo (missing)")
    continue
  fi

  # Before auth-middleware's own checks, ensure fastify is present
  # (a prior run's clean:peers may have removed it)
  if [[ "$repo" == *auth-middleware ]] && [ ! -d "$dir/node_modules/fastify" ]; then
    (cd "$dir" && npm install --silent >/dev/null 2>&1) || true
  fi

  # Clear stale tsbuildinfo — prevents cross-session false negatives
  rm -f "$dir/tsconfig.tsbuildinfo"

  tc_out=$(cd "$dir" && npm run typecheck --silent 2>&1)
  tc_ec=$?

  test_out=""
  test_ec=0
  if [ $tc_ec -eq 0 ]; then
    test_out=$(cd "$dir" && npm test --silent 2>&1)
    test_ec=$?
  fi

  # Clean auth-middleware's nested peers right after it runs
  if [[ "$repo" == *auth-middleware ]] && [ $tc_ec -eq 0 ] && [ $test_ec -eq 0 ]; then
    (cd "$dir" && npm run clean:peers --silent >/dev/null 2>&1) || true
  fi

  summary=$(printf '%s\n' "$test_out" | grep -E '^\s*Tests\s' | tail -1 | sed -E 's/^\s*//')

  if [ $tc_ec -eq 0 ] && [ $test_ec -eq 0 ]; then
    pc=$(printf '%s\n' "$summary" | grep -oE '[0-9]+ passed' | head -1 | grep -oE '[0-9]+')
    total_tests=$(( total_tests + ${pc:-0} ))
    printf "  %s✓%s  %-45s %s\n" "$g" "$n" "$repo" "$summary"
    pass_count=$(( pass_count + 1 ))
  elif [ $tc_ec -ne 0 ]; then
    first_err=$(printf '%s\n' "$tc_out" | grep -E 'error TS|\.ts\(' | head -1 | sed -E 's/^\s*//')
    printf "  %s✗%s  %-45s typecheck: %s\n" "$r" "$n" "$repo" "${first_err:-(failed)}"
    fail_list+=("$repo (typecheck)")
  else
    first_err=$(printf '%s\n' "$test_out" | grep -E 'Error|FAIL' | head -1 | sed -E 's/^\s*//')
    printf "  %s✗%s  %-45s test: %s\n" "$r" "$n" "$repo" "${first_err:-(failed)}"
    fail_list+=("$repo (test)")
  fi
done

echo
echo "${b}Summary${n}"
echo "  Passed:  $pass_count / ${#REPOS[@]} repos, $total_tests tests total"
if [ ${#fail_list[@]} -gt 0 ]; then
  echo "  ${r}Failed${n}:  ${#fail_list[@]}"
  for f in "${fail_list[@]}"; do echo "    - $f"; done
fi
if [ ${#SKIPPED[@]} -gt 0 ]; then
  echo "  ${y}Skipped${n}:"
  for s in "${SKIPPED[@]}"; do echo "    - $s"; done
fi

[ ${#fail_list[@]} -eq 0 ]
