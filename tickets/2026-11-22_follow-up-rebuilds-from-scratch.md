Topics: git-branches, checkouts, sessions
Issue: [#2416](https://github.com/openagt/openagent/issues/2416)

# A follow-up to a finished session rebuilds from scratch

## TLDR

A run that ends done, stopped or failed removes its checkout once everything in it is committed (the "reclaim the checkout" step in `packages/git-branches/src/module.ts`). A follow-up message then gets a new checkout on the same branch (`keptCheckout`), with `node_modules` linked but no build output, so the agent builds again: in this repo, 9 s to resume and 40 s to rebuild. Suggested fix (A): the run-end step stops removing the checkout, and the sweep (`packages/agent-driver/core/src/engine/sweep.ts`) removes it once the run ended more than a set time ago (e.g. 24 h). The "only committed work may go" rule stays. Update the reclaim section of `packages/git-branches/DECISIONS.md`, which says the checkout goes at the run's end.

## Why it matters

Every follow-up to a finished session in a project with a build step costs tens of seconds. A run that ends waiting already keeps its checkout, and its answer resumes in place.

## Options

- **A. Keep the checkout for a while (suggested).** Cost: disk (about 300 MB per kept checkout in this repo), and the branch can't be checked out anywhere else while its checkout is kept. Small: two files and their tests.
- **B. Give a new checkout the build output**, copied or linked from the main checkout as `node_modules` is. It would help a session's first run too. But OpenAgent would have to learn what "build output" means in each project, and the main checkout's build may not match the branch.
- **C. Leave it.**

## Open question for A

When does the checkout go: a fixed time after the run ended (simple, git only), or when its pull request is merged or closed (the branches package knows nothing about pull requests today)?

The issue says: not started, parked for later.
