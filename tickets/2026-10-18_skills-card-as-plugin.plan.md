Effort: 6
Uncertainty: 5

# [Plan] The skills card as a plugin of the package that installs skills

How to move the skills card, its "Skills…" list and their sending code out of the dashboard into a module of the package that installs skills, plus an Overview card. This file is that plan.

## Where things stand

- The dashboard core owns all of it today:
  - `packages/openagent/dashboard/components/ProjectSkills.tsx`: `ProjectSkillsLine`, the card and the list with ticks. `ProjectHome.tsx:77` mounts it, and the project's ⋮ menu opens the list through `door`.
  - `packages/openagent/dashboard/rpc/skills.ts` and `src/dashboard-rpc/skills.ts`: `onProjectSkills`, `sendChangeSkills` and `sendProjectSkills`. They call `@openagt/init` (`readProject`, `applyChange`, `GROUPS`, `carriedSkills`, `uncommittedSkills`, `skillsOn`).
  - `src/dashboard/send-skills.ts`: commit, push to the default branch, or `openagent/skills` with a pull request through the project's git host package.
  - `src/dashboard/start-branch.ts`: `waitingSkills`. The launcher uses it too (`src/dashboard-rpc/projects.ts:160`): it does not take a command whose skill has not reached the branch agents start from.
- Tickets and queue show how a module works. The package exports `./dashboard` (`defineModule` with `pages` and `cards`) and an `openagent` key in its package.json. The module reads and writes through the package's own command (`host.runCommand` / `host.act`). A `./server` part is optional; it gets `ModuleServerHost` (the folder, run facts, `mergeCommit`).
- The `openagent` DECISIONS that apply: "An Overview card belongs to the package whose data it shows". "The dashboard grows by modules". "Three lists name the packages OpenAgent brings" (`src/built-in.ts`). "Skills…" in the ⋮ menu opens the same list `npx @openagt/init` shows, "through that package's own code". There is also the skills card under the waiting agents, and the send rule (commit, push, or a PR).

## Problems

