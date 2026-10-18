Effort: 3
Uncertainty: 2

# [Plan] The project select: same-name projects, and what shows before the first reads

How to tell same-name projects apart in the dashboard, and how to keep the sidebar from saying anything untrue until its first reads land.

## Problems

1. **Same names.** `ProjectSummary.name` is the folder's basename (`src/dashboard/projects.ts:89`), so two repos called `shop` look the same everywhere a project is named. `ProjectSummary.path` (the full path) is already sent to the dashboard, so the client has what it needs to tell them apart.
2. **"All projects" for a moment.** On `/shop` before the projects list is read, `parseRoute` (`dashboard/lib/route.ts:116`) has no addresses yet, so it reads the segment itself as the project: `scope = 'shop'`, which `App.tsx:110` lets through because `projects.length === 0`. `ProjectSelect` (`dashboard/components/ProjectSelect.tsx:35`) then finds no project with that id and falls back to "All projects". When the read lands, `shop` turns into the real id (`shop-<hash>`) and the select names the project.
3. **"No agents yet" for a moment.** `AgentHistory` prints "No agents yet." whenever it has no rows (`components/AgentHistory.tsx:359`). It never hears whether the read is still out. Also, before the addresses are read, `useAgents(projectId ?? scope)` (`App.tsx:147`) reads agents for the address `shop` rather than the id: a wasted, wrong read. When the id arrives it reads again.

## Solutions

### 1. A label that tells same-name projects apart

- A pure helper, `projectLabels(projects): Map<id, string>`, in `dashboard/lib/` (next to `route.ts`), with its own unit test. A name no other project has stays as it is. Names that clash get the shortest end of the path that makes each one different: `work/shop` and `clients/shop`. It goes up more folders when the parents clash too (`a/x/shop` and `b/x/shop`). If even the full paths can't separate them, it uses the full path. Paths are split on both `/` and `\`.
- Show the label as text, not as a tooltip, so it can be read on a phone too. Use it everywhere a project is named in a list or as the current pick:
  - `ProjectSelect`: the button's text and its `aria-label`, plus each menu item. In a menu item, show the name in the item's normal style and the distinguishing folder in muted text before it (`work/` muted, `shop` normal). That keeps names in the same column.
  - The same label in `SettingsDialog`'s project select (`components/SettingsDialog.tsx:177`, `:208`), in the New button's project picker, in the project name on Overview rows (`startProjectName` and `RecentAgent.projectName`, set where the rows are built in `AgentHistory`), and in the document title (`App.tsx:184`). Compute the map once in `App` and pass it down, so no component works it out again.
- No server change: the label is about how things are shown, and the full path is already on the client. The address already tells the projects apart (`projectAddresses`) and stays as it is.

### 2. Nothing untrue while the reads are out

- `App` passes `projectsLoaded` down (`addressesRead` is better: the address only names a project once both reads are in). `ProjectSelect` gets a `loaded` prop. While it is false and the route names a project (`route.scope` is set), the button shows a placeholder the same size as the text, a muted skeleton bar with no label, and an `aria-label` of "Project: loading". It must not say "All projects". If the route names no project, "All projects" is true even before the read and stays.
- `App.tsx:110`: drop the `projects.length === 0` escape. Until `addressesRead`, `scope` stays the route's value only for showing the placeholder; nothing is read for a project that isn't known yet. Concretely:
  - `useAgents(addressesRead ? projectId ?? scope : null, …)`. This stops the read made under the address instead of the id.
  - Keep `scope` as it is for the menu, but have the select treat "not loaded" as unknown, as above.
- `AgentHistory` gets `loaded`: `agentsLoaded` when a single project is shown, and the recent-agents poll's `loaded` (`App.tsx:205`, read from `usePolled`) when all projects show. While it is false, it prints nothing under "Recent agents" (the heading stays, so the column doesn't jump). Use no text and no spinner: the read takes about 100 ms, and a spinner would just flash. Once it is loaded and still empty, "No agents yet." shows as it does now.
- `usePolled` already resets `loaded` to false when a dependency changes (`lib/use-async.ts:139`). Switching projects therefore also shows the empty list rather than "No agents yet." for the moment the read takes, which is just as true.

## Considerations

- Read failures: `loaded` stays false until a read succeeds, so a daemon that can't be reached would leave the select as a placeholder forever. That isn't an untrue state, and the dashboard already has its own "can't reach the daemon" signal. Leave it.
- The unknown-project case (`App.tsx:186`) already waits for a non-empty list. With the `projects.length === 0` escape gone, a link to an unregistered project after the read gives `scope = null` ("All projects"), as it does today once the read is in.
- The `?all` route (a project's page with all projects shown) has no `scope`. It shows "All projects" at once, which is true.
- The label map changes only when the set of projects changes. Memoize it on the joined ids and paths, the same way `addresses` is memoized.

## Implementation

1. `dashboard/lib/project-labels.ts` + test: names that are unique, two that clash, three that clash at different depths, clashing parents, a Windows path.
2. `App.tsx`: compute the labels; gate `useAgents` on `addressesRead`; drop the `projects.length === 0` escape from `scope`; pass `labels`, `loaded` (the select) and `listLoaded` (the rail) to `AgentHistory`; use the label in the document title, `startProjectName` and the Settings dialog.
3. `ProjectSelect.tsx`: use the labels for the button and the items (muted folder prefix); the placeholder while not loaded and a project is named.
4. `AgentHistory.tsx`: pass `loaded` through to `ProjectSelect`; hide "No agents yet." until the list is loaded; label the project name on Overview rows; send the labels to the New button's picker.
5. Tests: in `ProjectSelect`/`AgentHistory` tests, two `shop` projects show `work/shop` and `clients/shop`; with `loaded` false and a project named, neither "All projects" nor "No agents yet." appears. In `App.test.tsx`, opening `/shop` with the projects read held back never shows "All projects", and no agents read goes out for `shop`.
