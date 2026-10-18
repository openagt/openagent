Effort: 3
Uncertainty: 7

# [Plan] Pretty Dashboard URL

Both ways the ticket can go now that the counter-proposal stands beside it, what each costs, and the work for each, to be done once the issue's author picks one.

## Problems

1. **The issue's author has not chosen between the two ways.** The ticket asks that the address stay `openagent.build` while it shows the dashboard; the counter-proposal on #1919 (2026-10-10) suggests the button navigate to the dashboard's own address instead. Nothing has been answered on the issue as of 2026-10-18. The choice decides the whole work, and it is a product and trust decision, not an agent's.
2. **A public page cannot see a local dashboard without the person's permission.** The dashboard is the daemon's page on the person's machine (`http://127.0.0.1:4200`, `DEFAULT_DAEMON_PORT` in `packages/openagent/src/daemon.ts`); the site is static files on GitHub Pages (`packages/openagent.build`, `.github/workflows/website-deploy.yml`). #1135 measured Chrome blocking every probe to loopback from the live site; Chrome and Firefox now ask "Allow openagent.build to connect to apps on this device?", and Safari 26.5 blocks it with nothing to allow. So "the dashboard whenever one is available" cannot be decided silently, and never in Safari.
3. **The daemon refuses every other origin on purpose.** `isSameOriginRequest` and `isExpectedHost` (`packages/openagent/src/dashboard/rpc-serve.ts`, `server.ts`) reject any browser request whose origin or host is not loopback, because a call to the daemon starts agents. Anything that lets `https://openagent.build` reach the daemon makes that public origin as trusted as the machine: whoever takes the site takes every visitor's machine.
4. **"The URL never changes" fights "the URL is the selection".** The dashboard's address is what it shows (`packages/openagent/dashboard/lib/route.ts`: `/gemstack/overview`, `/gemstack/<agentId>`): pasteable, reloadable, Back and Forward. A fixed address gives that up.

The domain question of the earlier plan is settled: the site is `openagent.build` (`packages/openagent.build/public/CNAME`, `pages/+Head.tsx`).

## Solutions

### A. The site keeps its address and frames the local dashboard (the ticket as written)

Choosing Dashboard replaces the site's content with a full-page `<iframe src="http://127.0.0.1:4200">`. The first click asks the browser's local-network permission; once granted, later visits probe on load and open on the dashboard. The daemon gains one read-only probe route answering `https://openagent.build` only, and `Content-Security-Policy: frame-ancestors` naming it; every call still comes from the framed page, whose origin is loopback, so the guards of problem 3 stay.

