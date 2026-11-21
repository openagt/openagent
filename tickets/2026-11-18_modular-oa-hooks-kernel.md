Topics: architecture, modules
Issue: [#2394](https://github.com/openagt/openagent/issues/2394)

# Modular OA: a hooks kernel, core modules, plugins and presets

## TLDR

Restructure OpenAgent into a small kernel (`hooks`: the contracts and the loader; `ui`: the empty shell), 15 core modules that are always on, and 16 plugins that each have an Enabled row. The `dashboard` becomes a *distribution*: the list of modules it ships. Today's agents become presets. This replaces the earlier plan (#2392, closed as superseded). The issue holds the full design: the package list, the 12 hooks, UI places, settings, run options, 42 decisions, open points and the order of work.

## Why it matters

Today features are tangled in the dashboard and import each other. With every feature a module that plugs in through hooks declared in one package, each part can be tested alone against fakes, turned off, and fixed or replaced on its own.

## The shape

- **Kernel:** `hooks` declares every hook, every UI place with its props, the settings catalog and the run options as TypeScript types. Its loader (about 100 lines) loads the distribution's modules in every process, sorts handlers by `order` and catches a handler that throws. It also ships fakes for a coding agent, a host and a store. `ui` holds the shell, layouts, server, CLI, RPC, host API and design kit, with no features of its own.
- **Core modules:** `store-filesystem`, `projects`, `git-branches`, `github`, `agent-driver` (run engine, record, local host, Claude/Codex accounts with rotation), `agent-driver-claude-code`, `agent-driver-codex`, `skills`, `user-info`, `presets`, `saved-prompts`, `ui-renderer-markdown`, `ui-pane-changes`, `ui-pane-files`, `ui-card-waiting`.
- **Plugins** (off unless the distribution starts them on): `ask` (starts on), `store-git-repository`, `store-git-branch`, `devices`, `notifications-browser`, `notifications-command`, `scheduled-agents`, `tickets`, `queue`, `browser`, `discord`, `github-auto-reply`, `logs`, `ui-renderer-mermaid`, `host-github-actions`, `host-claude-web`. Utility: `install`, which adds an `openagent` launcher and `--uninstall`.
- **12 hooks:** `run.step` (one ordered pipeline: CLONE, WORKSPACE, SKILLS, ACCOUNTS, CONTEXT, RUN, RECORD, CLEANUP, NOTIFY), `run.agent`, `run.host` (which covers reads too), `run.skills`, `store.backend` (ordered middleware), `account.access`, `app.lifecycle`, `app.attention` (`setup` and `waiting` items), plus `ui.view`, `ui.action`, `ui.option` and `ui.render`, each taking a place.
- **Run options:** each module owns its own slice. Its control writes it, its step reads it, and the record keeps it. A preset is a name plus saved run options, including agent skills and the plugins it goes without (`plugins.without`, enforced by the loader).
- **Removed:** `.openagent/hooks.yml`, `@openagt/uninstall`, `skill-orchestration` with the run engine's parent runs (`run --parent`), since Claude Code and Codex split a task across their own subagents, the five command packages (folded into `tickets` and `queue`), and later the ten standalone skills, the root `skills/` folder and the `npx skills add` catalogue. `CustomPreset` is renamed to saved prompts.

## Still open

- The "To confirm" list in the issue: points added while the plan was written and never discussed.
- Orchestration (decision 36) was contested in the issue: other plugins need a common interface to orchestration to build their features and UI on, and `skill-orchestration` lets one job use both Claude and Codex, which the agents' own subagents do not cover. The maintainer who made the decision agreed with the objection but keeps it for now, to focus on modularity first: orchestration is dropped in this redesign and revived after it is done.
- Still to design: the host API (today's `ModuleHost` has 34 members, about 16 of them moving to `devices`), and RPC to another machine for remote runs' panes.

## Order of work

1. `hooks`: contracts, loader and fakes.
2. The stores and the settings catalog.
3. The run pipeline: `agent-runner` becomes `agent-driver`'s engine calling `run.step`s; `hooks.yml` goes away.
4. `ui` comes out of `dashboard`, which becomes the distribution.
5. The core UI moves onto places; presets replace agents.
6. The plugins, one at a time, `ask` first.
7. Clean-up: removed packages and skills, the renames, and every `DECISIONS.md`.


