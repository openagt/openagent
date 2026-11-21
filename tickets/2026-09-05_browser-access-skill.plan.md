Effort: 6
Uncertainty: 6

# [Plan] New skill: browser access (with limited permissions)

How to give agents a browser that stays signed in to the person's sites (Twitter, Reddit, …), with the person deciding which sites keep a login and which ones the agent may write to.

## What exists

`packages/skill-browser` (`npx @openagt/skill-browser@0.1`) already gives agents a headless Chrome driven from the shell, shown live in the run's Browser pane, where a person can click and type. It runs on a **throwaway profile** (`src/chrome.ts`, `mkdtemp` + `rm` on close), one browser per project (state file keyed by the git root, `src/cli.ts` `stateFile`). Its DECISIONS.md says a sign-in page goes to the person, who signs in through the live view. So the missing parts are only:

1. a profile that **keeps** logins between runs,
2. **write limits** per site, enforced by the browser rather than trusted to the agent,
3. a **dashboard page** listing the sites that have logins, with the switches.

## Problems

1. **Which profile, whose.** The logins belong to the person, not to a project. But Chrome locks its `--user-data-dir`: two Chromes cannot run on one profile, and today each project has its own browser.
2. **Telling "write" apart from "read".** Blocking POST is the ticket's idea, but some sites read through POST (Reddit's GraphQL, search forms), and a few write through GET or WebSockets. A method rule alone gets both wrong sometimes.
3. **Telling login cookies apart from tracking cookies.** Not knowable in general (the ticket notes this too).
4. **The agent can run any JavaScript** (`eval`) and click anything. So the limits only hold if the network layer enforces them, not the command layer.
5. **Opt-in.** An agent that is given a signed-in browser can act as the person. The skill must not hand one to every project's agents by default.

## Solutions

1. **Profile.**
   - (a) *Recommended.* One signed-in profile per computer, kept in the person's config dir (`configFile('openagent/browser-profile')`, mode 0700, like `skill-account-rotation/src/files.ts`). Only one browser can use it at a time: an `open --signed-in` while another project's signed-in browser runs is refused, with which project holds it. The current throwaway browser stays as it is, and stays the default.
   - (b) A profile per project: no lock fight, but the person signs in again in every project. Rejected unless a person prefers it.
   - (c) Copy the profile in at start and merge it back at close: lets browsers run side by side, but two runs that both sign in fight over the merge. Too much for a low-priority ticket.
2. **Writes.** A rule per site (by registrable domain, so `old.reddit.com` and `www.reddit.com` share one), enforced with the DevTools `Fetch` domain on every target the browser opens:
   - `read only` (default for every site): requests other than GET/HEAD/OPTIONS fail (`Fetch.failRequest`, `BlockedByClient`), and WebSocket upgrades to that site are blocked (`Network.setBlockedURLs`). Some sites will then not load all their content; the person switches that site to `read and write` when that matters.
   - `read and write`: everything passes.
   - What was blocked goes into the page's console (`console.ts`), as a line like `Blocked (read only): POST https://x.com/i/api/…`, so the agent and the watcher both see why a click did nothing.
   - Service workers are bypassed (`Network.setBypassServiceWorker`), so no request leaves outside the page's own interception. New tabs/popups are attached with `Target.setAutoAttach` (`flatten: true`) and get the same rules before they run (`waitForDebuggerOnStart`).
   - Rejected: an allow-list of "write" URLs per site (too much to keep up to date), and blocking only `<form>` submissions (misses fetch/XHR).
3. **Logins.** Don't try to classify cookies. The switch per site is **keep** / **don't keep**: when the signed-in browser closes, every site not marked *keep* loses its cookies and storage (`Storage.clearDataForOrigin` for its origins, `Network.deleteCookies` for its cookies). A site the person signs into through the live view is new, so it is not kept until they switch it on — the dashboard shows it at the top as "signed in this time, not kept". Simpler and safer than guessing which cookie is the session.
4. **The rules live outside the agent's reach in effect:** the host process enforces them on the network, reads them from the person's file at start and again when the file changes, and the agent's command line has nothing to change them. (The agent could still edit the file in the home folder; say so plainly in DECISIONS.md, as this skill does not sandbox the agent's shell.)
5. **Opt-in per project.** The settings file lists the projects allowed to open the signed-in browser. `open --signed-in` in another project refuses with "the person has not allowed a signed-in browser in this project". The dashboard has the switch.

