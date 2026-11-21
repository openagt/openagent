Effort: 10
Uncertainty: 5

# [Plan] Modular OA: a hooks kernel, core modules, plugins and presets

This file holds how to carry out the design in #2394 against today's code: which ticket each step becomes, what the first pull request contains, how today's extension points map onto the 12 hooks and the UI places, and what a person must settle first.

## Problems

1. **Too big for one ticket or one pull request.** The work touches all 30 packages (about 60k lines; `dashboard` alone is 26k). One branch would conflict with every other change landing meanwhile, and couldn't be reviewed. The design already gives seven steps, and each step leaves `pnpm test` green.
2. **Orchestration is dropped now and revived later** (decision 36, settled on #2394). Two maintainers objected: plugins need one interface to orchestration, and `skill-orchestration` can mix Claude and Codex in one job, which neither agent's own subagents can. The maintainer who made the decision agreed, but keeps it to focus on modularity first: orchestration goes away at step 3 and comes back after step 7. The risk is that the redesign leaves no clean place for it to come back to.
3. **The "To confirm" list** (10 points) and the two "Still to design" items (the host API, RPC to another machine) were never discussed. Only the host API blocks an early step (4). The rest block nothing before step 5.
4. **Overlap with `2026-11-05_agent-data-in-folders.md` (#2293)**, which another run has claimed. It puts agent data in a list of folders, and that list is exactly `store-filesystem`'s scope→folder map and the two git stores' remotes (step 2). If both are built separately, one of them gets built twice.
5. **Where the coding-agent contract lives.** Decision 1 and the package table move `run.agent` into `hooks`, but `Driver`, `DriverSession`, `DriverTurn` … (`packages/agent-driver/core/src/types.ts`) are imported by every driver, `agent-runner`, `skill-scheduler`, `skill-account-rotation` and `dashboard-devices`.

## Solutions

1. **One ticket per step**, queued in order. Each one's text is that step of #2394's "Order of work", with this plan's mapping for it. Step 6 becomes one ticket per plugin. Each step's ticket is opened only when the step before it has merged, so its plan is written against the code as it then stands.
2. **Orchestration: remove it at step 3 as decided, and make sure the hooks can carry it back.** Nothing is built for it now. The check, made in step 1's review and again in step 3's, is that a future `orchestration` plugin needs no change to `hooks`:
   - its parent link is its own run-option slice (`orchestration.parent`), kept in the record like any slice, not a field of the engine's record
   - telling the parent its child ended is a `NOTIFY` `run.step` (today's `tellParent`/`childEndedLine`), and the sweep's "a run that died tells its parent" is the same step run by the sweep
   - its skill comes through `run.skills`; the plan/approve UI goes at `chat.pane` or `chat.handoff`; the rail's subagent tree reads the slice through `ui.render`
   - starting a child run is `run.host` start with that slice set, so mixing Claude and Codex in one job is just the slice plus the child's `run.agent`
   
   When step 7 merges, open the ticket "Revive orchestration as a plugin", linking #2394's comments, with today's `packages/skill-orchestration` and `agent-runner/src/parent.ts` as its starting point (both are in git history).
3. **Settle the open points at the step that needs them**, each in its own ticket:
   - the host API at step 4 (today's `ModuleHost` members, sorted into kept in `ui` / moved to `devices` / removed)
   - remote RPC at the `devices` plugin in step 6
   - the "To confirm" list confirmed on #2394 before step 5 starts
4. **#2293:** whoever reaches it first builds the folder list *as* `store-filesystem`'s scopes plus the git stores' remotes, not inside `agent-data`. Add a line saying so to #2293's ticket when step 2's ticket is opened. If #2293 lands first, step 2 moves its code instead of rewriting it.
5. **Move the driver types into `hooks` in step 1** and update the importers in the same pull request. No re-export is kept (AGENTS.md: no backwards compatibility). `agent-driver/core` then keeps its implementations (`cli-session`, `inbox`, `question`, `session-log`, `ready`, `gone`, `accounts`), which become `agent-driver`'s in step 3.

## Considerations

- **The loader must come before any module.** Every later step plugs into it, so step 1 ships only `hooks`, with nothing using it yet except the moved driver types and fakes. That keeps step 1 small and safe.
- **Every process loads the modules** (decision 4): the dashboard server, the run's own process (`agent-runner`'s `cli.ts` spawned by `runner.ts`), and the commands agents run in the worktree. The loader must not need React, a server or a project: it takes the distribution's module list and two predicates (enabled, without).
- **The distribution replaces discovery from a project's dependencies.** Today `readProjectPages` / `readComputerModules` (`packages/dashboard/src/project-modules.ts`) and `lookupProvidedCommand` (`packages/agent-data/src/provided-command.ts`) find modules in a project's `node_modules` by `"openagent"` keys. Decision 30 drops that. Both files go away at step 4, and `provided-command.ts` at step 3 for the run-side kinds.
- **`pnpm demo` becomes a distribution of fakes** (decision 10). The fakes in step 1 are built to be the demo's pieces: the fake driver exists (`agent-driver/core/src/fake.ts`), and `packages/dashboard/src/e2e/fake-run-bin.ts` is the demo's scripted run.
- **Two kinds of store write** (decision 28): `appendLive` never commits. The engine's live diary (`live-card.ts`) must use it, or a git store would commit on every line.
- **Errors in handlers:** the loader catches a throw. It logs it with the module's name, skips that handler, and for `run.step` fails the run with the module named. A store middleware that throws fails that store call; nothing falls through silently.
- **Order ties** go in the distribution's order (the issue), never in package name order (today's `ModuleCard.order` tie rule).
- **Tests per step:** each moved piece keeps its tests, moved with it. Each new module gets a test against the fakes alone, which is the reason for the whole change.
- **Superseded tickets:** `2026-10-18_skills-card-as-plugin.md` runs against decision 24 (the Skills page installs nothing). Close it when step 5's ticket is opened.

## Today's extension points → hooks and places

| Today | Where | Becomes |
|---|---|---|
| `"openagent": { "hooks": … }`, `.openagent/hooks.yml` (`start`, `resume`, `ready`, `open`, `close`) | `dashboard/src/project-hooks.ts`, `agent-runner/src/init.ts`, `cli.ts`, `skill-scheduler/src/init.ts` | `run.host` (start/resume), `app.lifecycle` (open/close); `ready` → `app.attention` `setup` items |
| `"cleanup"` (agent-runner, branches, orchestration, scheduler) | `agent-runner/src/cleanup.ts` | `app.lifecycle` project removed |
| `"branches"` | `skill-branches`, imported by `run.ts` | `git-branches`' `WORKSPACE` / `CLEANUP` steps |
| `"git-host"`, `"repository"` | `agent-runner/src/git-host.ts`, `dashboard/src/store/git-host.ts` | `github`, imported directly (one implementation); its `ACCOUNTS` / `RECORD` steps |
| `"runs"` | `skill-logs`' `findRun`, `readDiary` in `run.ts`, `runner.ts` | the record in `agent-driver`; `logs` plugin reads it |
| `"tickets"`, `"queue"`, `"reads"` | `package.json` `reads` lists | RPC `read(fn)` / `act(fn)` |
| `"service"` (devices) | `dashboard/src/package-services.ts` | `devices`' `app.lifecycle` |
| `"asking"` | `skill-ask` | `ask`'s `run.skills`, skipped for drivers with `ownQuestionTool` |
| `basicSkills`, `leavingOut`, skill env vars (`PROJECT_SKILLS_ENV`, `SKILLS_ON/OFF_ENV`) | `agent-runner/src/basic-skills.ts`, `project-skills.ts`, `agent.ts` | `skills`' `SKILLS` step reading `run.skills` and the `skills` run option |
| account rotation | `runner.ts` → `skill-account-rotation` | inside `agent-driver`, at `ACCOUNTS` and on a usage limit in `RUN` |
| the `ended` line | `agent-runner/src/ended.ts` | `notifications-command`'s `NOTIFY` step |
| `ModuleCard` (`line: true`) | `dashboard/dashboard/module/index.ts` | `overview.card` / `overview.line` |
| `ModulePage` | same | `app.page` |
| `ModulePanel` (`changes`, `files`, `screen`) | same | `chat.pane` |
| `ModuleRunSlots.summary` | same | `chat.summary` |
| `ModuleSettings` | same | `settings.section` |
| `LinkAction` | same | `link.menu` |
| `ModuleUsageLimit` | same | `usage.line` |
| `ModuleSchedule` | same | the settings catalog (decision 9) |
| `everyPage` | same | `app.overlay` |
| agents (`agent-data/src/agents.ts`) | | presets (`RunOptions`) |
| `CustomPreset` (`dashboard/src/project-presets.ts`, `registry.ts`, `preferences.ts`) | | `saved-prompts` |

## Implementation

### Step 1: `@openagt/hooks` (the first pull request; effort 4, uncertainty 2)

`packages/hooks/`, with no dependency on any other `@openagt` package:

- `src/order.ts`: `RunOrder`, as in the issue.
- `src/agent.ts`: the coding-agent contract, moved from `packages/agent-driver/core/src/types.ts` (`Driver`, `DriverSession`, `DriverTurn`, `DriverStartOptions`, `DriverQuota`, `DriverModel`, …). Every importer is updated: the drivers, `agent-runner`, `skill-scheduler`, `skill-account-rotation`, `dashboard-devices`, `dashboard`.
- `src/hooks.ts`: `interface Hooks`, with one entry per hook and its handler type. Each handler may carry `order`.
  - `run.step`: `{ order, run(ctx: RunContext, next) }`, where `RunContext` is a typed bag that later steps add fields to (`workspace?`, `skills?`, `env`, `record`)
  - `run.agent`: a `Driver` factory by name
  - `run.host`: start, resume, steer, stop, list, events, files, diff
  - `run.skills`: `(ctx) => Skill[]`
  - `store.backend`: middleware over `{ read, save, list, appendLive, watch }` per scope
  - `account.access`: `(ctx) => { env, gitConfig }`
  - `app.lifecycle`: `{ started?, stopping?, projectAdded?, projectRemoved? }`
  - `app.attention`: `(ctx) => Attention[]`
  - `ui.view`, `ui.action`, `ui.option`, `ui.render`: typed as data here. The React component types live in the `./ui` entry types, so the Node entry never imports React (decision 5).
- `src/places.ts`: `interface Places`, place name → props, for the 20 places in the issue's table. Props are first copied from today's `ModuleCardProps`, `ModulePageProps`, `ModulePanelProps` and `ModuleRunProps`, then narrowed at step 5.
- `src/settings.ts`: the catalog type `{ key, scope: 'person' | 'computer' | 'project', default }`, with the first entries: `user-info.name`, `user-info.picture`, `<plugin>.enabled`.
- `src/run-options.ts`: `RunOptions` and `Preset`, as in the issue.
- `src/module.ts`: `defineModule({ name, kind: 'core' | 'plugin', enabledScope?, hooks })`, where a hook's value is one handler or a list.
- `src/loader.ts` (about 100 lines): `createLoader({ modules, isEnabled(module, project?), runWithout?(run) })`. It returns:
  - `handlers(hook, ctx)`: filtered by enabled and without, then sorted by `order` with ties in distribution order
  - `collect(hook, ctx)`: each handler's answer flattened, a throwing handler logged and skipped
  - `pipeline('run.step', ctx)`: middleware with `next`, a throwing step failing with its module's name
  - `chain('store.backend')`: each middleware wrapping the next, `store-filesystem` last
  - `onError`, injected so the tests can see it
- `src/fakes/`:
  - `fake-driver.ts`: moved from `agent-driver/core/src/fake.ts` with its test
  - `fake-host.ts`: an in-memory `run.host` that records the calls
  - `fake-store.ts`: in-memory scopes, where `appendLive` is kept apart from `save`
- `src/loader.test.ts` covers:
  - order, ties, enabled, without, and a core module that can't be left out
  - a throwing handler in each of `collect`, `pipeline` and `chain`
  - a pipeline with `next` called zero times and twice: the second call throws
- `package.json`: the `.` entry (Node, no React) and `./ui` entry (types for the UI hooks with React's `ComponentType`). Added to the root `tsconfig` references and to `pnpm typecheck`.
- `DECISIONS.md`, with decisions 1–10 of #2394.

Done when `pnpm build && pnpm typecheck` passes and the tests of `hooks` and of every package whose imports moved pass.

### Steps 2–7: one ticket each, opened in turn

2. **Stores** (effort 6):
   - `store-filesystem` from `agent-data`'s `personal-folder.ts`, `project-data.ts`, `own-directory.ts` and `file-branch.ts` writer
   - `store-git-repository` and `store-git-branch` from its sync code (`git.ts`, `remote-account.ts`, `checkout-lock.ts`)
   - settings read and written through the chain
   - coordinated with #2293 (Solution 4)
3. **Run pipeline** (effort 8):
   - `agent-runner` + `agent-driver/core` + `skill-account-rotation` become `agent-driver`
   - `run.ts`'s direct imports of `skill-branches` and `skill-logs` become `run.step`s and the record
   - the rows "hooks.yml", "branches", "git-host", "runs", "basicSkills", "rotation" and "ended" of the table above
   - `provided-command.ts` and `hooks.yml` removed
   - orchestration removed: `packages/skill-orchestration`, `agent-runner/src/parent.ts` (and its uses in `run.ts`, `runner.ts`, `sweep.ts`, `index.ts`, `cli.ts`), the `parent` field the rail reads (`dashboard/dashboard/lib/subagents.ts`: the subagents its coding agent started, from `subagent` events, stay), its entry in `dashboard/src/built-in.ts`'s `PICKED_PACKAGES`, its Settings section, and `E2E_PARENT` in `dashboard/src/e2e/fake-run-bin.ts`
   - drivers renamed `agent-driver-claude-code`, `agent-driver-codex`
4. **`ui` out of `dashboard`** (effort 8):
   - the host API designed first: sort `ModuleHost`'s members (`dashboard/dashboard/module/index.ts:367`)
   - the RPC utility replaces `reads` and `runModuleCommand`
   - `project-modules.ts` discovery replaced by the distribution's list
   - `dashboard` keeps only the list and the CLI forward
5. **Core UI on places** (effort 7):
   - the `ModuleDefinition` rows of the table
   - `dashboard-changes` → `ui-pane-changes`, `dashboard-files` → `ui-pane-files`
   - the Waiting card, Permissions, Settings, Skills page, `user-info`, presets replacing agents
6. **Plugins**, one ticket each (effort 3–6 each): `ask`, the two stores' switches, `devices` (with remote RPC), `scheduled-agents`, `tickets` + its five commands, `queue` + `work-queue`, then the rest.
7. **Clean-up** (effort 3):
   - remove `uninstall`, the ten standalone skills, the root `skills/`, the README's `npx skills add` section
   - rename `CustomPreset` to saved prompts
   - every `DECISIONS.md` (23 today) made to match #2394

8. **After the redesign:** "Revive orchestration as a plugin" (Solution 2).

## To ask a person

- Confirm the "To confirm" list on #2394 before step 5. Nothing else needs a person before step 1.


