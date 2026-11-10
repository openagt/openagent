// The half that talks to the daemon.
//
// **Why the fetch lives here and not in the content script.** A content script's fetch carries
// the page's origin, so it would be a cross-origin request and the daemon deliberately answers
// no CORS headers: a wildcard there would let any site the user visits post to their dashboard.
// A service worker holding `host_permissions` is not subject to CORS, so the same request works
// from here and only from here.
//
// It also keeps the token out of the page. A content script shares a tab with claude.ai, and
// nothing on that page should ever be able to read the secret that talks to a daemon.

importScripts('driver-plan.js', 'fingerprint.js')

const DEFAULT_DAEMON = 'http://localhost:4200'

// Every daemon call states this extension's version, and a daemon expecting another refuses it
// outright (#1519): a version-skewed extension half-works in ways that read as dashboard bugs,
// so the daemon blocks rather than degrades, and the error it answers names both versions.
const VERSION_HEADER = { 'x-oa-extension-version': chrome.runtime.getManifest().version }

/**
 * The daemon as the options page set it up, or undefined while no token is set: its address, and
 * a GET and a POST that carry the token and this extension's version.
 */
async function daemon() {
  const { daemonUrl, token } = await chrome.storage.local.get(['daemonUrl', 'token'])
  if (!token) return undefined
  const base = (daemonUrl || DEFAULT_DAEMON).replace(/\/+$/, '')
  const headers = { authorization: `Bearer ${token}`, ...VERSION_HEADER }
  return {
    base,
    get: path => fetch(`${base}${path}`, { headers }),
    post: (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }),
  }
}

/** What the page is told when no token is set. */
const NO_TOKEN = { ok: false, error: 'no token set: open the extension options' }

/** The daemon's refusal, as the page's status line shows it. */
async function refusal(res) {
  return `daemon answered ${res.status}: ${(await res.text()).slice(0, 200)}`
}

/** One POST to the daemon: whether it took it, and why not. */
async function post(path, body) {
  const to = await daemon()
  if (!to) return NO_TOKEN
  const res = await to.post(path, body)
  return res.ok ? { ok: true } : { ok: false, error: await refusal(res) }
}

/** What we last successfully reported per session, so a re-render does not re-post. */
const lastSent = new Map()

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Run a cycle on demand, so the options page can prove it works without waiting on an alarm.
  if (message?.type === 'oa-open-now') {
    void openDriverNow()
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, reason: String(err?.message ?? err) }))
    return true
  }
  if (message?.type === 'oa-hello') {
    // The reply says whether the page asking is the Driver tab, so it draws its overlay the
    // moment it loads rather than when the first cycle reaches it.
    void Promise.all([post('/_bridge/hello', { version: message.version, sessionId: message.sessionId, note: message.note }), driverTabId()])
      .then(([reply, driver]) => sendResponse({ ...reply, driver: sender.tab?.id != null && sender.tab.id === driver }))
      .catch(() => sendResponse({ ok: false }))
    return true
  }
  if (message?.type === 'oa-driver-log') {
    // Receiving it is the point: a cycle in the page can run for minutes, and each message
    // resets the idle clock that would otherwise end this worker mid-cycle.
    sendResponse({ ok: true })
    return false
  }
  if (message?.type === 'oa-events') {
    void post('/_bridge/events', { sessionId: message.sessionId, events: message.events })
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, error: String(err?.message ?? err) }))
    return true
  }
  if (message?.type !== 'oa-question') return false
  void report(message.question)
    .then(sendResponse)
    .catch(err => sendResponse({ ok: false, error: String(err?.message ?? err) }))
  // Keep the message channel open for the async reply.
  return true
})

