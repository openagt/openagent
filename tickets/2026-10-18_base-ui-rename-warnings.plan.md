Effort: 2
Uncertainty: 1

# [Plan] base-ui rename warnings at install

How to move the dashboard from the deprecated `@base-ui-components/react` to `@base-ui/react`, so installing prints no "deprecated" warning.

## Problems

- The pin is `1.0.0-rc.0`; `@base-ui/react` starts at `1.0.0-rc.1` and is at `1.9.0` (latest). Between rc.0 and 1.9 the API had changes (component props, `useRender`, data attributes used in class names), so the bump may need code fixes, found by the type check and the tests.

## Solutions

- Go straight to the latest `@base-ui/react` (`1.9.0` today), not `1.0.0-rc.1`: the project is unreleased, there is nothing to keep compatible, and an old rc would only be bumped again later.
- `@base-ui-components/utils` is not ours: it is pulled in by the old package and goes away with it (the new package depends on `@base-ui/utils`).

## Considerations

- Who declares it: `packages/openagent/package.json` (`dependencies`), and `packages/files/package.json` and `packages/changes/package.json` (`devDependencies`). No source in `files` or `changes` imports it; they likely need it only to type-check against the dashboard's module types (`@openagt/dashboard/module`). Rename it there too; if `tsc` in those packages passes without it, drop it from them instead.
- Imports: 17 files under `packages/openagent/dashboard/components/` (most in `ui/`), subpaths `alert-dialog`, `checkbox`, `context-menu`, `dialog`, `menu`, `popover`, `radio`, `radio-group`, `scroll-area`, `select`, `separator`, `slider`, `switch`, `tooltip`, `use-render`. All exist under `@base-ui/react/<subpath>`.
- New optional peers (`date-fns`, `@date-fns/tz`) are optional: no warning, nothing to add.
- Class names keyed on base-ui data attributes (`data-[starting-style]`, `data-[ending-style]`, `data-[popup-open]`, `data-[side=…]`, …) are not checked by `tsc`: grep them and compare with the release notes for any rename, then look at the dialogs, menus, select, tooltip and popover in the running dashboard.

## Implementation

1. In the three `package.json` files, replace `"@base-ui-components/react": "1.0.0-rc.0"` with `"@base-ui/react": "<latest>"` (pinned exact, as now).
2. `sed` every `@base-ui-components/react` import to `@base-ui/react` across `packages/openagent/dashboard`.
3. `pnpm install`; check `pnpm-lock.yaml` no longer names `@base-ui-components` and the install prints no deprecation warning.
4. `pnpm -r typecheck`; fix what breaks, following the base-ui changelog from rc.0 to the new version.
5. `pnpm --filter @openagt/dashboard test` (and `files`, `changes`), then build and open the dashboard (browser skill) to check the dialogs, menus, select, sheet, sidebar, tooltip, slider and switch still open, animate and close.
6. Bump the dashboard's version as the repo does for a dependency change, and open the pull request with `Closes tickets/2026-10-18_base-ui-rename-warnings.md` and `Closes #2143`.