Costs: does not work in Safari at all (falls back to B's navigation); a permission prompt in Chrome and Firefox; no link to a project or an agent, and a reload returns to the Overview; the tab title and status favicon (`lib/document-title.ts`, `lib/favicon.ts`) and notifications (`lib/notification-permission.ts`) must be forwarded to the parent with `postMessage`; copy buttons need `allow="clipboard-write"`; a daemon on another `--port` is never found; and the site is now able to show, over any page, the person's machine, which a taken-over site could abuse for clickjacking. Effort about 5.

### B. The button goes to the dashboard's own address (the counter-proposal)

The toggle and the big "Dashboard" button are plain links to `http://localhost:4200`. The dashboard shows the same toggle, whose "Landing Page" side links to `https://openagent.build`. No daemon change, no prompt, every browser, the site never touches the machine; the address bar changes after the click, and every dashboard address keeps working. A stopped daemon shows the browser's "can't connect" page. Effort about 2.

On a phone the dashboard is the door of `packages/remote-access` on the person's VPS or computer, whose address the site cannot know. The dashboard's "Landing Page" link can carry its own origin (`https://openagent.build/?dashboard=<origin>`); the site keeps it in `localStorage` and the Dashboard button goes there next time, `localhost:4200` otherwise. It is only ever used as a link target, after checking it is an `http:` or `https:` origin, so it trusts nothing.

### B+. A name for "this computer": `my.openagent.build`

A DNS record `my.openagent.build → 127.0.0.1` (and `::1`) lets the button and the address bar read `my.openagent.build:4200`. Costs, beyond B:

- Plain HTTP on a name that is not `localhost` is not a secure context: "Not secure" in the address bar, and notifications and `navigator.clipboard` stop working in the dashboard. A certificate cannot fix it: Let's Encrypt proves a name over port 80 (`remote-access/src/acme.ts`), which a name pointing at loopback cannot answer, and a DNS-proven wildcard would mean shipping its private key to every machine.
- `isExpectedHost` must accept the host `my.openagent.build`. That is the DNS-rebinding guard; accepting a public name that resolves to loopback is safe only as long as the project controls that record, so whoever takes the DNS can point it elsewhere and is then on the allow-list. Written in `packages/openagent/DECISIONS.md` either way.
- Some home routers drop public names that resolve to private addresses (DNS-rebinding protection): the button must fall back to `localhost:4200` when the name does not answer, which a public page cannot detect (problem 2). So the link would have to be `localhost` anyway for those people.

Not recommended: it buys a nicer address at the cost of features the dashboard uses and a weaker host guard.

### Recommendation

B, as the counter-proposal says: it delivers the toggle and the button in every browser at a fraction of A's work and with no trust change. A is the only way to keep `openagent.build` in the address bar, but loses Safari, links, and adds a prompt. The author decides.

## Considerations

- The site is pre-rendered: in B the button's target is known only in the browser (`localStorage`), so the HTML holds `http://localhost:4200` and a small effect swaps in a remembered origin.
- The toggle in the site's nav is a link pair, `Landing Page` highlighted; in the dashboard, `Dashboard` highlighted. The site's comment in `pages/index/TopNav.tsx` ("No Dashboard button until opening it from here actually works (#1137)") goes with it: a plain link does work.
- `pages/go-to-dashboard` (the commands to start the daemon) stays the answer for "the button gave me an error page": the big button can say under it "Not running? Start it" linking there.
- The dashboard's brand sits in `packages/openagent/dashboard/components/BrandLink.tsx`; the toggle goes under it, on wide and narrow layouts alike, and in the dashboard's design language (Base UI, `design/`), not the site's.
- The site has no tests (`website:test` is a placeholder); the remembered-origin check is a plain function worth the package's first unit test. The dashboard's toggle gets a test beside `BrandLink`'s.

## Implementation

For B (the recommendation):

1. **Site** (`packages/openagent.build/pages/index`): a `dashboard-link.ts` with the default `http://localhost:4200`, reading and validating `?dashboard=` into `localStorage`, and the link target; the `Landing Page | Dashboard` toggle under the logo in `TopNav.tsx` (so `go-to-dashboard` and `press` get it too), replacing the #1137 comment; the big "Dashboard" button in `Hero.tsx` and `Cta.tsx`, with the "Not running?" link to `/go-to-dashboard`.
2. **Dashboard** (`packages/openagent/dashboard/components/BrandLink.tsx` or beside it): the same toggle under the logo; "Landing Page" links to `https://openagent.build/?dashboard=<location.origin>`. The site's address in one constant.
3. **Docs**: the site package's and the dashboard's `LOGIC.md` where they say a public page cannot open the dashboard; a `DECISIONS.md` line that the site only ever links to the dashboard.
4. Check in Chrome, Safari and Firefox against the deployed site that the button and the way back work, with and without the daemon running.

For A, the work of the earlier plan: the daemon's probe route and `frame-ancestors` (`packages/openagent/src/dashboard/server.ts`), a `DashboardFrame` and probe on the site with the before-paint view choice in `+Head.tsx`, the framed dashboard forwarding title, favicon and notifications, B's navigation as the Safari fallback, and a measurement in all three browsers first.
