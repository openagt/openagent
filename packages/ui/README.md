# @openagt/ui

OpenAgent's shell (#2394): the dashboard's pages, the server that serves them, and the
`openagent` command, which a distribution runs with the modules it lists. It has no modules of
its own: [`@openagt/dashboard`](../dashboard/README.md) is OpenAgent as it ships, and the demo
(`pnpm demo`, [`src/e2e/README.md`](./src/e2e/README.md)) is a distribution whose runs are
scripted. Of OpenAgent's packages it depends on `@openagt/hooks` alone: the modules its tests and
the demo run are its devDependencies.

It names no git host either: `@openagt/github` draws its accounts, its pull requests and their
presses in the module places, and tells the shell how the requests it read stand
(`RpcHost.pullRequestsRead`, `AttentionArgs.pullRequestsRead`), which the lists of runs mark them by.
Where `#12` in a chat leads is the `chat.references` option of the module that answers for the
project's host, and the people behind commit emails, whose pictures the lists of runs show
(`UiHost.people`), are the `people` of its `account.access`.

It names no coding agent either. Each agent's name, mark and models, and the words its calls are
said in in the chat, come from its `run.agent`. `@openagt/agent-driver` draws the rest in the places the shell keeps for modules:
the menu under the message box, the usage card, what a run needs before it can start, the
agents' updates, and where the images a message goes with are kept (`composer.images`). Its host
(`run.host`) starts, stops, deletes and names this computer's runs, and gives a run only the Auto
level its project can reach.

It reads no git either. Where a run's work is (its branch, the branch it started from, its pull
requests) is what its host says of it (`RunSummary`). The panel of a session's work above its
message box holds the modules' rows (`chat.work`): `@openagt/git-branches` draws the project's row
and one per copy of a repo from its own reads of the run's checkout and branch, and the shell hands
each row whether the run works or has ended, whether its clean-up is going, the project's name and
the pull request the run's record names. The panel's frame and the bar of an ended run's next steps
are the shell's; the steps are what the modules offer there (`chat.handoff`): `@openagt/git-branches`'
Commit and Publish branch, `@openagt/github`'s Open PR. What a module's press did is written on the
run's record as that module's own facts (`RpcHost.record`).

```ts
import { runCli } from '@openagt/ui/cli'

// A distribution's `openagent`: the dashboard, serving the modules its file lists.
process.exit(await runCli(process.argv.slice(2), { distribution: '/path/to/distribution.js' }))
```

The list of projects is a setting of this computer's (`PROJECTS`, `@openagt/hooks`), which the
projects module writes (`@openagt/projects`) and the shell reads: its sidebar and its routes. A
module that changes it says so in the page (`projectsChanged`), and the shell reads it again.
Under a project's name the shell says what the modules on in it say (`app.attention`): what needs
fixing there, in red, else what they note of it (a `note`: that it is not activated, or that its
records stay on this computer).
After a module's act or command in a project, the shell tells the modules it wrote the project's
data (`app.lifecycle`'s `projectWritten`), so a store that keeps it elsewhere takes it in at once.

The distribution's file is handed down to every process the dashboard starts
(`OPENAGENT_DISTRIBUTION`), a run's own among them. Its package is the one OpenAgent is installed
as: the version the dashboard says, and checks npm for, is that package's.

## Layout

- `src/` — the CLI, the daemon, the reading of a project's runs, and the server side of the
  dashboard. Node only.
- `dashboard/` — the browser app: a Vite SPA the daemon serves as static files, talking back over
  plain HTTP. See [its README](./dashboard/README.md).
- `dashboard/module/` — what the dashboard offers a module's browser part
  (`@openagt/ui/module`), its typed client of the module's server part among them. A server
  part's functions are `@openagt/hooks/rpc`'s `read` and `act`, served at `/_rpc/<module>/<name>`.

## Status

Pre-release. There are no users to keep compatible, so the code prefers being clean over being
backward-compatible.
