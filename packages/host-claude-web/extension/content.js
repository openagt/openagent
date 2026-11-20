// The page half of the Claude web bridge (#1237): find the question a cloud session is parked
// on, and hand it to the service worker, which is the only part that talks to the daemon.
//
// The token and the fetch deliberately live in the worker, not here. A content script shares a
// tab with claude.ai, so nothing in this file should ever hold the secret that talks to a
// daemon, and a fetch from here would carry the page's origin into a CORS check the daemon
// refuses on purpose.
//
// Four rounds of a read-only spike shaped the extraction below, and each failure is worth
// keeping because each was a different obstacle:
//   1. the page has <code> blocks with no <pre>, so a `pre code` selector examined nothing
//   2. the message body sits behind shadow roots, so document.body.innerText never saw it
//   3. fixed prefixes guessed an indentation nobody promised, so brace matching replaced them
//   4. our own system prompt renders on the page, so its await-choices spec is a decoy
//
// `check.mjs` covers all four offline, in jsdom, with no browser and no live session.

const POLL_MS = 2000
// How many surveys this page has run; read by the offline harness (check.mjs) to prove one page
// change costs one survey (#1707).
let surveys = 0

// Every observer `watch` runs, so the script's own drawing can pause them (#1707): the corner
// panel and the Driver overlay live under the observed root, and without the pause each survey's
// redraw was the next survey's trigger — a full survey about four times a second, forever, on a
// page where nothing had changed.
const watchers = new Set()
const OBSERVED = { childList: true, subtree: true, characterData: true }
let drawing = 0

/** Run `draw`, which writes the script's own elements, without the observers taking it for a page change. */
function ownWrites(draw) {
  if (drawing++ === 0) for (const observer of watchers) observer.disconnect()
  try {
    draw()
  } finally {
    if (--drawing === 0) for (const observer of watchers) observer.observe(document.documentElement, OBSERVED)
  }
}
/** The on-page panel's element id. */
const PANEL_ID = 'oa-bridge-panel'
const IS_TOP = window.top === window

/** The cloud session this page is showing, which is the key the daemon joins runs on. */
function sessionIdFromUrl() {
  const match = /\/code\/(session_[A-Za-z0-9]+)/.exec(location.href)
  return match ? match[1] : undefined
}

/** This extension's version, which tells a stale script from a current one; `?` with no extension runtime, as in check.mjs. */
function extensionVersion() {
  return typeof chrome !== 'undefined' && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : '?'
}

/** Whether there is a worker to send to: an extension runtime, which check.mjs's jsdom lacks. */
function hasWorker() {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage)
}

/**
 * Hand `message` to the service worker, the only part that talks to the daemon; `onReply(reply,
 * error)` hears its answer, or why there is none. Nothing is sent where there is no worker, and a
 * send that throws (the worker asleep, a context an extension reload invalidated) is an error
 * handed to `onReply`: a page that cannot reach the daemon must still show its panel rather than
 * throw inside a DOM observer.
 */
function toWorker(message, onReply = () => {}) {
  if (!hasWorker()) return
  try {
    chrome.runtime.sendMessage(message, reply => {
      // Read in every reply, or Chrome logs the error as unchecked.
      const failed = chrome.runtime.lastError
      if (failed) onReply(undefined, failed.message ?? 'worker unreachable')
      else onReply(reply, undefined)
    })
  } catch (err) {
    onReply(undefined, String(err?.message ?? err))
  }
}

/** What the daemon last said about our report, so the panel can say why nothing arrived. */
let bridgeStatus = 'not sent yet'

/** Hand a found question to the service worker, which owns the token and the fetch. */
function reportToDaemon(parsed) {
  const sessionId = sessionIdFromUrl()
  if (!sessionId) return
  // The block's own shape (#1554): `multi`, and per option `default` and `stop`, travel with
  // the labels so the dashboard renders the gate as a local one and a stopping pick is typed
  // back as a hand-over rather than a continuation.
  const question = {
    sessionId,
    title: String(parsed.title ?? '').slice(0, 500),
    options: (parsed.options ?? [])
      .map(o =>
        typeof o === 'string'
          ? { label: o }
          : {
              label: String(o?.label ?? ''),
              ...(o?.detail ? { detail: String(o.detail).slice(0, 500) } : {}),
              ...(o?.default === true ? { default: true } : {}),
              ...(o?.stop === true ? { stop: true } : {}),
            },
      )
      .filter(o => o.label)
      .slice(0, 20),
    ...(parsed.recommended ? { recommended: String(parsed.recommended) } : {}),
    ...(parsed.multi === true ? { multi: true } : {}),
  }
  if (!question.title || !question.options.length) return
  // Offline (check.mjs, no extension runtime): expose what would have been posted, so the
  // harness can pin the shape the daemon receives, not just the panel's summary of it.
  if (typeof chrome === 'undefined') window.__oaBridgeQuestion = question
  toWorker({ type: 'oa-question', question }, (reply, error) => {
    // Silence here was the first thing to go wrong live: the worker answered "no token set"
    // and nobody ever saw it, so a configured-looking extension simply did nothing.
    if (error !== undefined) bridgeStatus = error
    else if (!reply) bridgeStatus = 'no reply from the worker'
    else if (reply.ok) bridgeStatus = reply.skipped ? `sent (${reply.skipped})` : 'sent'
    else bridgeStatus = reply.error ?? 'failed'
  })
}

/**
 * What we last sent per session and position, so an unchanged message is not re-posted on every
 * mutation. Keyed by session too, because the Driver tab moves between sessions inside one page
 * (#1332) and a position alone would collide across them.
 */
const sentEvents = new Map()

/** What happened to the last transcript report, for the panel. */
let transcriptStatus = 'not sent yet'

/**
 * Where claude.ai marks the conversation's turns (#1225).
 *
 * The page renders no `<article>` elements — the session's transcript is a `role="feed"` of
 * `transcript-row` elements, one per turn, each naming its position (`data-index`) and its kind
 * (`data-perf-row`: `human`, `assistant`, or a `marker` such as "Resumed session"). The list is
 * virtual, so a long session only keeps its tail in the DOM; the position is what lets the daemon
 * keep one copy per turn regardless of which turns happen to be rendered.
 */
const TURN_ROW = '[data-testid="transcript-row"]'
/** Which row kinds are conversation; every other kind (markers) is left out of the mirror. */
const TURN_ROLES = { human: 'user', assistant: 'agent' }

function turnRows() {
  return deepQueryAll(TURN_ROW)
}

/** The opening message: the run's own prompt, which quotes our whole protocol (#1568). */
function openingMessage() {
  return turnRows().find(row => row.getAttribute('data-index') === '0')
}

/**
 * The transcript, one entry per conversation turn (#1225).
 *
 * Each turn carries up to 8000 characters from its start. Only the opening turn — the run's
 * prompt — is ever that long; a reply that is still streaming is sent as it grows and replaced
 * in place, since the daemon keys entries by position.
 */
function transcript() {
  return turnRows().flatMap(row => {
    const role = TURN_ROLES[row.getAttribute('data-perf-row')]
    const seq = Number(row.getAttribute('data-index'))
    if (!role || !Number.isInteger(seq) || seq < 0) return []
    const text = cleanText(row.innerText ?? row.textContent ?? '')
    return text ? [{ seq, role, text: text.slice(0, 8000) }] : []
  })
}

/** Private-use codepoints are icon-font glyphs, which carry no meaning outside their font. */
const ICON_GLYPHS = /[\uE000-\uF8FF]/g