1. **Which package owns it** (the ticket's open question). `@openagt/init` already holds the list, the groups, the texts, writing/deleting, `skillsOn`, the commit and the scheduler tick. The dashboard already calls it. Rom's skills tool (`use-skills` / GemSkills) is not in this repository, and nothing here names it. Its command line, its output and whether it can carry a `./dashboard` export are unknown from here.
2. **Sending needs the git host.** Pushing, and otherwise opening a pull request, goes through the project's git host package, which only the core reaches (`projectGitHost`, `cachedPrView`). A module's command and its `./server` part have no way to reach it.
3. **The launcher's gate is core.** The core needs to know which skills have not reached the start branch, apart from the card. Today it gets that from `@openagt/init`'s `skillsOn`, a skill name in the core.
4. **The door is a core menu.** "Skills…" sits in the project's ⋮ menu. The module contract (`dashboard/module/index.ts`) has no slot for a project menu item.
5. **The scheduler tick.** After a change that switches the scheduler on, `sendChangeSkills` runs the newly added `open` hook lines (`runProjectHooks`). That is core work, done on the module's behalf.
6. **Which projects have the module.** A card is drawn only where a project has the package. Every project can add skills, so the package must count as one every project has.

## Solutions

1. **Owner: `@openagt/init`** (recommended). It is the code the card already runs ("through that package's own code, so the two cannot drift apart"). The terminal and the card then stay one package. If a person picks Rom's tool instead, the contract below stays the same, but that tool needs a JSON command with the same reads and writes plus a `./dashboard` export. That is work in another repository, and this ticket waits on it. **A person decides this** before the work starts.
2. **Sending becomes a core service with no skill in it.** This is the recommended way. Generalize `send-skills.ts` and `start-branch.ts` over *paths*: "these files, to where agents start from" (commit, push or PR, with an `openagent/<name>` branch). Add a second call, "where do these files stand": waiting, here, the open request, a pushed branch. Expose both on `ModuleHost` (e.g. `host.deliver(projectId, { paths, branch, message })` and `host.delivery(projectId, { paths, branch })`). The module maps skills to paths with `skillPaths`. Alternatives:
   - (a) The init command pushes itself and opens the PR with `gh`. Rejected: it puts a git host inside init, which the git-host decisions forbid.
   - (b) Keep sending in the core under the skills name. Rejected: the core would still know skills, which defeats the ticket.
3. **Launcher gate:** the core already reads the commands from the skills folders, so it knows their paths. It asks the same generic "which of these paths are on the start branch" from step 2 and drops the `@openagt/init` import. After that, the core depends on `@openagt/init` only to bring it as a package.
4. **The door:**
   - (a) Recommended: a small contract slot, `projectMenu: [{ label, open: (host, projectId) => … }]`. It opens the module's page `/<project>/skills`, which holds the list with ticks. A link opens it, and a reload keeps it open.
   - (b) The list stays a dialog the module renders, opened from the card or the Overview card. But the card shows only while there is something to do, so it does not work as a door.

   (a) changes the DECISIONS bullet "Skills… opens the same list": the list becomes a page instead of a dialog. That is a person's pick, so the pull request should name it.
5. **Scheduler tick:**
   - (a) Recommended: the core, after any module `act`, re-reads the project's hooks and runs the `open` lines it added. This is generic and serves any package that adds a hook line.
   - (b) Move the tick to the scheduler module's own Settings entry. That changes the init list the terminal shows, which is a person's pick.
6. **Every project has it:** add `@openagt/init` to `BUILT_IN_PACKAGES` in `src/built-in.ts`, with a test.

## Implementation (with the recommended picks)

1. `packages/init`:
   - CLI commands that print JSON for the module:
     - `status`: the `ProjectSkills` shape without the delivery fields: groups, standing, scheduler, uncommitted, git.
     - `change --write a,b --remove c [--scheduler on|off]`: the `ChangeSkillsResult` shape.
   - Tests in `cli.test.ts`.
   - Move `ProjectSkills.tsx` (+ test) into `packages/init/dashboard/`, using the same layout as `skill-tickets/dashboard`: `index.tsx`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `dashboard.css`, `test-host.tsx`.
   - Export `./dashboard`; add the build and test scripts and the devDependencies the tickets package has.
   - The card reads `status` through `host.runCommand` and `delivery` through the new host call, and polls every 15s as now.
   - "Update" and "Send" go through `host.act` and `host.deliver`.
2. Module contents:
   - `cards`: the project-page card, under the waiting agents. Check whether the project page draws module cards; if it does not, add a slot for it.
   - An Overview card with the same data across `projects`: per project, the newer versions and the skills not yet with agents, each with its press. It shows only while something is due, as the project card does.
   - `pages: [{ segment: 'skills', … }]`: the list with ticks.
   - `projectMenu`: "Skills…".
3. `packages/openagent`:
   - Generalize `send-skills.ts` / `start-branch.ts` over paths (rename them, e.g. `deliver-files.ts`) and add `deliver` / `delivery` to `ModuleHost`, with their RPCs.
   - Add the `projectMenu` slot and drawing.
   - Run added `open` hook lines after `act`.
   - Delete `ProjectSkills.tsx`, `dashboard/rpc/skills.ts` and `src/dashboard-rpc/skills.ts`, and remove their tests and their entries in `dashboard-rpc/index.ts`.
   - The launcher gate uses the generic path check.
   - `@openagt/init` goes into `BUILT_IN_PACKAGES`.
   - Delete the ⋮ menu's hard-coded "Skills…".
4. DECISIONS:
   - `packages/init/DECISIONS.md` gains the dashboard caller, the way skill-tickets states its two callers.
   - Amend the `openagent` bullets: the skills card and list are init's module, and sending files to the start branch is a core service.
   - List these in the pull request; they are proposals until a person confirms them.
5. Version bumps for `@openagt/init` and `openagent`, as the recent "New version numbers" commits do.

## Considerations

- Polling `status` through `npx` every 15s per project costs a process per read. That is acceptable, since tickets does the same. If it is too slow, a `./server` read of `status` is the fallback, because it needs only the folder.
- `delivery` fetches origin at most once a minute per project (`FRESH_MS`). Keep that throttle in the core service.
- Keep the copy as it is: the sentences, "Send to GitHub", "Commit". It moves with the component and its test unchanged.
- A project picked as "all projects" in the Overview: the card lists each project that has something due, and none otherwise.
- A project without git, or without a remote: the same three outcomes `SendSkillsResult` has today (committed, pushed, request, branch).
