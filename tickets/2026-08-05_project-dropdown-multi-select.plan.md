Effort: 4
Uncertainty: 3

# [Plan] Project dropdown

How to turn the sidebar's single project select (PR #1923) into a multi-select: a checkbox per project plus "All", a click on the line picking only that project, and the picked projects listed first.

## Problems

1. **The address.** Today the one picked project is the address's first segment (`/<project>/overview`, `/<project>/<page>`, `/<project>/<agent>`), `Route.scope?: string` (`packages/dashboard/dashboard/lib/route.ts`). An address has to name several projects too.
2. **"Scope" is one id everywhere.** `App.tsx` derives from it `scopedProjects`, `shownPages`, `sidebarPages`, `scoped()`/`hrefOf`, `selectScope`, `agentsOf` (`useAgents` reads one project's agents), the interventions filter, the document title, `openPage`/`pageHref`, and hands it to `AgentHistory`, `DashboardPage`, `SettingsDialog` and `ModulePageView` (`ModulePageProps.projectId`).
3. **Two clicks on one row.** `ProjectPicker` is a base-ui `Combobox` in single-value mode: a click anywhere on an item sets the value and closes. The ticket wants a checkbox click to toggle (menu stays open) and a click elsewhere on the line to pick only that project.

## Solutions

1. **Address**: keep one project as the path's first segment, exactly as now, so every existing link (tickets' `/<project>/tickets/<file>`, agents' pages, `?all`) still works. Two or more: no project segment in the path, and a query parameter `?projects=<address>,<address>` (each `addressOf(id)`, comma-joined, encoded). On a project's own pages (`/<project>/<agent>`), `?projects=` lists the *other* picked projects: the path's project is always in the set. `parseRoute`/`formatRoute`/`keepPageQuery` (add the parameter to the route's own) change; nothing else reads the URL.
   Rejected: several path segments (`/a+b/…`) — ambiguous with project addresses and page segments.
2. **Scope as a set**: `Route.scope?: string[]` (never empty; absent = all). In `App.tsx` one derived value `scope: string[] | null` (registered ids only; null = all), plus `onlyProject = scope?.length === 1 ? scope[0] : null` for the places that truly need one project.
3. **Rows**: stay in single-value Combobox mode (a click on the line → `onPick([id])`, closes as today). Inside each project row (and the "All" row) render a checkbox as its own element whose `onPointerDown`/`onClick` stop propagation (and `preventDefault` so the item is not selected) and call `onToggle(id)`; the menu stays open. Keyboard: Enter on the highlighted row picks only it (as now); **Shift+Enter** (or Ctrl/Cmd+Enter) on the highlighted row toggles it — handled in the input's `onKeyDown` with the highlighted item from `onItemHighlighted`.
   Rejected: Combobox `multiple` mode — every click toggles, so "click the line to pick only it" would fight the component.

## Considerations

- **"All"**: its checkbox is checked when nothing is picked; checking it clears the set; clicking its line also clears. Unticking the last picked project goes back to All. Ticking every project one by one stays an explicit set (new projects added later are not silently included) — no normalisation to All.
- **Picked first**: in `pickerGroups`, the projects group lists the picked projects first (in registry order), then the rest; with a search, the same order among the matches. The check mark at the row's end is replaced by the checkbox for the sidebar look.
- **Trigger label**: one project → its dot and name (as now); several → a `Layers` icon and "app, site" truncated, with the full list in the trigger's tooltip and in `aria-label` ("Projects: app, site"); none → "All projects".
- **Tooltips** (the ticket asks for them): on the checkbox "Add to the projects shown" / "Remove from the projects shown"; on the row "Show only <name>"; on "All" "Show every project". Use the existing `Tooltip` (or `title` if a Tooltip inside a Combobox item misbehaves with focus/highlight — check in the browser). One muted hint line at the menu's bottom: "Tick to show several projects · Shift+Enter".
- **Only the sidebar look is multi**: the "New agent session" row picker and the `add` look stay single. Give `ProjectPicker` an optional `multi?: { picked: string[]; onToggle(id: string): void }` used only with `look="sidebar"`, or a thin `SidebarProjectSelect` wrapper; `picked`/`onPick` stay for the others.
- **Repo rows** (not projects yet) in the sidebar: picking one still adds it, then picks only it (unchanged); no checkbox on them.
- **Agents in the sidebar** (`AgentHistory`): with one project, as now (`useAgents(projectId ?? onlyProject)`); with several, use the cross-project list (`useRecentAgents(shown)` with `shown = scope === null || scope.length > 1`) filtered to the set — `crossProject` then means "not exactly one". The "new agent" target is `onlyProject ?? SESSIONS_ID`.
- **Pages**: `scopedProjects` = projects in the set; `shownPages`/`sidebarPages` = pages that *any* picked project has; interventions and Overview (`DashboardPage`: `working`, `shownProjects`) filter by membership. Overview layout key: the project's own layout with one project, the all-projects layout otherwise. Document title: the one name, or "N projects".
- **`selectScope(next: string[] | null)`**: on a project's own page whose project leaves the set, go to that page's equivalent for the first picked project when it was a launcher, else the Overview (as today for a switch); a module page none of the picked projects has → Overview. `scoped()` keeps the set on navigation and adds the project of a project page navigated into (if it is not in the set, the set becomes that project alone, as today's "pages never show a project the select does not name").
- **Module API** (`packages/dashboard/dashboard/module/index.ts`): `ModulePageProps.projects` is already a list — it becomes the picked set's projects that have the package. `projectId` stays "the project the address starts with": the one picked project, null with all *or several*; update its doc. `openPage(segment, path, projectId)` keeps picking that single project. The tickets, queue, logs and scheduler pages already render a list of projects, so they need no change; check each with two projects picked.
- **Settings**: `SettingsDialog` keeps its own single select; its initial pick is `onlyProject ?? ALL_PROJECTS`.
- **Stale ids**: a `?projects=` entry naming no registered project is dropped; if none is left, All. `scopePending` covers `?projects=` too until the addresses are read.

## Implementation

1. `lib/route.ts`: `scope?: string[]`; parse `?projects=`, format one/several as above; add `PROJECTS_PARAM` to `keepPageQuery`'s own parameters. Update `lib/route.test.ts` (one, several, several on an agent page, `?all`, round-trips, unknown address).
2. `App.tsx`: `scope: string[] | null`, `onlyProject`; update every derived value listed under Problems 2; `selectScope` takes a set; `onToggleScope(id)` built on it.
3. `components/ProjectPicker.tsx`: the `multi` option — checkbox element per project row and on "All", picked-first ordering, trigger label/tooltip for several, Shift+Enter toggle, hint line. Update `ProjectPicker.test.tsx` (toggle keeps the menu open and calls onToggle; line click picks only; picked listed first; Shift+Enter).
4. `components/AgentHistory.tsx`: `scope: string[] | null`; the agent list and new-agent target as above. Update `AgentHistory.test.tsx`.
5. `components/DashboardPage.tsx`, `components/SettingsDialog.tsx`, `ModulePageView` call, `module/index.ts` doc of `projectId`.
6. `App.test.tsx`: tick two projects → the address carries both, the agents list and Overview show both and only those, reload keeps them, clicking a line narrows to one, ticking "All" clears.
7. Check it in `pnpm demo` with the browser skill: tooltips, keyboard, menu staying open on a tick.
8. `pnpm build`, `pnpm typecheck`, `pnpm --filter @openagt/dashboard test` and the module packages' tests (`pnpm -r --no-bail --filter '...[origin/main]' test`).