/** A turn's text as prose: no icon glyphs, no blank lines, no leading or trailing whitespace. */
function cleanText(text) {
  return text
    .replace(ICON_GLYPHS, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

/**
 * Tell the daemon what this injected script is and what it just saw.
 *
 * Diagnosis kept requiring a screenshot of the panel, so every wrong guess cost a round trip
 * through a person. This says it directly: which version is running in the page, and what the
 * last scrape found.
 */
function sayHello(sessionId, note) {
  toWorker({ type: 'oa-hello', sessionId, version: extensionVersion(), note }, reply => {
    // The worker's reply says whether this tab is the Driver (#1332): the overlay goes up
    // the moment the page loads, not when the first cycle reaches it.
    if (reply?.driver) becomeDriver()
  })
}

/**
 * Post whatever changed since the last look. Only what changed: the observer fires on every DOM
 * mutation and a session's transcript is mostly stable, so sending it all each time would be a
 * few hundred kilobytes a second for no new information.
 */
function reportTranscript() {
  const sessionId = sessionIdFromUrl()
  if (!sessionId) return
  const rows = turnRows()
  const blocks = transcript()
  // Offline (check.mjs, no extension runtime): expose what would have been posted.
  if (typeof chrome === 'undefined') window.__oaBridgeTranscript = blocks
  if (!rows.length) {
    // Named, not guessed at: a page with no turn rows is a layout the mirror does not know, and
    // saying so beats mirroring whatever text happens to be on screen.
    transcriptStatus = 'no transcript rows found'
    sayHello(sessionId, `rows 0, ${transcriptStatus}`)
    return
  }
  const kinds = [...new Set(rows.map(row => row.getAttribute('data-perf-row') ?? '?'))].join(',')
  sayHello(sessionId, `rows ${rows.length} (${kinds}), turns ${blocks.length}, ${transcriptStatus}`)
  if (!hasWorker()) return
  const events = blocks.filter(event => sentEvents.get(`${sessionId}#${event.seq}`) !== event.text)
  if (!events.length) {
    transcriptStatus = `${blocks.length} turn(s), unchanged`
    return
  }
  toWorker({ type: 'oa-events', sessionId, events }, (reply, error) => {
    // Only remember what the daemon actually took, so a rejected batch is retried by the next
    // page change.
    if (reply?.ok) {
      for (const event of events) sentEvents.set(`${sessionId}#${event.seq}`, event.text)
      transcriptStatus = `sent ${events.length} of ${blocks.length} turn(s)`
    } else {
      transcriptStatus = error ?? reply?.error ?? 'failed'
    }
  })
}

/** Every element matching a selector, including inside open shadow roots. */
function deepQueryAll(selector, root = document, seen = new Set()) {
  const out = [...root.querySelectorAll(selector)]
  for (const el of root.querySelectorAll('*')) {
    if (!el.shadowRoot || seen.has(el)) continue
    seen.add(el)
    out.push(...deepQueryAll(selector, el.shadowRoot, seen))
  }
  return out
}

/** How many open shadow roots exist, which tells us whether that is where content hides. */
function countShadowRoots(root = document, seen = new Set()) {
  let n = 0
  for (const el of root.querySelectorAll('*')) {
    if (!el.shadowRoot || seen.has(el)) continue
    seen.add(el)
    n += 1 + countShadowRoots(el.shadowRoot, seen)
  }
  return n
}

/** Page text including shadow content, which plain body.innerText misses. */
function deepText() {
  let text = document.body?.innerText ?? ''
  for (const host of deepQueryAll('*')) {
    if (host.shadowRoot) text += `\n${host.shadowRoot.textContent ?? ''}`
  }
  return text
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Wait for `read` to return something truthy, or give up. */
async function waitFor(read, timeoutMs, stepMs = 150) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = read()
    if (value) return value
    if (Date.now() >= deadline) return undefined
    await sleep(stepMs)
  }
}

/**
 * Our own await-protocol spec is part of the system prompt, and the page renders the prompt,
 * so a session shows a JSON block with `options` before the agent has asked anything. Its
 * values are the spec's placeholders. Round 3 extracted exactly that and reported
 * `<the question>` as the question, which is the decoy working as designed.
 *
 * Two more decoys slipped that net on a live session (#1568). The browser-handoff example's
 * title is placeholders *plus punctuation* — `<what…> (<the page…>)` — so the whole-string
 * placeholder test missed it, and its labels are literal. And the approval example is literal
 * end to end (`Ship this?`, Approve/Decline), which no placeholder heuristic can catch — it is
 * matched verbatim instead, accepting that an agent asking the doc's exact sample question
 * word-for-word loses (it was told to put a real title there).
 */
function isTemplate(parsed) {
  const placeholder = v => typeof v === 'string' && /^<.*>$/.test(v.trim())
  const title = typeof parsed.title === 'string' ? parsed.title : ''
  if (placeholder(title)) return true
  // Placeholders joined by punctuation only: strip every <…> group; a title with no letters
  // left is the spec talking, while a real title mentioning `<SESSION_NAME>` keeps its words.
  if (/<[^<>]+>/.test(title) && !/\p{L}/u.test(title.replace(/<[^<>]*>/g, ''))) return true
  const labels = parsed.options.map(o => (typeof o === 'string' ? o : o?.label))
  if (labels.length > 0 && labels.every(placeholder)) return true
  const set = labels.filter(l => typeof l === 'string').join('|')
  // The two literal examples the protocol ships, verbatim.
  if (set === 'Handled it|Could not handle it') return true
  if (title === 'Ship this?' && set === 'Approve|Decline') return true
  return false
}

/**
 * Whether an element renders inside the transcript's opening message, crossing shadow
 * boundaries on the way up. The page opens with the run's prompt — which quotes our whole
 * protocol, examples included — so nothing inside that first message is ever a question the
 * session asked (#1568). Roots are walked via their host so a block inside a shadowed
 * highlighter still resolves to the turn row that carries it.
 */
function inFirstMessage(el, first) {
  if (!first) return false
  // A shadow tree's top parent is its ShadowRoot, whose `host` re-enters the outer tree.
  for (let node = el; node; node = node.parentNode ?? node.host ?? null) {
    if (node === first) return true
  }
  return false
}

/**
 * Every JSON object carrying `options` in the text, in the order they appear, brace-matched out of
 * whatever surrounds them. `stats`, when given, counts the candidates and those that did not
 * parse, and keeps the last one's error.
 *
 * Round 2 reached the text but could not read it, because matching on the fixed prefixes
 * `{"title"` and `{\n  "title"` guesses at an indentation nobody promised, and the block
 * arrives with prose around it. Strings and escapes are tracked so a brace inside a label
 * cannot close the object early.
 */
function extractChoices(text, stats) {
  const found = []
  if (!text.includes('"options"')) return found
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    let depth = 0
    let inString = false
    let escaped = false
    for (let j = i; j < text.length; j++) {
      const ch = text[j]
      if (escaped) {
        escaped = false
        continue
      }
      if (ch === '\\') {
        escaped = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth > 0) continue
        const slice = text.slice(i, j + 1)
        if (slice.includes('"options"')) {
          if (stats) stats.candidates++
          try {
            const parsed = JSON.parse(slice)
            if (Array.isArray(parsed.options)) {
              found.push(parsed)
              // Keep scanning past this object: the spec comes first and the real question
              // after it, so the last one is the one that matters.
              i = j
            }
          } catch (err) {
            // Not this one, or still streaming. Record why, so a failing report says whether
            // the block was never found or found and unparseable.
            if (stats) {
              stats.parseErrors++
              stats.lastError = String(err.message ?? err).slice(0, 80)
            }
          }
        }
        break
      }
    }
  }
  return found
}

/**
 * The transcript row an element renders in, looking out through any shadow roots it sits behind:
 * the rows are in the light DOM while a message's body is not.
 */
function rowOf(el) {
  for (let node = el; node; node = node.getRootNode?.()?.host) {
    const row = node.closest?.(TURN_ROW)
    if (row) return row
  }
  return undefined
}