async function report(question) {
  if (!question?.sessionId) return { ok: false, error: 'no session id' }
  const to = await daemon()
  if (!to) return NO_TOKEN

  // Same question, same session: say so and spend nothing. The content script re-surveys on every
  // DOM change, and a parked question can sit there for an hour.
  const fingerprint = JSON.stringify([question.title, question.options, question.recommended])
  if (lastSent.get(question.sessionId) === fingerprint) return { ok: true, skipped: 'unchanged' }

  const res = await to.post('/_bridge/question', question)
  if (!res.ok) {
    // Do not remember a failure, so the next DOM change retries rather than going quiet.
    return { ok: false, error: await refusal(res) }
  }
  lastSent.set(question.sessionId, fingerprint)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Answers travelling back (#1237): the dashboard queues a pick, the cycle collects it, the Driver
// tab types it into the session, and the outcome is reported.

/** Answer ids already handed to the Driver, so a slow ack cannot double-submit into the session. */
const deliveredAnswers = new Set()

/** Acks that failed to reach the daemon, retried on the next cycle rather than dropped. */
const pendingAcks = new Map()

/** Tell the daemon what a delivery did. A failed ack is kept and retried, never dropped: an
 * unacked delivered answer would sit `queued` in the dashboard after being typed into the page. */
async function ack(to, body) {
  try {
    const res = await to.post('/_bridge/answered', body)
    if (res.ok || res.status === 400) {
      pendingAcks.delete(body.id)
      return
    }
  } catch {
    // Fall through to the retry queue.
  }
  pendingAcks.set(body.id, body)
}

/** The answer the dashboard queued for that session, or undefined. */
async function fetchAnswer(to, sessionId) {
  try {
    const res = await to.get(`/_bridge/answer?sessionId=${sessionId}`)
    if (!res.ok) return undefined
    const answer = (await res.json())?.answer
    return answer?.id && typeof answer.text === 'string' ? answer : undefined
  } catch {
    return undefined
  }
}

/** The next session the daemon wants created, claimed by this read (#1328), or undefined. */
async function claimStart(to) {
  try {
    const res = await to.get('/_bridge/start')
    if (!res.ok) return undefined
    const start = (await res.json())?.start
    return start?.id && typeof start.repo === 'string' && typeof start.branch === 'string' && typeof start.prompt === 'string' ? start : undefined
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// The Driver tab (#1332): one pinned background tab that serves every watched session.
//
// The extension cannot know a cloud run started: it only sees pages it is injected into. So the
// daemon publishes which sessions are ours, and this keeps one tab open on claude.ai whose content
// script reads claude.ai's own session list — the status icon beside each session says whether it
// stopped for its user — and visits only the sessions that need it, navigating inside the app.
// One tab for fifty sessions, where there used to be a tab each, capped at three.

const DRIVER_URL = 'https://claude.ai/code'

/** How often a cycle runs; the floor Chrome allows for an alarm. */
const CYCLE_MINUTES = 0.5

/**
 * How often the Driver's page is reloaded before its list is read. The list refreshes only on a
 * page load — after an in-app navigation it still shows what it showed before (measured
 * 2026-08-25) — so a fresh read costs one load, at the rate the old tab sweep used to poll.
 */
const LIST_REFRESH_MS = 60_000

/** How long to give the Driver's page to load and its content script to answer. */
const TAB_LOAD_MS = 30_000
const SCRIPT_RETRIES = 10

/**
 * Most visits handed to the Driver in one cycle, answers first. One drive is one message this
 * worker waits on, and Chrome ends a worker whose single call has run five minutes — the cycle
 * log lines reset only the separate idle clock. Four visits and a creation keep well under it
 * even on a slow page; the rest wait for the next beat.
 */
const MAX_VISITS = 4

/** A cycle in flight, so the next alarm does not start a second one over it. */
let cycling = false
/** When the Driver's page was last loaded fresh. In memory: a new worker reloads once, which is fine. */
let lastReloadAt = 0
/** What the list said and when the session was last visited, per session — the sticky-state memory `planVisits` reads. */
const seen = new Map()

/**
 * The Driver's bookkeeping that is only good for one browser session — its tab id, and the pause
 * that closing it leaves — is kept in session storage: Chrome empties it on a browser restart and
 * keeps it across worker restarts. A tab id from an earlier browser session would name whatever
 * tab happens to carry that number now, which is not a tab to drive.
 */
const driverState = chrome.storage.session

/** The tab id the Driver runs in, or undefined. Stored, so a restarted worker finds its tab again. */
async function driverTabId() {
  const { driverTabId } = await driverState.get('driverTabId')
  return driverTabId ?? undefined
}

/**
 * Record what the last cycle did, so the options page can show it.
 *
 * Every early return used to be silent, which is how "the bridge is doing nothing" became
 * unanswerable without reading a service worker console. Each one now says which it was.
 */
async function note(state) {
  await chrome.storage.local.set({ lastCycle: { ...state, at: new Date().toISOString() } })
  return state
}

/** Resolve once the tab reports `complete`, or after {@link TAB_LOAD_MS}. */
function tabLoaded(tabId) {
  return new Promise(resolve => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') done()
    }
    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(done, TAB_LOAD_MS)
  })
}

/**
 * The Driver tab, opened if there is none. A stored tab that is gone, or that someone moved off
 * claude.ai, is forgotten and replaced — whoever moved it keeps it; a tab is never navigated to
 * make it ours. On a browser restart Chrome restores pinned tabs under new ids and the stored id
 * is gone with the session, so a lone pinned claude.ai/code tab is adopted rather than doubled; a
 * restored tab carries no other mark, so this cannot tell it from one the user pinned themselves.
 */
async function ensureDriverTab() {
  const stored = await driverTabId()
  if (stored != null) {
    const tab = await chrome.tabs.get(stored).catch(() => undefined)
    if (tab && (tab.url ?? '').startsWith('https://claude.ai/')) return tab
    await driverState.set({ driverTabId: null })
  }
  const pinned = await chrome.tabs.query({ url: `${DRIVER_URL}*`, pinned: true })
  let tab = pinned.length === 1 ? pinned[0] : undefined
  if (!tab) {
    tab = await chrome.tabs.create({ url: DRIVER_URL, active: false, pinned: true })
    await tabLoaded(tab.id)
    lastReloadAt = Date.now()
  }
  await driverState.set({ driverTabId: tab.id })
  return tab
}

/** Load the Driver's page fresh, so its session list is current. */
async function reloadDriver(tabId) {
  await chrome.tabs.reload(tabId)
  await tabLoaded(tabId)
  lastReloadAt = Date.now()
}

/**
 * Hand a message to the Driver's content script, retrying while it is still being injected.
 * A script orphaned by an extension reload cannot hear us at all; the tab is ours, so one reload
 * revives it before the retries continue. A tab that is gone, or a drive whose page was torn
 * down after taking the message, is a failure rather than a throw or a re-send: the answers
 * handed over must still be accounted for, and a drive is not idempotent.
 */
async function askDriver(tabId, message) {
  let lastErr
  let reloaded = false
  for (let i = 0; i < SCRIPT_RETRIES; i++) {
    try {
      const outcome = await chrome.tabs.sendMessage(tabId, message)
      if (outcome) return outcome
    } catch (err) {
      lastErr = err
      // A port that closed after the page took the message means the page acted and was then
      // torn down — a reload under it, a sign-in bounce. The answer may already be typed.
      if (message.type === 'oa-drive' && /port closed/i.test(String(err?.message ?? ''))) {
        return { ok: false, tornDown: true, note: 'the Driver page was torn down mid-drive; an answer handed over may or may not have been typed — check the session before picking again' }
      }
      if (i >= 2 && !reloaded) {
        reloaded = true
        try {
          await reloadDriver(tabId)
        } catch (reloadErr) {
          return { ok: false, note: `the Driver tab is gone: ${String(reloadErr?.message ?? reloadErr)}` }
        }
        continue
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2000))
  }
  return { ok: false, note: `the Driver tab never answered: ${String(lastErr?.message ?? lastErr ?? 'no reply')}` }
}

/** One cycle, guarded: an alarm landing mid-cycle does nothing. */
async function cycle() {
  if (cycling) return { ok: false, reason: 'a cycle is already running' }
  cycling = true
  try {
    return await note(await runCycle())
  } catch (err) {
    return note({ ok: false, reason: String(err?.message ?? err) })
  } finally {
    cycling = false
  }
}

async function runCycle() {
  const to = await daemon()
  if (!to) return { ok: false, reason: 'no token set' }
  const { autoOpen } = await chrome.storage.local.get('autoOpen')
  // Whatever the Driver's state, what is owed to the daemon is paid first: acknowledgements that
  // never landed, and — with the Driver off or paused — an honest failure for any session request,
  // since one left queued would be created hours later, for a run long gone.
  for (const body of [...pendingAcks.values()]) await ack(to, body)
  const { driverPaused } = await driverState.get('driverPaused')
  // Opt-in: driving a tab on someone's behalf should be asked for, not assumed.
  const stopped =
    autoOpen === false ? 'the Driver tab is switched off' : driverPaused ? 'the Driver tab was closed; "Open the Driver tab" on the options page resumes it' : undefined
  if (stopped) {
    const start = await claimStart(to)
    if (start) await reportStarted(to, start.id, { ok: false, note: stopped })
    return { ok: false, reason: stopped }
  }

  let sessions
  try {
    const res = await to.get('/_bridge/sessions')
    if (!res.ok) return { ok: false, reason: `daemon answered ${res.status} listing sessions` }
    sessions = (await res.json())?.sessions
  } catch (err) {
    return { ok: false, reason: `could not reach ${to.base}: ${String(err?.message ?? err)}` }
  }
  sessions = (Array.isArray(sessions) ? sessions : []).filter(s => s?.id)

  // A queued answer forces a visit whatever the list says: it is the one thing the list cannot know.
  const answers = new Map()
  for (const session of sessions) {
    if (!session.answerQueued) continue
    const answer = await fetchAnswer(to, session.id)
    if (answer && !deliveredAnswers.has(answer.id)) answers.set(session.id, answer)
  }
  // Claim-on-read (#1328): from here on the request is ours to report, success or failure.
  const start = await claimStart(to)
  if (!sessions.length && !start) return { ok: true, reason: 'nothing to drive: no recent cloud sessions, no session to create' }

  const tab = await ensureDriverTab()
  const ids = sessions.map(s => s.id)
  if (ids.length && Date.now() - lastReloadAt >= LIST_REFRESH_MS) await reloadDriver(tab.id)
  const read = ids.length ? await askDriver(tab.id, { type: 'oa-read-list', ids }) : { ok: true, statuses: [] }
  if (!read.ok) {
    // A Driver still busy with an earlier cycle's drive is left alone, claim included: the claim
    // expires on the daemon and the request is offered again once the page is free.
    if (start && !read.busy) await reportStarted(to, start.id, { ok: false, note: read.note })
    return { ok: false, reason: read.note ?? 'the Driver could not read the session list' }
  }
  const statuses = Array.isArray(read.statuses) ? read.statuses : []
  if (statuses.length) {
    await to.post('/_bridge/statuses', { statuses: statuses.map(({ sessionId, status, label }) => ({ sessionId, status, ...(label ? { label } : {}) })) })
  }

  const now = Date.now()
  const planned = planVisits(statuses, answers, seen, now)
  // Answers first, then a bounded handful of the due sessions; what is cut waits for the next
  // beat, with the change that made it due kept pending below.
  const visits = [...planned.filter(v => v.answer), ...planned.filter(v => !v.answer)].slice(0, MAX_VISITS)
  for (const visit of visits) if (visit.answer) deliveredAnswers.add(visit.answer.id)
  const driven =
    visits.length || start
      ? await askDriver(tab.id, {
          type: 'oa-drive',
          visits,
          ...(start ? { start: { repo: start.repo, branch: start.branch, prompt: start.prompt, ...(typeof start.model === 'string' ? { model: start.model } : {}) } } : {}),
        })
      : { ok: true, visited: [], delivered: [] }
  if (driven.busy) {
    // The page is still on an earlier cycle's drive — a worker that ended mid-cycle leaves the
    // page driving. Nothing was handed over, so nothing is claimed, acknowledged or reported; the
    // next beat tries again, and the daemon's claim on the session request expires on its own.
    for (const visit of visits) if (visit.answer) deliveredAnswers.delete(visit.answer.id)
    return { ok: false, reason: driven.note ?? 'the Driver is still busy with an earlier cycle' }
  }
  const visited = Array.isArray(driven.visited) ? driven.visited : []
  const delivered = Array.isArray(driven.delivered) ? driven.delivered : []
  remember(statuses, planned, visited, now)
  await accountForAnswers(to, visits, driven, delivered)
  if (start) await reportStarted(to, start.id, driven.started ?? { ok: false, note: driven.note ?? 'the Driver did not create the session' })

  const counts = {
    awaiting: statuses.filter(s => s.status === 'awaiting').length,
    unread: statuses.filter(s => s.status === 'unread').length,
    missing: statuses.filter(s => s.status === 'missing').length,
  }
  return {
    ok: driven.ok !== false,
    reason: `read ${statuses.length} of ${ids.length} (${counts.awaiting} awaiting, ${counts.unread} unread, ${counts.missing} missing), visited ${visited.length}${planned.length > visits.length ? ` of ${planned.length} due` : ''}, typed ${delivered.filter(d => d.ok).length}${start ? `, created ${driven.started?.ok ? driven.started.sessionId : 'nothing: ' + (driven.started?.note ?? driven.note ?? 'unknown')}` : ''}${driven.note ? `; ${driven.note}` : ''}`,
  }
}

/**
 * What the list said, kept for the next cycle's planVisits. A session planned but not reached this
 * beat — cut by the cap, or a visit that failed — keeps its earlier status, so the change that
 * made it due is still a change next time.
 */
function remember(statuses, planned, visited, now) {
  const unreached = id => planned.some(v => v.id === id) && !visited.some(v => v.id === id && v.ok)
  for (const { sessionId, status } of statuses) {
    if (unreached(sessionId)) continue
    const before = seen.get(sessionId)
    seen.set(sessionId, { status, visitedAt: visited.some(v => v.id === sessionId && v.ok) ? now : (before?.visitedAt ?? 0) })
  }
}

/**
 * Every answer handed over to the Driver, accounted for. A delivery the page attempted is
 * acknowledged as it reported it, sent or failed. One the visit never got to — the session not on
 * the list, the page not becoming it, a Driver that did not answer — stays queued on the daemon
 * and is released here, so the next beat tries again. The one exception is a page torn down
 * mid-drive: its answer may already be typed, so that is acknowledged as failed with a note
 * saying to check the session before picking again.
 */
async function accountForAnswers(to, visits, driven, delivered) {
  for (const visit of visits) {
    if (!visit.answer) continue
    const outcome = delivered.find(d => d.id === visit.answer.id)
    if (!outcome && !driven.tornDown) {
      deliveredAnswers.delete(visit.answer.id)
      continue
    }
    const delivery = outcome ?? { sessionId: visit.id, id: visit.answer.id, ok: false, note: driven.note }
    if (!delivery.ok) deliveredAnswers.delete(visit.answer.id)
    await ack(to, { sessionId: delivery.sessionId, id: delivery.id, ok: Boolean(delivery.ok), ...(delivery.note ? { note: String(delivery.note).slice(0, 300) } : {}) })
  }
}

/** Report what a creation attempt did (#1328); the daemon's claim expires on its own if this never lands. */
async function reportStarted(to, id, outcome) {
  const ok = Boolean(outcome?.ok && outcome?.sessionId)
  try {
    await to.post('/_bridge/started', {
      id,
      ok,
      ...(ok ? { sessionId: outcome.sessionId } : {}),
      ...(outcome?.note ? { note: String(outcome.note).slice(0, 1500) } : {}),
    })
  } catch {
    // The claim expires on the daemon, and the request is offered again.
  }
}

/** The options page's button: resume a paused Driver and run a cycle now. */
async function openDriverNow() {
  await driverState.set({ driverPaused: false })
  return cycle()
}

// Closing the Driver tab is the user saying stop: the bridge pauses until they reopen it from
// the options page or restart the browser, rather than the tab reappearing half a minute later.
// Closing the window it sits in is not that — Chrome keeps running without a window — so the
// tab is merely forgotten and reopened in the next one.
chrome.tabs.onRemoved.addListener(async (tabId, info) => {
  if (tabId !== (await driverTabId())) return
  await driverState.set({ driverTabId: null, driverPaused: !info.isWindowClosing })
})

// An alarm rather than setInterval: an MV3 service worker is terminated when idle, and a timer
// dies with it. Alarms wake it back up. One beat for everything: a person may be sitting at the
// dashboard watching an answer's spinner, and a run may be waiting for its session.
chrome.alarms.create('oa-cycle', { periodInMinutes: CYCLE_MINUTES })
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'oa-cycle') void beat()
})

