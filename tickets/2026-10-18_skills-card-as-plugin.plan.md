Effort: 6
Uncertainty: 5

# [Plan] The skills card as a plugin of the package that installs skills

How to move the project skills UI (the New agent page's card, the Overview's Skills card, Settings › Skills) and the code behind it out of the dashboard core into a module package of its own.

## Where things stand (2026-11-13)

- The ticket's two candidate owners are both gone or outside the repository. `@openagt/init` was removed (#2269 "One entry point"; `packages/init` holds only a stale `node_modules`), and `packages/dashboard/DECISIONS.md` records "OpenAgent has no command of its own to give a project skills: the Skills page in the dashboard, or `npx skills add openagt/openagent`", picked over `npx @openagt/init`. `npx skills add` is a third-party CLI, so we can't put a module in it.
- The Overview card the ticket asks for already exists: `packages/dashboard/dashboard/components/SkillsCard.tsx` (#2271/#2023 work), registered as a built-in card in `DashboardPage.tsx:146`. It says the same things `ProjectSkillsLine` says (shared `skillsSay`) and adds skill use from `logs skills`.
- All of the skills code lives in the dashboard package today:
  - UI: `dashboard/components/ProjectSkills.tsx` (`ProjectSkillsLine`, `SkillsSettings`, `skillsSay`, `updateSkills`), `SkillsCard.tsx`, `dashboard/rpc/skills.ts`, `lib/skills-saved.ts`, the Settings entry `SKILLS_ENTRY` in `SettingsDialog.tsx`. `ProjectHome.tsx:93` shows the line.
  - Server: `src/dashboard-rpc/skills.ts` (`onProjectSkills`, change, send), `src/project-skills/*` (catalogue, apply, change, commit, branch, project), `src/dashboard/send-skills.ts`, plus the scheduler hook lines written when the scheduler skill is ticked (`project-hooks.ts`).
- These stay in core because running agents needs them, not the skills card: `src/cli/skills.ts` (`DEFAULT_SKILLS`, `handDownSkills`, which reads `SKILL_NAMES`), the launcher's per-session Skills menu (`SkillsMenu.tsx`, `AgentComposer.tsx`, `StartAgentForm.tsx`, `AgentsPage.tsx`'s agent skill picks), and `built-in.ts`'s picked-package rule.

## Problems