## Implementation

All in `packages/skill-browser`, plus its skill doc `skills/browser/SKILL.md`.

1. **Settings file** `src/access.ts`: `configFile('openagent/browser.json')` (private write as in account-rotation), shape `{ projects: string[], sites: { [domain]: { keep: boolean, write: boolean } } }`. A `registrableDomain(host)` helper: needs the public suffix list for `co.uk` and the like — vendor a trimmed copy or use the `psl`-style list Node lacks; keep it a pure function with tests.
2. **Profile & lock** (`src/chrome.ts`): `launchChrome(path, { profile })` — a given profile is not removed on close. The signed-in host's state file is computer-wide (`stateFile('signed-in')`), holding also the project root that holds it; `cli.ts` refuses another project with that name. Chrome's own `SingletonLock` is the backstop.
3. **CLI** (`src/cli.ts`): `open --signed-in <address>` starts (or reuses) the signed-in browser for this project; every other command goes to whichever browser this project has open. Refusal when not allowed (5 above). `USAGE` and SKILL.md updated: what read-only means, the `Blocked …` console lines, and that the agent must not switch a site's rules itself.
4. **Enforcement** (`src/host.ts`, new `src/rules.ts`): on each attached target `Fetch.enable({ patterns: [{ urlPattern: '*', requestStage: 'Request' }] })`, `Fetch.requestPaused` → `continueRequest` or `failRequest` per `rules.ts`'s pure `allowed(method, url, sites)`; WebSocket URLs of read-only sites in `Network.setBlockedURLs`; reload rules on file change (`fs.watch`) and re-apply. Only in the signed-in browser: the throwaway one keeps no rules (nothing to protect there).
5. **Cleaning on close** (`host.ts` close path): before Chrome exits, `Storage.getCookies` → delete those of non-kept sites, `Storage.clearDataForOrigin({ storageTypes: 'all' })` for their origins.
6. **Commands for the dashboard** (on the same `browser` bin, JSON out, for the module's `runComputerCommand`): `sites` (every domain with cookies in the profile, from the settings and from the profile's `Cookies` SQLite read through a short-lived headless Chrome when none runs — or simpler, the host records domains seen and writes them into the settings file as `keep: false` entries), `site <domain> --keep on|off --write on|off`, `forget <domain>` (clear its data now), `allow <project> on|off`. Make the package a *computer* module so its page runs these in the home folder.
7. **Dashboard page** (`dashboard/SitesPage.tsx`, registered in `dashboard/index.tsx`): the list of sites, newest first, each with *Keep login* and *Can write* switches and *Forget*; the list of projects with an *Allow* switch; a note that the person signs in by opening the site from an agent's run (or a "Sign in to a site…" button that opens the signed-in browser on an address, in no run, shown in a pane).
8. **Tests**: `rules.ts` and `registrableDomain` as unit tests; a host test (like `cli.test.ts`, real Chrome) that a page's `fetch(..., {method:'POST'})` to a local test server fails on a read-only site and passes on a read-and-write one, that a popup is covered, and that a non-kept site's cookie is gone after close and a kept one stays; dashboard vitest for the page's switches calling the commands.
9. **DECISIONS.md**: the person's picks once made (below), not before.

## Considerations

- **Needs a person before work** (why Uncertainty is 6): (1) one computer-wide profile with a lock vs. a profile per project; (2) default *read only* for every site, accepting that some sites load less until switched; (3) same package and command with `--signed-in`, vs. a separate skill package (`skill-browser-signed-in`) that a project installs only when it wants it — the separate package makes the opt-in the install itself and removes step 5, at the cost of a second SKILL.md and a shared core. This plan recommends the flag in the same package.
- **Headless sign-in**: some sites refuse sign-in in headless Chrome or show captchas; the person does those in the live view, as today. Google sign-in in particular often refuses automated browsers — say so in the dashboard note, don't work around it (SKILL.md already forbids getting past human checks).
- **Platform rules**: the person's accounts are on the line; X and Reddit forbid some automation. The skill doesn't decide that for them, but read-only by default limits the damage.
- **Low priority** (ticket priority 2): steps 1–5 + SKILL.md are useful alone (the person edits the JSON file by hand); the dashboard page (6–7) can be a second pull request.
- Chrome version drift: `Fetch` and `Storage.clearDataForOrigin` are stable CDP; `setBypassServiceWorker` too.
