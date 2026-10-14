Effort: 5
Uncertainty: 8
Outdated: yes

# [Plan] Pretty Dashboard URL

How `openagent.build` could show the dashboard and the landing page at one address, what stands in the way, and the decisions a person has to make before the work starts.

## Problems

1. **A public page cannot see a local dashboard without the person's permission.** The dashboard is the daemon's page on the person's own machine (`http://127.0.0.1:4200`, `DEFAULT_DAEMON_PORT` in `packages/framework/src/daemon.ts`); the site is static files on GitHub Pages (`packages/the-framework.ai`, Vike pre-rendered, `.github/workflows/website-deploy.yml`). Issue #1135 measured it in Chrome 150 from the live site: every `fetch`, `<img>` and `<script>` probe to loopback is blocked by Local Network Access, the daemon sending `Access-Control-Allow-Private-Network` does not help, and a running daemon fails exactly like a closed port. Only a top-level navigation gets through, or a probe after the person granted the browser's Local Network Access permission, which needs a click. So "shows the dashboard whenever one is available" cannot be decided silently on a first visit. This is why the site has no Dashboard button today (#1137, the comment in `pages/index/TopNav.tsx`) and why `pages/go-to-dashboard` only hands out commands.
2. **The domain is not in the repository.** Nothing names `openagent.build`: the site is published at `the-framework.ai` (`public/CNAME`, the package's `LOGIC.md`, the page titles). Whether the ticket moves the site to a new domain, adds a second one, or renames the product is not said. DNS and the GitHub Pages domain setting are outside the repository.
3. **"The URL never changes" contradicts "the URL is the selection".** The dashboard's address is its selection (`dashboard/lib/route.ts`, `use-route.ts`): `/<project id>/<agent id>` can be pasted, reloaded, opened twice, and Back and Forward work from it. A URL that never changes gives that up, unless the ticket only means that the origin stays the same while the path still moves.
4. **The daemon refuses every other origin on purpose.** `isSameOriginRequest` and `isExpectedHost` (`src/dashboard/rpc-serve.ts`, `guardBrowserOrigin` in `server.ts`) reject any browser request whose origin or host is not loopback, because a call to the daemon starts agents, which is code execution on the person's machine. Any design that lets `https://openagent.build` talk to the daemon makes that one public origin as trusted as the machine itself: whoever controls the domain, its GitHub Pages branch, or a script on its pages controls every visitor's daemon.
5. **The hosted page and the local daemon are different versions.** The dashboard's calls are typed against the daemon's own signatures (`dashboard/rpc/`); a dashboard built and hosted with the site would talk to whatever older daemon the person has installed.

## Solutions

### A. The site frames the local dashboard (closest to the ticket as written)

`openagent.build` is the landing site. Its top-left logo gets the `Landing Page | Dashboard` toggle below it, and the hero gets the big "Dashboard" button. Choosing Dashboard replaces the page's content with a full-page `<iframe src="http://127.0.0.1:4200">`; the address bar stays `openagent.build`.

- The first click is the gesture the browser needs: the page asks for Local Network Access, then probes the daemon. Once granted, later visits probe silently on load and open on the dashboard, which is the ticket's "whenever one is available". Until granted, and in a browser with no such permission, the landing page shows.
- The daemon gains one read-only probe route that answers the site's origin (CORS for `https://openagent.build` only, no data in the body), and allows that one origin to frame it. Every call still comes from the framed page, whose origin is loopback, so the CSRF and DNS-rebinding guards stay as they are: problem 4 shrinks to "the site can show the dashboard", not "the site can call the daemon".
- The framed dashboard is the daemon's own build, so problem 5 does not arise.
- The dashboard shows the same toggle under its own logo, and asks its parent to switch back (`postMessage`); opened directly at `127.0.0.1:4200` the toggle links to the site.
- Costs: no pasteable address for a project or an agent, a reload returns to the Overview unless the site mirrors the framed path somewhere (the fragment would break "never changes"; `sessionStorage` would not); the tab title and the status favicon (`lib/document-title.ts`, `lib/favicon.ts`) have to be forwarded to the parent; browser notifications cannot be asked for from a cross-origin frame (`lib/notification-permission.ts`), so the permission has to be asked by the site for its own origin and the notifications raised there; copy buttons need `allow="clipboard-write"`. Only the default port is probed: a daemon on `--port` is never found.
- To measure before building, as #1135 did: whether Chrome applies Local Network Access to the frame's navigation after the grant, and whether Safari and Firefox load an `http://127.0.0.1` frame inside an `https` page at all. Where they do not, the Dashboard button falls back to a plain navigation to `http://localhost:4200`.

### B. The site is the dashboard (one real app at the public origin)

The dashboard's bundle is hosted with the site and calls the daemon across origins. The address can then keep paths (`openagent.build/<project id>/<agent id>`), notifications and titles work natively. But the daemon must accept calls from the public origin (problem 4 in full), the hosted build meets older daemons (problem 5), the live event stream and module loading (`import map`, `exports["./dashboard"]`) all cross origins, and GitHub Pages has no fallback route for unknown paths other than its 404 page. Roughly twice the work of A and a much larger trust change.

### C. A plain button, no shared address

The landing page's "Dashboard" button and the toggle simply navigate to `http://localhost:4200`; the dashboard's toggle links back to the site. No daemon change, no permission prompt, works in every browser, a day's work. It delivers the toggle and the button but not the ticket's point: the address a person types is still not the dashboard's, and a stopped daemon gives a browser error page.

### D. A relay behind the public domain

The daemon connects out to a server at `openagent.build`, and the site shows the dashboard to a signed-in browser. A true pretty URL from any device, but it needs accounts, a hosted backend the project does not have, and puts every machine's agents behind a public service. Out of proportion to the ticket.

### Recommendation

A, with C's navigation as the fallback where framing is blocked. It is the only option that keeps the address fixed, as the issue asks twice, without teaching the daemon to trust a public origin.

## Considerations

- **Decisions for a person, before any work:**
  1. Is `openagent.build` replacing `the-framework.ai`, and who points its DNS at GitHub Pages? The work cannot ship before the domain serves the site.
  2. Does "the URL always stays `openagent.build`" mean the whole address (A) or only the origin (B)? A gives up links to a project or an agent.
  3. Is the browser's one-time permission prompt acceptable as the meaning of "whenever available"? There is no way around it in Chrome.
  4. Is letting the public site frame the local dashboard an acceptable trust change? It is recorded in `packages/framework/DECISIONS.md` either way.
- The site is static and pre-rendered: the landing page is what the HTML holds, and the switch to the dashboard happens in the browser after the probe. To avoid a flash of landing page for a returning person, the choice of last view is kept in `localStorage` and read by a small inline script in `pages/+Head.tsx` before first paint.
- The toggle is the person's choice and outranks the default: someone who picked Landing Page stays there on reload, even with the daemon running.
- A daemon stopped while the frame shows: the frame's page already says "The daemon is not answering" (`lib/use-daemon-health.ts`) once loaded; a frame that never loaded cannot be told from a blank one, so the site probes before framing and shows the commands of `pages/go-to-dashboard` when the probe fails.
- `pages/go-to-dashboard` becomes what the Dashboard view shows when no daemon answers, rather than a page nothing links to. Its `LOGIC.md`, and the sentences in the package's `LOGIC.md` and `TopNav.tsx` saying a public page can neither detect nor open a local dashboard, are rewritten with it.
- A daemon bound to a non-loopback host sits behind the shared token (`server.ts`, #1051); the site only ever looks for a loopback daemon.
- The site has no tests today (`website:test` is a placeholder); the probe and the view choice are plain functions worth the package's first unit tests. The daemon's new route and frame header get tests beside `server.ts`'s.

## Implementation

For A, once the four decisions are made:

1. **Domain** (`packages/the-framework.ai`): `public/CNAME`, the titles, the head's canonical and link-preview addresses, the package's `LOGIC.md`; the DNS and Pages setting are the person's.
2. **Daemon** (`packages/framework/src/dashboard/server.ts`): a `GET` probe route answering `https://openagent.build` with the CORS and Local Network Access headers and nothing else; `Content-Security-Policy: frame-ancestors` naming that origin and the daemon's own on the page shell. The origin lives in one exported constant. Tests, `LOGIC.md`, a `DECISIONS.md` entry.
3. **Site** (`pages/index`): a `DashboardFrame` component and a `dashboard-probe.ts` (permission state, probe, remembered view); the toggle under the logo in `TopNav.tsx`; the big button in `Hero.tsx` and `Cta.tsx`; the before-paint script in `+Head.tsx`; the no-daemon fallback reusing `go-to-dashboard`'s commands; forwarding of title, favicon and notifications from the frame.
4. **Dashboard** (`packages/framework/dashboard`): the same toggle under its logo in the side rail; when framed, `postMessage` to the parent for the switch, the title, the favicon and notifications; when not framed, a link to the site.
5. **Measure** in Chrome, Safari and Firefox against the deployed site, as #1135 did, and wire the plain-navigation fallback for whichever blocks the frame.
