Effort: 2
Uncertainty: 2

# [Plan] Servers on Node 26

How to get servers onto Node 26 safely: CI on 26 first, one server tried by hand, then one constant changed.

## Problems

- OpenAgent has never run on Node 26: CI (`.github/workflows/ci.yml`) and nightly (`.github/workflows/nightly.yml`, `container: node:22`) test on 22 only, and servers run 24 (`NODE_LINE` in `packages/dashboard-devices/src/servers/steps.ts:85`).
- Running the whole CI matrix on two Node lines doubles it (6 jobs to 12) on every pull request.
- The step's test (`packages/dashboard-devices/src/servers/steps.test.ts:116`) writes the line out by hand (`v24.22.1`, `latest-v24.x`, `Node 24.`): changing the line breaks it for no reason.

## Solutions

- CI on 26, as a second axis: `node: [22, 26]` on the `verify` matrix, `node-version: ${{ matrix.node }}`, the job's name carrying the line. 22 stays: it is the floor every `package.json` declares (`"node": ">=22.12.0"`), and laptops may run it. Doubles the runners; jobs run in parallel, so the wait stays the same.
- Cheaper: the typecheck job on 22 only (it does not depend on the runtime), every test job on both. Recommended.
- Cheapest: nightly on `node:26` instead of `node:22`, pull requests unchanged. Hears of a break a day late, and not on the pull request that caused it. Not enough on its own: the point is to know before servers move.

## Considerations

- Moving a server's line is safe in the step as written: the tools step sees `have` (v24.x) differ from `want` (v26.x), replaces `/opt/openagent/node` whole and touches `restart`. That also removes the OpenAgent installed inside it (`node/lib/node_modules/@openagt/dashboard`), and the `openagent` step then finds no version and installs it again, on the new Node. So the move costs each server one reinstall of OpenAgent and one restart, at its next update. Worth seeing on the tried server.
- No native modules to rebuild: the server installs with `--ignore-scripts`, and no package needs a build step. Claude Code and Codex are installed by their own installers into the user's home, not on our Node.
- Node's own breaking changes between 24 and 26 (removed deprecated APIs, stricter defaults) are what CI on 26 is there to find; fix what it shows before the switch, in the same or an earlier pull request.
- Node 24 is supported until April 2028: no rush, and a red CI on 26 can wait for a fix without pressure.
- Arm servers: nodejs.org lists `linux-arm64` for 26 as for 24; the step reads the file name off `SHASUMS256.txt`, nothing to change.
- The `engines` floor (`>=22.12.0`) stays: laptops are not servers, and nothing requires dropping 22.

## Implementation

1. `.github/workflows/ci.yml`: add a Node line to the `verify` matrix, 22 and 26, typecheck on 22 only; `node-version` from the matrix; the line in each job's name. The `build` check needs no change (it waits on `verify` as a whole). Open it as its own pull request and fix what turns red on 26.
2. `.github/workflows/nightly.yml`: `container: node:26`, so the full suite as root runs on the line servers will run. (22 is covered by the pull requests.)
3. `steps.test.ts`: export `NODE_LINE` from `steps.ts` and build the test's versions, URLs and message from it, so the next move is one line.
4. Try one server on 26, by hand: set `NODE_LINE = 26` on a local build, run an update of one server from the dashboard, check that `/opt/openagent/node/bin/node -v` says v26, that OpenAgent was reinstalled and restarted, and that an agent run completes there (Claude Code and Codex, the browser, a person's session).
5. Set `NODE_LINE = 26` in `steps.ts`, in its own pull request once 1-4 are green: the next update brings it to every server.

Steps 1-3 can be one pull request; step 4 needs a person with a server; step 5 waits on it.