// ---------------------------------------------------------------------------
// Reloading itself when its files change (#1711). The extension is unpacked and edited in place,
// and Chrome re-reads its files only on a reload; that used to be a click on chrome://extensions
// after every change. The worker can read its own files as they are on disk, so it takes their
// fingerprint at start and compares each beat. Reloading orphans the content script in the
// Driver tab, which the next cycle's page load replaces, as after a manual reload.
//
// One thing to know: with developer mode switched off on chrome://extensions, Chrome (137 and
// later) disables an unpacked extension on reload instead of reloading it, and only a click on
// chrome://extensions brings it back. The mode is on for anyone who loaded the extension
// unpacked; leave it on.

/** The files' hashes when this worker started, or undefined until the first read succeeds. */
let filesAtStart

/** The extension's own file as it is on disk now. */
const readOwnFile = file => fetch(chrome.runtime.getURL(file)).then(res => res.text())

/** The watched files that changed since this worker started; none while a read fails. */
async function filesChanged() {
  try {
    const now = await fingerprint(readOwnFile)
    if (!filesAtStart) {
      filesAtStart = now
      return []
    }
    return changedFiles(filesAtStart, now)
  } catch {
    return []
  }
}

/**
 * One beat: reload the extension if its files changed, else run a cycle. Never mid-cycle — a
 * reload would kill a drive with answers handed over and unaccounted for — so a beat that lands
 * on a running cycle merely does nothing, and the next one checks again. The reload is recorded
 * as the last cycle's outcome, so the options page can say why the worker restarted.
 */
async function beat() {
  if (cycling) return
  const changed = await filesChanged()
  if (changed.length === 0 || cycling) return cycle()
  await note({ ok: true, reason: `reloading the extension: ${changed.join(', ')} changed on disk` })
  chrome.runtime.reload()
}

void filesChanged()
void cycle()
