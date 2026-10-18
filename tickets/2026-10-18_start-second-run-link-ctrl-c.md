Topics: start, dashboard
Issue: [#2141](https://github.com/openagt/openagent/issues/2141)

# `npx @openagt/start`: a second run, the link it prints, and Ctrl+C

## TLDR

Three fixes to the dashboard process `npx @openagt/start` runs:

1. **A second run fails** with `EADDRINUSE` while a dashboard already runs. Wanted: it adds its repo to the running dashboard and opens that project's page.
2. **It prints the id link** (`http://127.0.0.1:4200/gemstack-st99l0`) while the page shows `/gemstack`. Wanted: it prints the address the page shows.
3. **Ctrl+C hangs while a dashboard tab is open** (seen on 0.24.0): one `SIGINT` ran the close hooks, then the port stayed held for over two minutes with two tabs' connections open and the test browser still a child; a second `SIGINT` ended it. Wanted: one Ctrl+C stops it in a few seconds, open tabs or not.

## Why it matters

`npx @openagt/start` is the first thing a new user types; each of these makes it look broken.
