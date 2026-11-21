Topics: servers, install, node, ci
Issue: [#2367](https://github.com/openagt/openagent/issues/2367)
Waiting: a person whose GitHub token has the `workflow` scope to push local branch `agent-2026-11-14T00-44-44-614Z` (commit b20be8d29, steps 1-3 of the plan, on top of main) and open its pull request; the agents' token cannot push changes under `.github/workflows/`

# Servers on Node 26

## TLDR

Node 26 is the LTS since 2026-10-28; servers get Node 24 (`NODE_LINE` in `packages/dashboard-devices/src/servers/steps.ts`). Before moving: run CI on Node 26 too (`.github/workflows/ci.yml` tests on 22 only), try one server on 26, then set `NODE_LINE = 26` so the next update brings it to every server.

## Why it matters

OpenAgent has never run on Node 26: CI tests on 22 and servers run 24. No rush: Node 24 gets security releases until April 2028.

From #2364.
