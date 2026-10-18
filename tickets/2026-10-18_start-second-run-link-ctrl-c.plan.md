Effort: 4
Uncertainty: 3

# [Plan] `npx @openagt/start`: a second run, the link it prints, and Ctrl+C

How to fix the three faults of the dashboard process `npx @openagt/start` runs: the second run, the printed link and Ctrl+C.

## Problems

1. **A second run.** `runDaemon` (`packages/openagent/src/daemon.ts`) goes straight to `startDashboard`, and `listenDashboard` (`src/dashboard/server.ts`) rejects with `EADDRINUSE`. `runForegroundDaemonCmd` (`packages/start/src/cli.ts`) then prints `could not start the dashboard (listen EADDRINUSE …)` and exits 1. Nothing tells whether the port belongs to an OpenAgent dashboard, and the running dashboard has no RPC that does what `startedIn` does: find the listed project that holds a folder, or else add the folder.
2. **The printed link.** `onProject` in `cli.ts` builds `${url}/${encodeURIComponent(started.id)}`. The address a page shows comes from `projectAddresses` (`packages/openagent/dashboard/lib/route.ts`). That is the folder name, unless an earlier project in the registry has the same name or a module page uses it as its segment. Then the address is the id. The server knows the registry order. It does not know the page words: modules declare their `pages[].segment` in their browser JS, and only `useModules` reads them, in the browser.
3. **Ctrl+C hangs.** The hang is in the teardown that runs after the close hooks:
   - `connectCdp` (`src/browser-stream.ts`) leaves a pending `send` unsettled when the socket closes: no `close` or `error` listener rejects `pending`. Chrome is spawned without `detached`, so it is in the terminal's process group and gets the same SIGINT. It starts to quit, `cdp.call('Browser.close')` in `startBridgeBrowser`'s `close` never answers, and `await bridgeBrowser.stop()` blocks forever. `runtime.dispose()` and `dashboard.close()` never run, so the port stays held and the tabs' event streams stay open. This fits the report: the close hooks ran, then the test browser was still a child.
   - `bridgeBrowserOwner.stop` first does `await launching`. A launch that is still downloading Chrome or waiting for the debug port (up to 30 s) delays the stop by that long.
   - `waitForShutdown` uses `process.once`. The second SIGINT finds no listener and Node's default handler kills the process. That is why the second Ctrl+C worked.

## Solutions

### 1. A second run joins the running dashboard

- **(recommended)** Keep it out of the daemon's lifecycle. When `startDashboard` rejects with `EADDRINUSE`, `runForegroundDaemonCmd` asks that port whether it is OpenAgent and, if it is, hands it the folder:
  - Add an RPC to the dashboard, e.g. `sendStartedIn(folder)` → `{ id, path, added, address }`. It is the existing `startedIn` from `daemon.ts`, moved into the runtime or `dashboard-rpc/projects.ts` so both paths use it: the listed project holding the folder, else `runtime.onAddProject(path, false)`. The first run calls the same function in-process.
  - The second process POSTs to `http://127.0.0.1:<port>/_rpc/sendStartedIn` with `[folder]`. A request without an `Origin` header already passes `isSameOriginRequest` and `isExpectedHost` (any local process can call `sendAddProject` the same way today), so this adds no new exposure.
  - An answer that is not OpenAgent's (a non-JSON body, a 404, a refused connection) means another program holds the port. Keep the error, worded for that case: `port 4200 is taken by another program; pass --port <n>`.
  - On success it prints `◆ dashboard already running: <url>`, the `project added` and `project:` lines as today, opens the page, and exits 0. There is no "Ctrl+C to stop" line and no footer, because this process serves nothing.
  - Outside a repository there is nothing to hand over: print the running dashboard's address, open the Overview and exit 0.
- Rejected: probing the port before binding. Binding first and catching `EADDRINUSE` avoids a race and costs nothing on the common path.
- Rejected: a state or liveness file. `daemon.ts` says outright that there is none, and the port is the only record needed.

### 2. The printed link is the address the page shows

- **(recommended)** Move `projectAddresses`, `nameOf`, `NO_PROJECTS` and the `overview`/`settings` words from `dashboard/lib/route.ts` into `src/` (the dashboard already imports from `../src`, e.g. `App.tsx`), so the server and the page share one rule. `startedIn` and `sendStartedIn` return `address = projectAddresses(listedIds, []).addressOf(id)`, from the registry read after the add. The CLI prints `${url}/${encodeURIComponent(address)}` and **opens the id link**, as it does now. The id always opens the project and the dashboard writes the address in its place, so the open is right in every case.
- Remaining gap: a folder whose name is a module's page word (e.g. a folder named `logs` in a project with the logs skill). The server cannot see page words, so it prints `/logs` while the page shows the id. This is rare. Closing it needs module pages declared where the server can read them (the module's `package.json`), which is a change to the module format that belongs in a ticket of its own. **A person decides**: accept the gap, or make that manifest change part of this ticket.
- Rejected: projects winning over page words, so the server could compute the address alone. The DECISIONS bullet on addresses says pages win, and that is a person's pick.

