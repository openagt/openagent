# Claude web bridge

Reports the question a Claude Code cloud session is parked on to your local OpenAgent
dashboard (#1237). A cloud run hands off and ends, so when the session later asks something there
is nothing streaming back and the question is stranded on claude.ai. This carries it home.

It reads the session page you are already signed into, and since v0.7.0 it also carries your
answer back: answer the question in the dashboard — the same panel a local agent's question
gets, multi-select included — and the extension types the answer into the session's composer and
submits it. What it types is composed by the daemon from labels the session itself offered (the
same "You paused to ask … The user chose …" a local agent is re-prompted with; a `stop` option
tells the session the user is taking over), and a queued answer can be withdrawn until the
extension collects it.

A cloud session started by OpenAgent asks its questions like a local agent does (#1554); with
the bridge off it simply waits on claude.ai for an answer typed there.

## Set it up

The short way (#1332): turn the bridge on in OpenAgent's settings, then switch on **Bridge
browser** below it. The daemon downloads a Chrome for Testing (once, ~150 MB), installs this
extension into it over CDP, hands it the token, and keeps the window minimized. Press *Show the
window*, sign in to claude.ai in it once, hide it again — done, and web runs no longer need your
own Chrome open. This works from a checkout and from `npx @openagt/dashboard` alike: the package carries
a copy of this extension. The steps below are the manual way, for running the extension in your own
Chrome, from a checkout.

1. **Turn the bridge on in OpenAgent.** It is off by default; it opens the daemon's one route
   reachable from another origin, so it is an explicit choice.
2. **Load the extension**: `chrome://extensions` -> Developer mode -> Load unpacked -> this directory.
2b. **Grant site access.** On the extension's Details page, under **Site access**, switch on
   `http://localhost/*`, `http://127.0.0.1/*` and `https://claude.ai/*`. Declaring host
   permissions in the manifest does not grant them, and for an unpacked extension they can sit
   off. Without the localhost grant the worker's fetch is blocked before it leaves the browser,
   the daemon sees nothing, and it looks exactly like a wrong token.
3. **Paste the token**: the extension's Options page. Hit *Save and test*, which pings the daemon
   and tells you which of the two failure modes you have (bridge off, or wrong token).
4. Start a web run. The extension opens one pinned tab — "OpenAgent Driver" (#1332) — that
   reads claude.ai's session list, visits the sessions waiting on you, and types your answers.
   The dashboard shows a parked question within a minute.

The Driver tab does not have to be visible: content scripts run in background tabs, so a pinned
inactive tab is enough, and Chrome only has to be running. Closing it pauses the bridge; the
options page's "Open the Driver tab now" resumes it. Use another tab for claude.ai yourself.

## How it is put together

| file | does |
|---|---|
| `content.js` | finds the question in the page, hands it to the worker, mirrors the transcript; in the Driver tab reads the session list, visits sessions in-app, types answers, draws the overlay |
| `background.js` | holds the token, runs the Driver cycle twice a minute: lists sessions, reads statuses, plans visits, acks deliveries, creates sessions |
| `driver-plan.js` | which sessions a cycle visits — shared by the worker and the harness |
| `options.js` | where the token and dashboard URL are set, plus a connection test and the Driver's on-demand cycle |
| `check.mjs` | runs `content.js` and `driver-plan.js` against synthetic pages in jsdom, no browser needed |

**The token lives in the worker, never in the page.** A content script shares a tab with
claude.ai, and nothing on that page should be able to read the secret that talks to a daemon. The
fetch has to live there too: a content-script fetch carries the page's origin, and the daemon
answers no CORS headers on purpose, because a wildcard would let any site you visit post to your
dashboard. A service worker with `host_permissions` is not subject to CORS.

**It watches rather than polls.** Chrome clamps timers in a tab hidden for more than about five
minutes to roughly once a minute, and this is meant to run in a background tab. A `MutationObserver`
catches the session's own DOM changes immediately; the slow interval is only a backstop.

## Checking the extraction

```
node check.mjs
```

The extraction cases, including the four that broke it on a real session (`<code>` with no
`<pre>`, content behind a shadow root, an indentation the parser had not guessed, and our own
protocol spec appearing on the page as a decoy); the block's `multi`/`default`/`stop` reaching the
daemon whole; the mirror; the answer delivery (fill and click send, the Enter fallback, refusing a
page with no composer); the panel's fold; session creation on a synthetic new-session page; and
the Driver: reading the session list by label and paging it, a cycle that visits in-app, reports
the question, types and waits for the send, then returns to the list under the overlay, an answer
the page did not take, a session missing from the list, and the visit planner.

After editing any file here, nothing to click: the worker fingerprints the extension's files
every beat (30 s) and reloads the extension itself when any changed, never mid-cycle
(#1711). The Driver tab gets the new content script on the next cycle's page load; your own
claude.ai tabs still need a reload, since reloading the extension does not re-inject content
scripts and an orphaned script cannot hear the new worker. The panel shows the manifest
version, which is how you tell a stale script from a current one. Leave developer mode on in
`chrome://extensions`: with it off, Chrome 137+ disables an unpacked extension on reload instead
of reloading it, and only a click there brings it back.
