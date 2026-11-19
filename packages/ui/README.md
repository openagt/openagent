# @openagt/ui

OpenAgent's shell (#2394): the dashboard's pages, the server that serves them, and the
`openagent` command, which a distribution runs with the modules it lists. It has no modules of
its own: [`@openagt/dashboard`](../dashboard/README.md) is OpenAgent as it ships, and the demo
(`pnpm demo`, [`src/e2e/README.md`](./src/e2e/README.md)) is a distribution whose runs are
scripted.

```ts
import { runCli } from '@openagt/ui/cli'

// A distribution's `openagent`: the dashboard, serving the modules its file lists.
process.exit(await runCli(process.argv.slice(2), { distribution: '/path/to/distribution.js' }))
```

The distribution's file is handed down to every process the dashboard starts
(`OPENAGENT_DISTRIBUTION`), a run's own among them. Its package is the one OpenAgent is installed
as: the version the dashboard says, and checks npm for, is that package's.

## Layout

- `src/` — the CLI, the daemon, the reading of a project's runs, and the server side of the
  dashboard. Node only.
- `dashboard/` — the browser app: a Vite SPA the daemon serves as static files, talking back over
  plain HTTP. See [its README](./dashboard/README.md).
- `dashboard/module/` — what the dashboard offers a module's browser part
  (`@openagt/ui/module`); `src/module-server.d.ts`, what it offers a module's server part
  (`@openagt/ui/module-server`).

## Status

Pre-release. There are no users to keep compatible, so the code prefers being clean over being
backward-compatible.