### 3. One Ctrl+C stops it in a few seconds

- `connectCdp`: on the socket's `close` and `error`, reject every pending `send` and clear `pending`. A `send` on a socket that is not open rejects at once.
- `startBridgeBrowser`'s `close`: bound `cdp.call('Browser.close')` by `CLOSE_GRACE_MS`, as a race with the grace beat that follows, so a call that gets no answer still reaches `child.kill()`. Also `SIGKILL` if the child has not exited a moment after `child.kill()`.
- `bridgeBrowserOwner.stop`: do not wait for a launch in flight. Abort it (the generation bump already marks it stale; let the launcher see an `AbortSignal` and kill a spawned child), then close whatever came up.
- `runDaemon` teardown: close the dashboard first (`dashboard.close()`: `closeAllConnections` and stop listening). The port is then free and the tabs show the dashboard is gone at once, while package services, background services, close hooks and the bridge browser stop after. Bound the whole teardown with a deadline (e.g. 10 s, `unref`'d timer). When it passes, log which step is still running and resolve anyway.
- `waitForShutdown`: keep listening after the first signal. A second Ctrl+C logs `stopping now` and exits (`process.exit(130)`) instead of relying on the default handler.
- `packages/start/src/bin.ts`: once `runCli` resolves, end with `process.exit(code)`, so a stray handle (an un-`unref`'d child or timer) cannot keep the process alive after the teardown.

## Considerations

- The close hooks may be slow, because they are the project's own lines. Closing the dashboard before them frees the port, but the process lives until they end or the deadline passes. The deadline must not cut a hook short silently: log it.
- A second run with a different OpenAgent version joins whatever runs. The skills it was handed (`handDownSkills`) are not the running one's. It should say which version is running (e.g. from `onDashboard`, if that carries it, or a small `onVersion` RPC) and that a restart picks up the new one. It should not stop the running dashboard.
- `--port 0` (ephemeral) never collides, so it never joins.
- A second run in the same repository adds nothing and only opens the page, the same as `added: false` now.
- The first run's `onProject` arrives after the open hooks of the projects listed before it have been ordered. The second run's RPC answers after `onAddProject`, which runs the new project's open lines. Both are bounded already.
- The start package's DECISIONS has the "typed in a terminal, opens the page" bullet. Joining a running dashboard is a person's pick (this ticket). The implementer adds a bullet and lists it in the pull request.

## Implementation

1. `src/browser-stream.ts`: reject pending sends on `close` and `error`. Test it against a local WebSocket server that closes mid-call.
2. `src/bridge-browser.ts`: bound `Browser.close` in `close`. Make `stop` abort a launch in flight. Extend `bridge-browser.test.ts` with a `call` that never resolves and a launch that never ends: `stop` resolves within the grace period.
3. `src/daemon.ts`: teardown order (dashboard first), the deadline, and a second signal that exits. Add a `daemon.test.ts` case with a `bridgeBrowser` whose `close` hangs: `runDaemon` resolves after `signal` aborts, and the port can be bound again.
4. Share `projectAddresses`: move it to `src/project-address.ts` and import it from `route.ts`. Its tests move with it.
5. Move `startedIn` into the runtime as `startedIn(folder)` → `{ id, path, added, address } | { error }`, exposed as the RPC `sendStartedIn` and called by `runDaemon` for `opts.project`. `onProject` gets `address`.
6. `packages/start/src/cli.ts`: print `${url}/${address}` and open `${url}/${id}`. On `EADDRINUSE`, join: POST `sendStartedIn`, print, open, return 0. If another program holds the port, give the clearer error and return 1. Tests in `cli.test.ts`: a dashboard on an ephemeral port, then a second `runCli(['--port', p])` that returns 0 and prints the project line, plus an HTTP server that is not OpenAgent on the port, which returns 1.
7. `packages/start/src/bin.ts`: `process.exit(code)`.
8. Check by hand on macOS: `npx @openagt/start` in a repository, a second terminal running it again (the page opens and the first terminal shows the add), then Ctrl+C with two tabs and the bridge browser on: the port is free within seconds (`lsof -i :4200`) and no Chrome is left.
