# Claude web bridge

The Chrome extension of `@openagt/host-claude-web` (#1237, #2394), the plugin that adds Claude
Code on the web as a place a run can run. It makes a run's cloud session on claude.ai, in your
account, and carries what OpenAgent cannot read back from it: the question a session is parked
on comes to OpenAgent, and your answer goes back to the session. A cloud session has no stream of
its own, so without this its question would be stranded on claude.ai.

It reads the session page you are already signed into, and carries your answer back: answer the
question on the run's page in OpenAgent, the card a run's own question gets, multi-select
included, and the extension types the answer into the session's composer and submits it. What it
types is composed by OpenAgent from labels the session itself offered (the same "You paused to
ask … The user chose …" a local agent is re-prompted with; a `stop` option tells the session the
user is taking over), and a queued answer can be withdrawn until the extension collects it.

A cloud session started by OpenAgent asks its questions as a local agent does (#1554); one nobody
answers here simply waits on claude.ai for an answer typed there.

## Set it up

Switch the **Claude web** plugin on in OpenAgent's Settings › Plugins. It starts off: it opens an
address of OpenAgent's (`/_bridge`) to a caller from another origin, behind a token of its own.
Then pick, in Settings › Claude web, which browser does the work.

The short way (#1332): **A browser OpenAgent runs**. OpenAgent downloads a Chrome for Testing
(once, ~150 MB), installs this extension into it over CDP, hands it the token, and keeps the
window minimized. Press *Show the window*, sign in to claude.ai in it once, hide it again — done,
and web runs no longer need your own Chrome open. This works from a checkout and from an installed
OpenAgent alike: the package carries this extension. The steps below are the other way, **Your own
Chrome**:

1. **Load the extension**: `chrome://extensions` -> Developer mode -> Load unpacked -> the folder
   Settings › Claude web names (this one, in a checkout).
2. **Grant site access.** On the extension's Details page, under **Site access**, switch on
   `http://localhost/*`, `http://127.0.0.1/*` and `https://claude.ai/*`. Declaring host
   permissions in the manifest does not grant them, and for an unpacked extension they can sit
   off. Without the localhost grant the worker's fetch is blocked before it leaves the browser,
   OpenAgent sees nothing, and it looks exactly like a wrong token.
3. **Paste the token**: Settings › Claude web shows it (*Reveal*); paste it on the extension's
   Options page. Hit *Save and test*, which pings OpenAgent and tells you which of the two failure
   modes you have (the plugin off, or a wrong token).
4. Start a run on Claude Code on the web: "Run on" in the message box offers it in a project on
   GitHub. The extension opens one pinned tab — "OpenAgent Driver" (#1332) — that makes the
   session, reads claude.ai's session list, visits the sessions waiting on you, and types your
   answers. The run's page shows a parked question within a minute.

The Driver tab does not have to be visible: content scripts run in background tabs, so a pinned
inactive tab is enough, and Chrome only has to be running. Closing it pauses the bridge; the
options page's "Open the Driver tab now" resumes it. Use another tab for claude.ai yourself.

## How it is put together

| file | does |
|---|---|
| `content.js` | finds the question in the page, hands it to the worker, mirrors the transcript; in the Driver tab reads the session list, visits sessions in-app, types answers, draws the overlay |
| `background.js` | holds the token, runs the Driver cycle twice a minute: lists sessions, reads statuses, plans visits, acks deliveries, creates sessions |
| `driver-plan.js` | which sessions a cycle visits — shared by the worker and the harness |
| `fingerprint.js` | the extension's files and their fingerprint, which the worker compares every beat to reload itself after an edit — shared by the worker, the harness and the package's test that it ships exactly those files |
| `options.js` | where the token and dashboard URL are set, plus a connection test and the Driver's on-demand cycle |
| `check.mjs` | runs `content.js` against synthetic pages, and `driver-plan.js` and `fingerprint.js` on their own, in jsdom, no browser needed |

**The token lives in the worker, never in the page.** A content script shares a tab with
claude.ai, and nothing on that page should be able to read the secret that talks to OpenAgent.
The fetch has to live there too: a content-script fetch carries the page's origin, and OpenAgent
answers no CORS headers on purpose, because a wildcard would let any site you visit post to it. A
service worker with `host_permissions` is not subject to CORS.

**It watches rather than polls.** Chrome clamps timers in a tab hidden for more than about five
minutes to roughly once a minute, and this is meant to run in a background tab. A `MutationObserver`
catches the session's own DOM changes immediately; the slow interval is only a backstop.

## Checking the extraction

```
node --experimental-vm-modules check.mjs
```

`pnpm --filter @openagt/host-claude-web test` runs it too, as CI does.

The extraction cases, including the four that broke it on a real session (`<code>` with no
`<pre>`, content behind a shadow root, an indentation the parser had not guessed, and our own
protocol spec appearing on the page as a decoy); the block's `multi`/`default`/`stop` reaching
OpenAgent whole; the mirror; the answer delivery (fill and click send, the Enter fallback, refusing a
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