1. **Who owns it.** The ticket leaves this open, and both options it names are gone (see above).
2. **No module slot on a project's own page.** Modules contribute `pages`, `cards`, `settings`, `panels`, `run`, `everyPage`, `linkActions`, but nothing on the New agent page (`ProjectHome`), where `ProjectSkillsLine` lives.
3. **The catalogue is shared.** `SKILL_NAMES`/`GROUPS` (`src/project-skills/catalogue.ts`) feed both the skills card (what can be ticked) and the core (`handDownSkills` → `SKILL_CATALOGUE_ENV`, the launcher's "More skills").
4. **Data goes through a command.** The module contract has no RPC of its own. A module reads through its package's command (`openagent.reads` in `package.json`, `host.read` / `runModuleCommand`), as Tickets and Queue do. Today's `onProjectSkills` etc. are dashboard RPCs that use core internals: `cachedPrView`, `originAccountOf`, `remoteHostName`, `waitingSkills`, `runProjectHooks`, `providedDataChanged`.

## Solutions

1. **Owner.** Recommended: a new package, `@openagt/dashboard-skills`, in `BUILT_IN_PACKAGES`. Every project needs it, including one that has no skills yet, since this is where skills get added. It is named `dashboard-<name>` because it carries no agent instructions (DECISIONS: "A module that is no skill is named `dashboard-<name>`"). Alternatives: put the module into an existing skill package (no fit: none of them installs skills), or ask Rom's external skills tool to ship a module (out of our hands, and a project would need it installed). **A person confirms the owner** before the work starts. That is why Uncertainty is 5.
2. **Project page slot.** Recommended: drop `ProjectSkillsLine` from `ProjectHome`. With a project picked, the Overview already shows module cards for that project alone, and the Skills card says the same things. The alternative is a new module slot (`projectHome?: ComponentType<{ projectId }>`) in `ModuleDefinition`, if the person wants the notice kept under the agents that wait. Removing it is the cleaner default. The DECISIONS bullet about the card on the project's page has to be reconsidered by a person in either case.
3. **Catalogue.** Keep `SKILL_NAMES`/`GROUPS` where the core needs them. The package's command reads the catalogue's directories from `SKILL_CATALOGUE_ENV`, which module commands inherit (`runPackageCommand` spreads `process.env`; check that the env is set on the daemon's `process.env`, not only on a child's). It reads each skill's `SKILL.md` front matter for name and description. The groups move into the skills' front matter (`group:`) or stay as one exported list in `@openagt/agent-data`. Prefer front matter, so the core keeps only names.
4. **Command.** The package gets a bin (`openagent-skills`) with `show` (today's `ProjectSkills` JSON), `change --write a,b --remove c`, and `send [names]`, declared under `openagent.reads`. The project-skills code and `send-skills.ts` move into it. What it needs from the core (opening a pull request with the git host package, the origin's account, the scheduler's hook lines) goes through what `@openagt/agent-data` and the git-host provided commands already offer. Anything that is still dashboard-only gets moved to `agent-data`, or replaced by the provided-command route that other modules use (look at how `skill-queue`/`skill-tickets` reach the git host and how `skill-scheduler` writes hooks).

## Implementation

1. Create `packages/dashboard-skills` and copy the layout of `packages/dashboard-files` (`src/`, `dashboard/`, `tsconfig*`, vite build of `./dashboard`, `bin`). Add it to `BUILT_IN_PACKAGES` and to the dashboard's dependencies.
2. Move `src/project-skills/*`, `src/dashboard/send-skills.ts` and the logic of `src/dashboard-rpc/skills.ts` into the package's `src/`, behind its CLI (`show`, `change`, `send`), printing JSON like `skill-tickets`. Move their tests along with them.
3. Module (`dashboard/index.tsx`, `defineModule`):
   - `cards: [{ id: 'skills', label: 'Skills', order: 8, width: '1/3', minWidth: '1/4', Card }]`: today's `SkillsCard`, reading through `host.read` instead of `onProjectSkills`. Its `logs skills` part runs the logs package's command through the host's computer/project command API. Check that a module can run another package's command; if it can't, that part stays a known gap or goes behind a link action.
   - `settings: [{ id: 'skills', title: 'Skills', icon: Puzzle, Section }]`: today's `SkillsSettings`. `openSettings('skills', …)` from the launcher's Skills menu keeps working, because the entry id stays `skills`.
   - The "saved" signal (`lib/skills-saved.ts`) becomes internal to the module.
4. Remove from core: `ProjectSkills.tsx`, `SkillsCard.tsx`, `dashboard/rpc/skills.ts`, the `skills` RPCs and their dispatch entries, the built-in Overview card entry, `ProjectSkillsLine` in `ProjectHome.tsx` and its `onSkillsChanged` plumbing, and the core Settings entry for `SKILLS_ENTRY`. Keep `held` (the launcher's per-session menu): either keep a small core read through `projectSkillNames` from `@openagt/agent-runner` (already what the RPC uses), or read it from the package's `show`. Prefer the former, so the core doesn't depend on the module.
5. Update `packages/dashboard/DECISIONS.md` only for the picks a person makes (owner, project-page notice). Put a `DECISIONS.md` in the new package.
6. Tests: package node tests for the CLI (ported `project-skills` tests and `dashboard-rpc/skills.test.ts`), vitest for the card and the settings section (ported from `ProjectSkills.test.tsx`), and the dashboard's tests minus the removed parts. Run `pnpm demo` and check that the Overview card and Settings › Skills still work from the module.

## Considerations

- The Overview counts as "drawn only when a project shown has the package". Being a built-in package, every project has it, so the card shows where it does today.
- The scheduler tick writes hook lines (`project-hooks.ts`). The package's `change` has to do the same, or call the scheduler package's command for it.
- `SendSkillsResult`'s pull request path uses the dashboard's PR cache. The module re-reads instead, which costs at most one `gh`/host call per poll (15 s today). Keep the poll interval.
- Ticket order: none blocking. #2117 (the card itself) is done.
