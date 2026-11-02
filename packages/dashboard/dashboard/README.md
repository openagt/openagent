# OpenAgent dashboard

OpenAgent's localhost dashboard: **Vite + React + Tailwind v4 + shadcn/ui**, talking to the
daemon over plain HTTP.

This directory used to be a package of its own. It is a directory
now: the boundary bought a public export surface, a bundle-copying build step and a task graph to
sequence it, for a dependency that only ever pointed one way.

It is a **projection of the files each agent's own tool writes** — no daemon process, no
IPC:

- **Reads** — `POST /_rpc/<name>` (`rpc/reads.ts`, `rpc/projects.ts`, …) for agent history, an agent's
  replay, and the surfaced PLAN/TODO docs.
- **Live event stream** — Server-Sent Events at `GET /_rpc/events` (`rpc/events.ts`) tailing
  the selected agent's diary, `<id>.jsonl` in its checkout; each new line becomes one SSE frame.

The `rpc/` modules are typed stubs: each is declared against the implementation's own signature in
`../src/dashboard-rpc/`, so a renamed or re-shaped RPC is a type error here rather than a 404 in
the browser. Nothing from those implementations reaches the bundle — the imports are type-only.

Everything this directory reads out of the package it lives in comes from `../src`, not from
`../dist`. It used to be `../dist`, mechanically, because the merge rewrote a package name into the
path that name resolved to — which left the dashboard depending on the build output of the package
it is part of: `pnpm typecheck` failed on a fresh clone until something had run `tsc`, and editing
`src/` type-checked the browser against the *last* build. Of the ~120 imports, all but the ones from
`src/client.ts` are type-only and reach no bundle at all; `client.ts` is the browser-safe barrel, so
Vite compiles that source directly the way it compiles everything else here. One import still wants
the build, and says so: the `dev:daemon` plugin runs the real daemon in the Vite config's own Node
process, outside any transform pipeline.

There used to be an RPC framework in this seam (Telefunc). It required a build-time transform over
every `.telefunc.ts` file, a registration table pinning each call to the client-baked path of the
shim it was re-exported from, a shim per module to keep those paths stable, and a dev-server plugin
to undo a URL its own client wrote. What it bought was type-safety across a package boundary, which
merging the package removed.

## Run it

```bash
pnpm --filter @openagt/dashboard dev:dashboard
# open http://localhost:4300
```

Populate a project to watch: run `dev:daemon` instead of `dev:dashboard`, which brings a real
daemon up in the dev server's own process, and start an agent from the UI: Start runs the
project's `start` hook line (`.openagent/hooks.yml`), and the dashboard shows the agent from
the files that tool writes. The CLI keeps four options and no verbs; it starts no agent.

## Tests

`vitest` with a jsdom environment, which is why the package runs two test runners: `node --test`
over the compiled `src/`, then `vitest` over this directory. `pnpm --filter @openagt/dashboard test`
runs both.