/**
 * Whether the user has already answered past that row: a human turn at a later position means
 * the question was taken and the session moved on, however long the answered block stays on the
 * page (#1703). A block not placed in any row is measured from the session's latest turn instead.
 * With no positioned turns at all there is nothing to measure against, and the block stands.
 */
function answeredAfter(row) {
  const rows = turnRows()
  const position = r => Number(r.getAttribute('data-index'))
  const kind = r => r.getAttribute('data-perf-row')
  const at = row ? position(row) : Math.max(-1, ...rows.filter(r => kind(r) === 'assistant').map(position))
  if (!Number.isInteger(at) || at < 0) return false
  return rows.some(r => kind(r) === 'human' && position(r) > at)
}

/** Why the last survey reported no question when a block was on the page, for the panel. */
let choiceNote = ''

/**
 * The question a parked run is waiting on. Our agents emit it as a fenced JSON block carrying
 * `options`. Element-scoped first so the winner names where it was found, then the whole page
 * as a fallback for a block split across elements by a syntax highlighter. A block the user has
 * already answered — a human turn follows it — is not pending, whatever any store remembers: the
 * daemon forgets what was answered when it restarts, and re-asking would type a second answer
 * into a session that moved on (#1703).
 */
function findPendingChoice() {
  choiceNote = ''
  // `code` on its own: the page has <code> blocks with no <pre> wrapper (round 1), and they
  // sit inside shadow roots (round 2). DOM order tracks transcript order, so the last real
  // question wins over both the spec and any earlier answered one.
  // The opening message is the run's own prompt, which quotes the whole protocol — examples
  // included — so blocks inside it are documentation, never the session asking (#1568). A
  // virtual list may have scrolled that row out of the DOM, in which case its decoys are gone
  // with it and isTemplate alone stands.
  const firstMessage = openingMessage()
  const fromElements = []
  for (const el of deepQueryAll('pre code, pre, code')) {
    if (inFirstMessage(el, firstMessage)) continue
    for (const parsed of extractChoices(el.textContent ?? '')) {
      fromElements.push({ via: el.tagName.toLowerCase(), parsed, row: rowOf(el) })
    }
  }
  // The page-text fallback reads everything, opening message included, so any block that also
  // renders inside that first message is subtracted from it by value.
  const inPrompt = new Set(extractChoices(firstMessage?.textContent ?? '').map(p => JSON.stringify(p)))
  const candidates = fromElements.length
    ? fromElements
    : extractChoices(deepText())
        .filter(parsed => !inPrompt.has(JSON.stringify(parsed)))
        .map(parsed => ({ via: 'page-text', parsed }))
  const real = candidates.filter(c => !isTemplate(c.parsed))
  const last = real.at(-1)
  const answered = Boolean(last) && answeredAfter(last.row)
  if (answered) choiceNote = 'already answered'
  const found = answered ? undefined : last
  if (found) reportToDaemon(found.parsed)
  reportTranscript()
  return found ?? undefined
}

/** The box an answer is typed into. */
function findComposer() {
  const editable = deepQueryAll('div[contenteditable="true"]')[0]
  if (editable) return { via: 'contenteditable', el: editable }
  const textarea = deepQueryAll('textarea')[0]
  if (textarea) return { via: 'textarea', el: textarea }
  return undefined
}

/** What the last delivery attempt did, for the panel. */
let answerStatus = 'none delivered'

/** Put text in the composer. execCommand is what the live page accepts; jsdom has no such thing. */
function fillComposer(composer, text) {
  if (composer.via === 'textarea') {
    composer.el.value = text
    composer.el.dispatchEvent(new Event('input', { bubbles: true }))
    return
  }
  composer.el.focus()
  let inserted = false
  try {
    inserted = document.execCommand('insertText', false, text)
  } catch {
    inserted = false
  }
  if (!inserted) {
    // The offline harness lands here; a real ProseMirror/Lexical editor may ignore it, which the
    // submit check below would surface as an empty send.
    composer.el.textContent = text
    composer.el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  }
}

/** The button that sends the composer, wherever the page keeps it this week. */
function findSendButton() {
  const labelled = deepQueryAll('button[aria-label]').filter(
    b => /send/i.test(b.getAttribute('aria-label') ?? '') && !b.disabled,
  )
  // The last one: pages render hidden or historical buttons above the live composer's.
  return labelled.at(-1) ?? deepQueryAll('button[type="submit"]').at(-1)
}

/** Type `text` into the composer and send it: with the send button, or Enter on a page that shows none. Says which. */
async function submitComposer(composer, text) {
  fillComposer(composer, text)
  // Let the editor's own event handling settle before submitting, or the click sends nothing.
  await sleep(400)
  const button = findSendButton()
  if (button) {
    button.click()
    return 'button'
  }
  for (const type of ['keydown', 'keyup']) {
    composer.el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }))
  }
  return 'enter'
}

/**
 * Type the dashboard's pick into the composer and submit it (#1237).
 *
 * Here the extension speaks for the user rather than observing, so it reports exactly what it
 * did: which fill path, and whether the send was a button click or an Enter fallback. The text
 * only ever comes from the daemon, which only accepts a label of the parked question, so what
 * can be typed here is bounded by what the session itself offered.
 */
async function deliverAnswer(text) {
  // Wait for the composer rather than failing on its absence: the first live delivery landed
  // right after a tab revive, and claude.ai takes well over the naive 5 seconds to render, so
  // "no composer on the page" mostly means "not yet". The harness shortens the wait.
  const composer = await waitFor(findComposer, window.__oaComposerWaitMs ?? 20000, 500)
  if (!composer) {
    answerStatus = 'failed: no composer on the page'
    return { ok: false, note: 'no composer on the page' }
  }
  const sent = await submitComposer(composer, text)
  answerStatus = `sent via ${composer.via} + ${sent}`
  return { ok: true, note: sent === 'button' ? `filled ${composer.via}, clicked send button` : `filled ${composer.via}, no send button, sent Enter` }
}

// ---------------------------------------------------------------------------
// Creating a session (#1328). A session created through this page's repo picker is repo-bound,
// and those are the ones that can push and open a pull request (#1320). So the daemon queues a repo, a branch and a prompt,
// and this drives the same controls a person would on the new-session page: the repo chip and
// its searchable list, the branch chip that appears beside it, the composer, send.
//
// Every selector here is a guess about someone else's UI, so this half reports rather than
// insists: `probeNewSession` describes what the page offers without touching it, and every
// failure below names the control it could not find.

/**
 * Visible text of a control, for matching chips and entries: the icon-font glyphs the page puts
 * beside a label (a repo icon, a branch icon, the check on the chosen entry) are dropped, since
 * "openagt/openagent" followed by a check glyph is the entry, not another entry.
 */
function controlText(el) {
  return (el.textContent ?? '').replace(ICON_GLYPHS, '').replace(/\s+/g, ' ').trim()
}

/**
 * Whether a control is actually usable: rendered, enabled, not aria-hidden. The page keeps a
 * closed picker's entries in the DOM, so an entry that is not visible is not on offer — a browser
 * answers that exactly; the offline harness has no layout and answers nothing, which counts as yes.
 */
function usable(el) {
  if (!el || el.disabled) return false
  if (el.getAttribute?.('aria-hidden') === 'true') return false
  if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return false
  return true
}

/** Every button-like control on the page, most explicit picker shapes first. */
function menuTriggers() {
  const out = []
  const add = (el, via) => {
    if (usable(el) && !out.some(entry => entry.el === el)) out.push({ el, via, text: controlText(el) })
  }
  for (const el of deepQueryAll('button[role="combobox"]')) add(el, 'combobox')
  for (const el of deepQueryAll('button[aria-haspopup="listbox"], button[aria-haspopup="menu"], button[aria-haspopup="true"]')) add(el, 'haspopup')
  for (const el of deepQueryAll('button[aria-expanded]')) add(el, 'expandable')
  for (const el of deepQueryAll('button')) add(el, 'button')
  return out
}

/**
 * The composer's chips, in the order the page lays them out: the repository, then the branch,
 * then "add another repository". Each is a combobox button; the branch chip exists only once a
 * repository is chosen.
 */
function chips() {
  return deepQueryAll('button[role="combobox"]').filter(usable).map(el => ({ el, via: 'combobox', text: controlText(el) }))
}

/** What the chips read, for a note that says what the page showed. */
const chipTexts = () => JSON.stringify(chips().map(c => c.text))

/** The entries an open picker currently offers — visible options only, the closed ones stay in the DOM. */
function menuEntries() {
  return deepQueryAll('[role="option"]')
    .filter(usable)
    .map(el => ({ el, text: controlText(el) }))
}

/** The open picker's search box, if it has one. */
function pickerSearch() {
  return deepQueryAll('input[role="combobox"], input[type="search"], input[placeholder*="search" i]').filter(usable).at(-1)
}

/** Type into a React-controlled input so the page sees the change: the native setter, then an input event. */
function typeInto(input, text) {
  input.focus()
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter) setter.call(input, text)
  else input.value = text
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** How long to wait for a picker to render its entries, and for the chips to settle. */
const MENU_WAIT_MS = 6000

/**
 * Open `trigger` and choose the entry whose text is one of `wanted` (lower-cased; the first is
 * the full name, later ones aliases). Types the full name into the picker's search box when it
 * has one, since a long list is filtered rather than scrolled. Never clicks the trigger itself
 * or anything inside it as an entry. Returns a note either way.
 */
async function chooseFrom(trigger, wanted, hint) {
  trigger.el.click()
  const outside = e => e.el !== trigger.el && !trigger.el.contains(e.el)
  const entries = () => menuEntries().filter(outside)
  const find = () => {
    const now = entries()
    for (const w of wanted) {
      const exact = now.find(e => e.text.toLowerCase() === w)
      if (exact) return exact
    }
    return undefined
  }
  // The list is fetched after the picker opens: wait for it to hold something before filtering
  // it, and filter only when it has a search box. A filter that finds nothing is cleared and the
  // whole list scanned, in case the page's search matches differently than expected.
  const search = await waitFor(pickerSearch, 1500, 100)
  const loaded = await waitFor(() => entries().length > 0, MENU_WAIT_MS)
  let hit = loaded ? find() : undefined
  if (!hit && search) {
    typeInto(search, wanted[0])
    hit = await waitFor(find, 3000)
    if (!hit) {
      typeInto(search, '')
      hit = await waitFor(find, 3000)
    }
  }
  if (!hit) {
    const seen = entries()
    const diag = `search ${search ? `"${search.placeholder}"` : 'none'}, ${seen.length} visible of ${deepQueryAll('[role="option"]').length} options${seen.length ? `: ${seen.slice(0, 5).map(e => JSON.stringify(e.text.slice(0, 40))).join(', ')}` : ''}; chips ${chipTexts()}`
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return { ok: false, note: `${hint}: the list offered no "${wanted[0]}" (${diag})` }
  }
  hit.el.click()
  return { ok: true, note: `${hint}: clicked "${hit.text}" via ${trigger.via}` }
}

// The model (#1697). The page's model picker is a menu button beside the composer reading the
// current model — "Opus 5" — and its menu lists the models as radio items, each label beside a
// hidden keyboard-shortcut digit and, on the current one, a hidden check glyph; a "More models"
// item opens a submenu of older versions. A run started with a model must run on it, so when the
// request names one it is picked before anything is sent, and a menu that does not offer it, or
// a page with no picker, fails the creation rather than sending on whatever the page defaults to.

/** A model name as the dashboard sends it: `opus`, or a full label such as `Opus 4.8`. */
const MODEL_WORDS = /\b(fable|opus|sonnet|haiku)\b/i

/** The model picker's trigger: the menu button reading a model name. Not a chip, so the chips' order is untouched. */
function modelTrigger() {
  return menuTriggers().find(t => t.el.getAttribute('aria-haspopup') === 'menu' && MODEL_WORDS.test(t.text))
}

/**
 * A control's label without its decorations: the hidden shortcut digit and check glyph the page
 * puts beside a model's name are not part of it, so "Sonnet 5" is read, not "Sonnet 53".
 */
function labelText(el) {
  const parts = []
  const walk = node => {
    if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent)
    else if (node.nodeType === Node.ELEMENT_NODE && node.getAttribute('aria-hidden') !== 'true' && node.tagName !== 'KBD') node.childNodes.forEach(walk)
  }
  walk(el)
  return parts.join('').replace(ICON_GLYPHS, '').replace(/\s+/g, ' ').trim()
}

/** The models the open menu offers, by label. */
function modelEntries() {
  return deepQueryAll('[role="menuitemradio"]')
    .filter(usable)
    .map(el => ({ el, text: labelText(el) }))
}

/** Whether a label names the wanted model: the whole label, or the model's word in it — "opus" reads "Opus 5". */
function readsModel(text, wanted) {
  const label = text.toLowerCase()
  return label === wanted || new RegExp(`(^|[^a-z0-9])${wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(label)
}

/**
 * Open the model menu and click the entry for `wanted` (lower-cased): the exact label first, else
 * the first entry carrying its word, which is the newest version, since the menu lists the current
 * versions and keeps older ones behind "More models" — searched too when the menu itself offers
 * nothing. Returns a note either way; nothing is clicked as an entry that is not one.
 */
async function chooseModel(trigger, wanted) {
  trigger.el.click()
  const entries = () => modelEntries().filter(e => e.el !== trigger.el && !trigger.el.contains(e.el))
  const find = () => {
    const now = entries()
    return now.find(e => e.text.toLowerCase() === wanted) ?? now.find(e => readsModel(e.text, wanted))
  }
  const loaded = await waitFor(() => entries().length > 0, MENU_WAIT_MS)
  let hit = loaded ? find() : undefined
  let via = 'menu'
  if (!hit) {
    const more = deepQueryAll('[role="menuitem"][aria-haspopup="menu"]').filter(usable).find(el => /more models/i.test(labelText(el)))
    if (more) {
      const before = entries().length
      more.click()
      if (await waitFor(() => entries().length > before, MENU_WAIT_MS)) {
        hit = find()
        via = 'More models'
      }
    }
  }
  if (!hit) {
    const seen = entries()
    const diag = `${seen.length} entries${seen.length ? `: ${seen.slice(0, 12).map(e => JSON.stringify(e.text.slice(0, 40))).join(', ')}` : ''}`
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    return { ok: false, note: `model: the menu offered no "${wanted}" (${diag})` }
  }
  hit.el.click()
  return { ok: true, note: `model: clicked "${hit.text}" via ${via}` }
}

/**
 * Describe the controls on this page without touching any of them. Text only, capped, so the
 * report is safe to paste into an issue — the point is that a failed first run says what the
 * page offers, so the selectors above can be aimed at the real markup.
 */
function probeNewSession() {
  return {
    url: location.href,
    sessionId: sessionIdFromUrl() ?? null,
    composer: findComposer()?.via ?? null,
    sendButton: Boolean(findSendButton()),
    model: modelTrigger()?.text ?? null,
    chips: chips().map(c => c.text.slice(0, 80)),
    triggers: menuTriggers()
      .slice(0, 40)
      .map(trigger => ({ via: trigger.via, text: trigger.text.slice(0, 80) }))
      .filter(trigger => trigger.text),
  }
}

/**
 * Drive the new-session flow: repo, branch, model, prompt, send, and report the session it became.
 *
 * The page remembers the last repository picked, so it may open already showing ours, another
 * one, or none — the chips are waited for and read rather than assumed. The branch is checked,
 * not assumed: the branch chip must read the requested ref before anything is sent, because a
 * session opened on the wrong branch would push its work somewhere the run never looks. The
 * model, when the request names one, is checked the same way (#1697): the picker must read it
 * before anything is sent, since a session on the page's default model is the choice silently
 * dropped. The session id is read from the URL, the one thing the page is guaranteed to tell us
 * and exactly what the daemon joins runs on; a send that never becomes a session URL is a
 * failure with a reason, never a silent success.
 */
async function createSession({ repo, branch, prompt, model }) {
  const composer = await waitFor(findComposer, window.__oaComposerWaitMs ?? 20000)
  if (!composer) return { ok: false, note: 'no composer on the new-session page' }

  const bare = String(repo).split('/').pop() ?? repo
  const repoWanted = [String(repo).toLowerCase(), bare.toLowerCase()]
  const readsRepo = () => (repoWanted.includes(chips()[0]?.text.toLowerCase()) ? chips()[0] : undefined)
  const selectRepo = () => menuTriggers().find(t => /select repo|add repo|choose repo/i.test(t.text) || /select repo|choose repo/i.test(t.el.getAttribute('aria-label') ?? ''))
  // The chips render a beat after the composer: wait for either a chip or the bare picker.
  await waitFor(() => chips().some(c => c.text) || selectRepo(), MENU_WAIT_MS)
  await sleep(window.__oaMenuSettleMs ?? 800)

  let repoNote
  if (readsRepo()) {
    repoNote = `repo already ${chips()[0].text}`
  } else {
    // A remembered other repository's chip is the picker; with nothing remembered, the page offers one.
    const trigger = chips()[0]?.text ? chips()[0] : selectRepo()
    if (!trigger) return { ok: false, note: `no repo picker on the page (${JSON.stringify(probeNewSession())})` }
    let pick = await chooseFrom(trigger, repoWanted, 'repo')
    if (!pick.ok) {
      // The page may have finished loading its remembered repository under us: read again once.
      await sleep(1500)
      if (readsRepo()) pick = { ok: true, note: `repo already ${chips()[0].text} (after a late render)` }
      else return pick
    }
    repoNote = pick.note
    if (!(await waitFor(readsRepo, MENU_WAIT_MS))) return { ok: false, note: `${repoNote}, but the repo chip does not read "${repo}" afterwards (chips: ${chipTexts()})` }
  }

  // The branch chip appears beside the repo chip once a repository is chosen, reading the default branch.
  const branchWanted = [String(branch).toLowerCase()]
  const readsBranch = () => (chips()[1]?.text.toLowerCase() === branchWanted[0] ? chips()[1] : undefined)
  let branchChip = await waitFor(() => (chips()[1]?.text ? chips()[1] : undefined), MENU_WAIT_MS)
  if (!branchChip) return { ok: false, note: `${repoNote}; no branch chip appeared beside the repo (chips: ${chipTexts()})` }
  let branchNote
  if (readsBranch()) {
    branchNote = `branch already ${branchChip.text}`
  } else {
    const pick = await chooseFrom(branchChip, branchWanted, 'branch')
    if (!pick.ok) return { ok: false, note: `${repoNote}; ${pick.note}` }
    branchNote = pick.note
    branchChip = await waitFor(readsBranch, MENU_WAIT_MS)
    if (!branchChip) return { ok: false, note: `${repoNote}; ${branchNote}, but the branch chip does not read "${branch}" — not sending (chips: ${chipTexts()})` }
  }

  // The model picker remembers the last pick too, so it is read before it is opened.
  let modelNote
  if (model) {
    const wanted = String(model).trim().toLowerCase()
    const readsWanted = () => {
      const trigger = modelTrigger()
      return trigger && readsModel(trigger.text, wanted) ? trigger : undefined
    }
    const trigger = await waitFor(modelTrigger, MENU_WAIT_MS)
    if (!trigger) return { ok: false, note: `${repoNote}; ${branchNote}; no model picker on the page — not sending (${JSON.stringify(probeNewSession())})` }
    if (readsWanted()) {
      modelNote = `model already ${trigger.text}`
    } else {
      const pick = await chooseModel(trigger, wanted)
      if (!pick.ok) return { ok: false, note: `${repoNote}; ${branchNote}; ${pick.note}` }
      modelNote = pick.note
      if (!(await waitFor(readsWanted, MENU_WAIT_MS))) {
        return { ok: false, note: `${repoNote}; ${branchNote}; ${modelNote}, but the model picker does not read "${model}" afterwards — not sending (reads ${JSON.stringify(modelTrigger()?.text ?? null)})` }
      }
    }
  }

  const sent = await submitComposer(composer, prompt)
  const sessionId = await waitFor(sessionIdFromUrl, window.__oaSessionWaitMs ?? 60000, 500)
  const notes = [repoNote, branchNote, ...(modelNote ? [modelNote] : [])].join('; ')
  if (!sessionId) return { ok: false, note: `sent, but the page never became a session URL (${notes})` }
  return { ok: true, sessionId, note: `${notes}; sent via ${sent}` }
}


// ---------------------------------------------------------------------------
// The Driver tab (#1332): one tab serving every watched session. The worker asks this page to
// read claude.ai's own session list — the status icon beside each session carries a text label —
// and then to visit the sessions it picked, navigating inside the app: clicking a session's row
// and the "New" link back, never a page load, so fifty sessions cost fifty clicks. A visited
// session goes through the same survey and mirror as any other page.

/** The list's labels, and the word each becomes on the bridge. Anything else is reported as unknown, with its label. */
const LIST_LABELS = new Map([
  ['Awaiting input', 'awaiting'],
  ['Unread response', 'unread'],
  ['Idle', 'idle'],
  ['Running', 'running'],
])
/**
 * A pull request's label stands in for the status only with no status word on the row: merged or
 * closed, the session's work landed; in any other state — "Open", "Draft" — the session went
 * quiet and is idle (#1707). Only landed is spelled out: a state the bridge has not seen is
 * still a pull request that has not landed.
 */
const PR_LABEL = /^#\d+ · /
const LANDED_LABEL = /^#\d+ · (Merged|Closed)\b/
const NAV_WAIT_MS = 15000
const ROWS_WAIT_MS = 20000
const SEND_WAIT_MS = 15000
const LIST_PAGE_WAIT_MS = 5000
const MAX_LIST_PAGES = 10
const LOG_LINES = 300
const OVERLAY_ID = 'oa-driver-overlay'

/** claude.ai's sign-in page, and the sign-out step that redirects to it: where a person must act. */
const signInPage = () => /^\/(login|logout)(\/|$)/.test(location.pathname)

/** Take the overlay down, if it is up. */
function removeOverlay() {
  const overlay = document.getElementById(OVERLAY_ID)
  if (overlay) ownWrites(() => overlay.remove())
}

let isDriver = false
const driverLines = []

/**
 * Whether a list read or a drive is running in this page. A second instruction meanwhile is
 * refused as busy rather than run alongside it: two drives would navigate over each other. It
 * happens when the worker that sent the first one ended mid-cycle — the page drives on regardless.
 */
let driving = false

async function whileFree(work) {
  if (driving) return { ok: false, busy: true, note: 'the Driver is still busy with an earlier cycle in this page' }
  driving = true
  try {
    return await work()
  } finally {
    driving = false
  }
}

/** This tab is the Driver from now on: its overlay goes up, once. */
function becomeDriver() {
  if (isDriver) return
  isDriver = true
  ensureOverlay()
  driverLog(`driver armed on ${location.pathname}`)
}

/**
 * One line of the cycle log: shown behind the overlay's "Show debug logs", and sent to the
 * worker, which stays awake for as long as lines keep coming.
 */
function driverLog(line) {
  const stamped = `${new Date().toISOString().slice(11, 19)} ${line}`
  driverLines.push(stamped)
  if (driverLines.length > LOG_LINES) driverLines.shift()
  renderOverlay()
  toWorker({ type: 'oa-driver-log', line: stamped })
}

/** What the list's status icon says about a session row. */
function statusOf(anchor) {
  const labels = [...anchor.querySelectorAll('[aria-label]')]
    .map(el => el.getAttribute('aria-label') ?? '')
    .filter(label => label && !/^more options/i.test(label))
  for (const label of labels) {
    const known = LIST_LABELS.get(label)
    if (known) return { status: known }
  }
  // Only with no status word on the row does its pull request stand in for one: a row can carry
  // both, and "Awaiting input" beside a pull request is still a session stopped for its user.
  if (labels.some(label => LANDED_LABEL.test(label))) return { status: 'landed' }
  if (labels.some(label => PR_LABEL.test(label))) return { status: 'idle' }
  return { status: 'unknown', label: (labels[0] ?? '').slice(0, 80) }
}

/** The session rows the list shows, by session id: each row links to its session, so the id is in its address. */
function sessionListRows() {
  const rows = new Map()
  for (const anchor of deepQueryAll('a[href*="/code/session_"]')) {
    const id = /\/code\/(session_[A-Za-z0-9]+)/.exec(anchor.getAttribute('href') ?? '')?.[1]
    if (!id) continue
    const row = { anchor, ...statusOf(anchor) }
    // The first link wins unless a later one carries a status and it did not: a link to the
    // session elsewhere on the page is not its list row.
    if (!rows.has(id) || (rows.get(id).status === 'unknown' && row.status !== 'unknown')) rows.set(id, row)
  }
  return rows
}

/**
 * How far up from a "Show N more" button the container holding session rows may be for the
 * button to count as the list's own. The list's button sits one level from its rows; the
 * middle panel's sits twenty-eight from them, at the app's root (measured 2026-08-25).
 */
const LIST_BUTTON_REACH = 3

/** The list's "Show N more" button, if the list has more to show. The middle panel's is not it. */
function showMoreButton() {
  const candidates = deepQueryAll('button').filter(b => /^show \d+ more$/i.test((b.textContent ?? '').trim()) && usable(b))
  for (const button of candidates) {
    let el = button.parentElement
    for (let distance = 0; el && distance <= LIST_BUTTON_REACH; el = el.parentElement, distance++) {
      if (el.querySelector('a[href*="/code/session_"]')) return button
    }
  }
  return undefined
}

/**
 * Read the list for these sessions, paging it until each is found or the list ends. The list is
 * fetched after the page reports loaded, so it is waited for before it is read; a page with no
 * session rows at all is not a list — signed out, or not on the sessions page — and is named
 * rather than read as every session missing.
 */
async function readSessionList(ids) {
  if (!(await waitFor(() => sessionListRows().size > 0, ROWS_WAIT_MS))) {
    driverLog(`list: no session rows on ${location.pathname}`)
    return { ok: false, note: `no session rows on ${location.pathname}` }
  }
  let rows = sessionListRows()
  let pages = 0
  while (ids.some(id => !rows.has(id)) && pages < MAX_LIST_PAGES) {
    const more = showMoreButton()
    if (!more) break
    const before = rows.size
    more.click()
    pages++
    const grew = await waitFor(() => sessionListRows().size > before, LIST_PAGE_WAIT_MS)
    rows = sessionListRows()
    if (!grew) break
  }
  const statuses = ids.map(id => {
    const row = rows.get(id)
    return row ? { sessionId: id, status: row.status, ...(row.label ? { label: row.label } : {}) } : { sessionId: id, status: 'missing' }
  })
  driverLog(
    `list: ${rows.size} rows${pages ? ` after ${pages} more page(s)` : ''}; ${statuses.map(s => `${s.sessionId.slice(8, 14)}=${s.status}${s.label ? `(${s.label})` : ''}`).join(' ')}`,
  )
  return { ok: true, statuses, listed: rows.size, pages }
}

const atHome = () => location.pathname.replace(/\/+$/, '') === '/code'

/** Back to the session list through the app's own "New" link: no page load. */
async function goHome() {
  if (atHome()) return true
  const link = deepQueryAll('a[href="/code"]').find(usable)
  if (!link) return false
  link.click()
  return Boolean(await waitFor(atHome, NAV_WAIT_MS))
}

function composerText() {
  const composer = findComposer()
  if (!composer) return ''
  return (composer.via === 'textarea' ? composer.el.value : composer.el.textContent) ?? ''
}

/**
 * Visit one session: click its row, wait for its transcript, run the survey (question and mirror
 * reach the daemon as from any page), and type the queued answer if there is one — counted as
 * sent only once the composer is empty again and the transcript gained the turn.
 */
async function visitSession(visit) {
  const row = sessionListRows().get(visit.id)
  if (!row) return { id: visit.id, ok: false, note: 'not on the list' }
  driverLog(`visit ${visit.id} (${visit.status})`)
  const stale = new Set(turnRows())
  row.anchor.click()
  if (!(await waitFor(() => sessionIdFromUrl() === visit.id, NAV_WAIT_MS))) return { id: visit.id, ok: false, note: `the page did not become ${visit.id}` }
  // The address changes before the page does: wait for turn rows that are not the previous
  // session's, so what is surveyed and typed into is this session's page.
  await waitFor(() => turnRows().some(r => !stale.has(r)), ROWS_WAIT_MS)
  await sleep(window.__oaSettleMs ?? 1500)
  const found = findPendingChoice()
  const result = { id: visit.id, ok: true, rows: turnRows().length, ...(found ? { question: String(found.parsed.title ?? '').slice(0, 100) } : {}) }
  if (visit.answer) {
    const before = new Set(turnRows())
    let outcome = await deliverAnswer(visit.answer.text)
    if (outcome.ok) {
      // Taken once the composer is empty again and a turn row exists that did not before — a
      // new row, not a higher count, since a long transcript keeps only its tail rendered.
      const taken = await waitFor(() => !composerText().trim() && turnRows().some(r => !before.has(r)), window.__oaSendWaitMs ?? SEND_WAIT_MS)
      if (!taken) {
        outcome = {
          ok: false,
          note: `${outcome.note}, but the page did not take the send: composer ${composerText().trim() ? 'still holds text' : 'empty'}, rows ${before.size} -> ${turnRows().length}`,
        }
      }
    }
    reportTranscript()
    result.delivered = { sessionId: visit.id, id: visit.answer.id, ok: outcome.ok, ...(outcome.note ? { note: outcome.note } : {}) }
  }
  return result
}

/**
 * One cycle: the session the daemon asked for first, if any — a run is waiting on it, and the
 * new-session page is where a cycle starts — then the visits, then home.
 */
async function drive({ visits = [], start }) {
  becomeDriver()
  driverLog(`cycle: ${start ? 'one session to create, ' : ''}${visits.length} visit(s)`)
  let started
  if (start) {
    const wasHome = atHome()
    const there = wasHome || (await goHome())
    // A navigation home swaps the page under us a beat after the address changes.
    if (there && !wasHome) await sleep(window.__oaSettleMs ?? 1500)
    started = there ? await createSession(start) : { ok: false, note: 'could not reach the new-session page' }
    driverLog(`create: ${started.ok ? started.sessionId : started.note}`)
  }
  const visited = []
  const delivered = []
  for (const visit of visits) {
    const result = await visitSession(visit)
    visited.push(result)
    if (result.delivered) delivered.push(result.delivered)
    driverLog(
      `  ${visit.id}: ${
        result.ok
          ? `${result.rows} rows${result.question ? `, question "${result.question}"` : ''}${result.delivered ? `, answer ${result.delivered.ok ? 'sent' : `failed: ${result.delivered.note}`}` : ''}`
          : result.note
      }`,
    )
  }
  const home = await goHome()
  if (!home) driverLog('could not get back to the session list')
  return { ok: true, visited, delivered, ...(started ? { started } : {}), ...(home ? {} : { note: 'could not get back to the session list' }) }
}

/**
 * The full-page overlay, up and current in the Driver tab: this tab is not for people. Appended
 * beside the app's root rather than inside it, so an in-app navigation leaves it alone; the
 * watcher re-appends it if anything does remove it. Typing goes through the composer's own value
 * and the send button's click, not through the pointer, so covering the composer costs nothing.
 */
function ensureOverlay() {
  if (!isDriver) return
  // The sign-in pages are the one place a person has to act in this tab (the daemon's bridge
  // browser is signed in exactly there, once), so the overlay stands aside on them and comes back
  // with the next page.
  if (signInPage()) return removeOverlay()
  if (!document.getElementById(OVERLAY_ID)) ownWrites(() => document.documentElement.appendChild(overlayElement()))
  renderOverlay()
}

/** The overlay's elements, with an empty status line and log for {@link renderOverlay} to fill. */
function overlayElement() {
  const overlay = document.createElement('div')
  overlay.id = OVERLAY_ID
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647', 'background:#0f1218', 'color:#dbdbdb',
    'font:15px/1.5 ui-sans-serif,system-ui,sans-serif', 'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center', 'padding:32px', 'box-sizing:border-box', 'overflow:auto',
  ].join(';')
  const heading = document.createElement('h1')
  heading.textContent = 'OpenAgent Driver'
  heading.style.cssText = 'font-size:32px;margin:0 0 12px;color:#a7c080;font-weight:600'
  const phrase = document.createElement('p')
  phrase.textContent =
    'OpenAgent is using this tab to watch your Claude Code sessions and to type your answers into them. Use another tab for claude.ai. Closing this tab pauses the bridge; the extension’s options page reopens it.'
  phrase.style.cssText = 'max-width:560px;text-align:center;margin:0 0 16px;color:#aab2c0'
  const status = document.createElement('div')
  status.className = 'oa-driver-status'
  status.style.cssText = 'font:12px/1.45 ui-monospace,monospace;color:#7f8797;text-align:center;max-width:800px'
  const details = document.createElement('details')
  details.style.cssText = 'margin-top:20px;width:min(900px,100%)'
  const summary = document.createElement('summary')
  summary.textContent = 'Show debug logs'
  summary.style.cssText = 'cursor:pointer;color:#7f8797;text-align:center'
  const log = document.createElement('pre')
  log.className = 'oa-driver-log'
  log.style.cssText = 'max-height:50vh;overflow:auto;background:#1f2430;padding:12px;border-radius:8px;font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap;margin:8px 0 0'
  details.append(summary, log)
  overlay.append(heading, phrase, status, details)
  return overlay
}

function renderOverlay() {
  if (signInPage()) return removeOverlay()
  const overlay = document.getElementById(OVERLAY_ID)
  if (!overlay) return
  ownWrites(() => {
    overlay.querySelector('.oa-driver-status').textContent = `bridge v${extensionVersion()} · ${location.pathname} · ${turnRows().length} turn rows · question ${bridgeStatus} · transcript ${transcriptStatus}`
    overlay.querySelector('.oa-driver-log').textContent = driverLines.join('\n')
  })
}

// The worker drives the top frame only: the list and the composer live there, and a child frame
// acting too would click and submit twice.
if (IS_TOP && typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'oa-read-list' && Array.isArray(message.ids)) {
      becomeDriver()
      void whileFree(() => readSessionList(message.ids.filter(id => typeof id === 'string')))
        .then(sendResponse)
        .catch(err => sendResponse({ ok: false, note: String(err?.message ?? err) }))
      return true
    }
    if (message?.type !== 'oa-drive') return false
    void whileFree(() => drive({ visits: Array.isArray(message.visits) ? message.visits : [], start: message.start }))
      .then(sendResponse)
      .catch(err => sendResponse({ ok: false, note: String(err?.message ?? err) }))
    return true
  })
}

// The offline harness (check.mjs) runs this file in jsdom, where there is no extension runtime
// to hand answers through. Exposed only there: on a real page `chrome` exists and nothing is
// added to the window claude.ai can see.
if (typeof chrome === 'undefined') {
  window.__oaBridgeDeliverAnswer = deliverAnswer
  window.__oaBridgeCreateSession = createSession
  window.__oaBridgeProbeNewSession = probeNewSession
  window.__oaBridgeReadSessionList = ids => whileFree(() => readSessionList(ids))
  window.__oaBridgeDrive = args => whileFree(() => drive(args))
  window.__oaBridgeSurveys = () => surveys
}

/**
 * What the page looks like when extraction fails. Structure and lengths only, never message
 * text, so the report stays safe to paste into a public issue.
 */
function diagnostics() {
  const codes = deepQueryAll('pre, code')
    .map(el => (el.textContent ?? '').trim())
    .filter(t => t.includes('"options"') || t.startsWith('{'))
  const frames = [...document.querySelectorAll('iframe')]
  let reachableFrames = 0
  for (const f of frames) {
    try {
      if (f.contentDocument?.body) reachableFrames++
    } catch {
      // Cross origin, which is itself the answer.
    }
  }
  const deep = deepText()
  // Did the brace matcher find object-shaped candidates, and did any fail to parse? This is
  // what separates "never found it" from "found it and could not read it".
  const stats = { candidates: 0, parseErrors: 0, lastError: '' }
  const all = extractChoices(deep, stats)
  return {
    frame: IS_TOP ? 'top' : 'child',
    jsonCandidates: stats.candidates,
    jsonObjects: all.length,
    jsonTemplates: all.filter(isTemplate).length,
    jsonParseErrors: stats.parseErrors,
    jsonLastError: stats.lastError,
    pre: deepQueryAll('pre').length,
    code: deepQueryAll('code').length,
    jsonishBlocks: codes.length,
    shadowRoots: countShadowRoots(),
    iframes: frames.length,
    reachableFrames,
    contentEditables: deepQueryAll('div[contenteditable="true"]').length,
    textareas: deepQueryAll('textarea').length,
    // The decisive pair: does the block exist in the top body, and does it exist once
    // shadow content is included?
    optionsInBodyText: (document.body?.innerText ?? '').includes('"options"'),
    optionsInDeepText: deep.includes('"options"'),
    deepTextLength: deep.length,
  }
}

function survey() {
  surveys++
  const choice = findPendingChoice()
  const composer = findComposer()
  return {
    url: location.href,
    choiceFound: Boolean(choice),
    choiceVia: choice?.via,
    choiceTitle: choice?.parsed?.title,
    choiceOptions: (choice?.parsed?.options ?? []).map(o => o.label ?? o),
    composerFound: Boolean(composer),
    composerVia: composer?.via,
    diagnostics: diagnostics(),
  }
}

// A child frame has no panel of its own: it reports upward, so the top frame's report says
// whether the content was in a frame and which one. This is what settles the iframe question.
if (!IS_TOP) {
  const send = () => {
    const s = survey()
    if (s.choiceFound || s.diagnostics.jsonishBlocks || s.diagnostics.optionsInDeepText) {
      parent.postMessage({ __oaBridge: s }, '*')
    }
  }
  send()
  watch(send)
} else {
  let fromFrame
  window.addEventListener('message', e => {
    if (e.data && typeof e.data === 'object' && e.data.__oaBridge) fromFrame = e.data.__oaBridge
  })

  const panel = document.createElement('div')
  panel.id = PANEL_ID
  panel.style.cssText = [
    'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
    'width:360px', 'max-height:70vh', 'overflow:auto',
    'background:#1f2430', 'color:#dbdbdb', 'font:12px/1.45 ui-monospace,monospace',
    'border:1px solid #3a4150', 'border-radius:8px', 'padding:10px 12px',
    'box-shadow:0 6px 24px rgba(0,0,0,.35)',
  ].join(';')
  document.documentElement.appendChild(panel)

  let latest = survey()
  // Announce the page once whatever it is: on the session list there is no session to report,
  // but the worker's reply is what tells the Driver tab it is the Driver (#1332).
  sayHello(sessionIdFromUrl(), `page loaded on ${location.pathname}`)

  // Whether the panel is folded down to a compact OA tab. Remembered in chrome.storage rather than
  // the page's localStorage: the preference should survive a reload, and nothing the extension
  // keeps should be readable by the page it watches. Restored asynchronously, so the panel can
  // open expanded for a beat before the remembered fold lands.
  let collapsed = false
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    try {
      chrome.storage.local.get('panelCollapsed', stored => {
        if (!chrome.runtime.lastError && stored?.panelCollapsed) {
          collapsed = true
          render()
        }
      })
    } catch {
      // Dead context; the panel starts expanded, and reloading the tab is the fix anyway.
    }
  }

  const button = (label, onClick) => {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = 'margin-top:8px;width:100%;padding:5px;cursor:pointer;background:#2d3441;color:#dbdbdb;border:1px solid #3a4150;border-radius:5px;font:inherit'
    b.addEventListener('click', onClick)
    return b
  }

  // Drawn under `ownWrites`: the redraw must not read as a page change (#1707).
  const render = () => ownWrites(() => {
    const top = survey()
    // A child frame's find wins: it means the content lives there, which is the finding.
    latest = { ...top, fromFrame: fromFrame ?? null }
    // The Driver tab (#1332) shows its overlay instead of the corner panel; the survey above
    // still ran, so its sessions are read and mirrored like any other page's.
    if (isDriver) {
      panel.style.display = 'none'
      ensureOverlay()
      return
    }
    panel.style.display = ''
    const winner = top.choiceFound ? top : fromFrame?.choiceFound ? fromFrame : top
    const d = top.diagnostics
    panel.innerHTML = ''
    panel.style.width = collapsed ? 'auto' : '360px'
    panel.style.padding = collapsed ? '6px 8px' : '10px 12px'
    const head = document.createElement('div')
    head.style.cssText = `display:flex;align-items:center;gap:8px${collapsed ? '' : ';margin-bottom:6px'}`
    const title = document.createElement('span')
    const fullTitle = `OpenAgent bridge v${extensionVersion()}`
    // Folded, the label shrinks to "OA": the fold exists to give the corner back, so the full
    // name and version retreat to the tooltip.
    title.textContent = collapsed ? 'OA' : fullTitle
    if (collapsed) title.title = fullTitle
    title.style.cssText = 'font-weight:600;color:#a7c080;flex:1'
    const toggle = document.createElement('button')
    toggle.textContent = collapsed ? '+' : '−'
    toggle.title = collapsed ? 'Expand' : 'Collapse'
    toggle.setAttribute('aria-label', toggle.title)
    toggle.setAttribute('aria-expanded', String(!collapsed))
    toggle.style.cssText =
      'flex:none;width:20px;height:20px;padding:0;cursor:pointer;background:#2d3441;color:#dbdbdb;border:1px solid #3a4150;border-radius:5px;font:inherit;line-height:1'
    toggle.addEventListener('click', () => {
      collapsed = !collapsed
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        try {
          chrome.storage.local.set({ panelCollapsed: collapsed }, () => void chrome.runtime.lastError)
        } catch {
          // Dead context; the choice still holds until the tab reloads.
        }
      }
      render()
    })
    head.append(title, toggle)
    panel.appendChild(head)
    // Folded, the OA tab is all there is to draw. The survey above still ran: collapsing
    // hides the detail, not the bridge, so the daemon keeps hearing from this page.
    if (collapsed) return
    const rows = [
      ['question found', winner.choiceFound ? `yes (${winner.choiceVia}${winner === fromFrame ? ', in iframe' : ''})` : `no${choiceNote ? ` (${choiceNote})` : ''}`],
      ['title', winner.choiceTitle ?? '-'],
      ['options', winner.choiceOptions?.length ? winner.choiceOptions.join(' | ') : '-'],
      ['composer', top.composerFound ? top.composerVia : 'not found'],
      ['bridge', bridgeStatus],
      ['answer', answerStatus],
      // Always shown: the transcript is the half that runs even when no question was asked, so
      // it needs its own line rather than sharing the question's.
      ['transcript', transcriptStatus],
      ['turn rows', turnRows().length],
    ]
    if (!winner.choiceFound) {
      rows.push(
        ['code / pre', `${d.code} / ${d.pre}`],
        ['shadow roots', d.shadowRoots],
        ['iframes', `${d.iframes} (reachable ${d.reachableFrames})`],
        ['"options" body', String(d.optionsInBodyText)],
        ['"options" deep', String(d.optionsInDeepText)],
        ['json candidates', `${d.jsonCandidates} (parse errors ${d.jsonParseErrors})`],
        ...(d.jsonLastError ? [['last parse error', d.jsonLastError]] : []),
        ['frame reported', fromFrame ? 'yes' : 'no'],
      )
    }
    for (const [k, v] of rows) {
      const line = document.createElement('div')
      line.style.cssText = 'display:flex;gap:8px;margin:2px 0'
      const key = document.createElement('span')
      key.style.cssText = 'color:#7f8797;min-width:104px;flex:none'
      key.textContent = k
      const val = document.createElement('span')
      val.style.cssText = 'word-break:break-word'
      val.textContent = String(v)
      line.append(key, val)
      panel.appendChild(line)
    }
    panel.appendChild(button('Copy report', () => {
      void navigator.clipboard.writeText(JSON.stringify(latest, null, 2))
    }))
    // Fills without submitting, on purpose: it proves the write path an answer takes, without
    // the extension ever speaking for the user.
    panel.appendChild(button('Fill composer (does not send)', () => {
      const composer = findComposer()
      if (composer) fillComposer(composer, winner.choiceOptions?.[0] ?? 'test')
    }))
  })

  render()
  watch(render)
}

/**
 * Re-survey when the page actually changes, plus a slow heartbeat.
 *
 * Not a fast `setInterval`: this is designed to run in a background tab, and Chrome clamps timers
 * in a tab hidden for more than about five minutes to roughly once a minute. The session's own
 * stream mutates the DOM whenever anything happens, so an observer catches it immediately and the
 * interval is only a backstop for a mutation we failed to see.
 */
function watch(run) {
  let queued = false
  let interval
  // Reloading the extension invalidates this script's runtime but leaves it running in the tab,
  // where every chrome.* call now throws. Those throws land on the extension's error page and
  // read as bugs, so a dead context stops watching instead of erroring once a minute forever.
  const alive = () => {
    try {
      if (typeof chrome === 'undefined' || chrome.runtime?.id) return true
    } catch {
      // Reading chrome.runtime itself can throw once the context is gone.
    }
    observer.disconnect()
    watchers.delete(observer)
    clearInterval(interval)
    return false
  }
  const observer = new MutationObserver(() => {
    if (queued || !alive()) return
    queued = true
    setTimeout(() => {
      queued = false
      run()
    }, 250)
  })
  observer.observe(document.documentElement, OBSERVED)
  watchers.add(observer)
  interval = setInterval(() => {
    if (alive()) run()
  }, 30 * POLL_MS)
}
