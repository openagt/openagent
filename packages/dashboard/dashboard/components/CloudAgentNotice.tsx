import { useEffect, useRef, useState } from 'react'
import { Check, Cloud, ExternalLink, Loader2, TriangleAlert } from 'lucide-react'
import type { BridgeAnswer, BridgeEvent, BridgeQuestion, OpenAgentEvent } from '../../src/index.js'
import { bridgeChoiceRequest } from '../../src/client.js'
import { onBridgeQuestion, onBridgeEvents, onBridgeAnswer } from '../rpc/reads.js'
import { sendBridgeAnswer, sendBridgeAnswerCancel } from '../rpc/control.js'
import { cloudSession } from '../lib/live-state.js'
import { QuestionPanel } from './QuestionPanel.js'
import { CopyButton } from './ui/copy-button.js'

/** How often to ask the daemon whether the bridge reported a question. */
const POLL_MS = 4000

// The agent view's affordance for a Claude web target (#610). This target is a hand-off, not a
// streamed run: the session runs on Anthropic's infrastructure, does its own worktree and opens
// its own PR, and there is no read-back API we can use to follow it with, so the honest thing to
// show is where the work went and how to reach it rather than an empty feed that looks stalled.
// Renders nothing for any other target, so the agent view can mount it unconditionally.
export function CloudAgentNotice({
  target,
  events,
  projectId,
  agentId,
}: {
  target?: 'local' | 'actions' | 'remote' | 'web' | undefined
  events: readonly OpenAgentEvent[]
  /** The agent this notice belongs to: what the question's card is given. */
  projectId: string
  agentId: string
}) {
  const session = target === 'web' ? cloudSession(events) : undefined
  const question = useBridgeQuestion(session?.id)
  const answer = useBridgeAnswer(session?.id)
  if (target !== 'web') return null
  return (
    <div className="border-b border-border bg-muted/40">
      <div role="status" className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs text-muted-foreground">
        <Cloud className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          {session
            ? 'Running as a Claude Code cloud session. It opens its own pull request over there; a question it parks on shows here once the bridge sees it.'
            : 'Starting a Claude Code cloud session…'}
        </span>
        {session && (
          <>
            <span className="inline-flex shrink-0 items-center gap-1">
              <code className="rounded bg-muted px-1 py-0.5">claude --teleport {session.id}</code>
              <CopyButton text={`claude --teleport ${session.id}`} label="Copy the command that continues this session here" />
            </span>
            <a
              href={session.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline"
            >
              Open the session
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </>
        )}
      </div>
      {question && session && (!answer || answer.state === 'failed') && (
        <ParkedQuestion
          question={question}
          url={session.url}
          sessionId={session.id}
          projectId={projectId}
          agentId={agentId}
          failure={answer?.state === 'failed' ? answer : undefined}
        />
      )}
      {answer && session && answer.state !== 'failed' && <AnswerState answer={answer} url={session.url} sessionId={session.id} />}
    </div>
  )
}

/**
 * How a pick reaches a Claude web session (#1237/#1554): queued on the daemon for the extension,
 * which types the continuation into the session's composer. Shaped for `QuestionPanel.send`, so the
 * bridged question is the same panel a local one gets; the RPC's `{ok:false}` is thrown so the
 * panel's action hook shows the reason. The option ids are the labels (see `bridgeChoiceRequest`).
 */
function bridgeSend(sessionId: string): (pick: string | string[]) => Promise<void> {
  return async pick => {
    const result = await sendBridgeAnswer(sessionId, Array.isArray(pick) ? pick : [pick])
    if (!result.ok) throw new Error(result.error ?? 'could not queue the answer')
  }
}

/**
 * The question the session is parked on, once the browser bridge has reported one (#1237),
 * rendered as the gate it is (#1554): the same panel a local agent's question gets, every answer
 * going through the bridge instead of the path a local agent's answer takes. The link out stays as
 * the manual path for whoever prefers to answer over there.
 */
function ParkedQuestion({
  question,
  url,
  sessionId,
  projectId,
  agentId,
  failure,
}: {
  question: BridgeQuestion
  url: string
  sessionId: string
  projectId: string
  agentId: string
  failure?: BridgeAnswer | undefined
}) {
  return (
    <div className="border-t border-border">
      {failure && (
        <p className="flex items-center gap-1 px-4 pt-2.5 text-xs text-destructive">
          <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
          Sending “{failure.labels.join(', ')}” failed{failure.note ? `: ${failure.note}` : ''}. Pick again, or answer in the session.
        </p>
      )}
      {/* Not `active`: the keys belong to a question in the chat, and to the message box. */}
      <QuestionPanel key={question.title} projectId={projectId} agentId={agentId} choice={bridgeChoiceRequest(question)} send={bridgeSend(sessionId)} />
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-4 py-2.5 text-xs text-primary hover:underline">
        Answer it in the session
        <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </div>
  )
}

/**
 * Where a sent answer stands (#1237). Queued means the extension has not collected it yet,
 * which is the window where withdrawing it still means something; sent means it was typed
 * into the session and submitted.
 */
function AnswerState({ answer, url, sessionId }: { answer: BridgeAnswer; url: string; sessionId: string }) {
  return (
    <div className="flex items-center gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
      {answer.state === 'queued' ? (
        <>
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            Sending “{answer.labels.join(', ')}” through your Claude web tab… It goes out the next time the extension checks in.
          </span>
          <button
            type="button"
            onClick={() => void sendBridgeAnswerCancel(sessionId).catch(() => {})}
            className="shrink-0 rounded border border-border px-2 py-1 hover:border-primary/50 hover:text-foreground"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">
            Answered “{answer.labels.join(', ')}”. The session continues over there and its transcript above follows along.
          </span>
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline">
            Open the session
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </>
      )}
    </div>
  )
}

/**
 * Lines of claude.ai UI chrome a scraped turn drags in (#1265). A turn is its row's rendered
 * text, so tile-focus hints, per-message action affordances and the bare model name ride along
 * with the conversation. Matched per line, anchored, so a message that merely mentions a model
 * is untouched.
 */
const MIRROR_CHROME = [
  /^Arrow keys move the tile/i,
  /^Show message actions$/i,
  /^(Claude\s+)?(Fable|Opus|Sonnet|Haiku)(\s+\d[\d.]*)?$/i,
]

/** Drop the scraped-in UI chrome from a mirrored turn, collapsing the holes it leaves. */
export function scrubMirrorText(text: string): string {
  return text
    .split('\n')
    .filter(line => !MIRROR_CHROME.some(chrome => chrome.test(line.trim())))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The one live boxed row at the tail of a web agent's log (#1265): the log itself dead-ends at
 * "Handed off: …", and this is what happens after — the bridge mirror streaming in place, with a
 * connecting placeholder so a web agent never shows dead air.
 *
 * Deliberately a single clearly-labelled box rather than ordinary log rows: the run's diary is
 * durable provenance-clean data, the mirror is a best-effort tab scrape read through a browser
 * extension — no tool calls, no timings, nothing at all when the tab is closed — and one visible
 * boundary keeps the two from being confused. Renders nothing for any other target (or before the
 * hand-off names a session), so the feed can mount it unconditionally.
 */
export function CloudMirrorRow({
  target,
  events,
}: {
  target?: 'local' | 'actions' | 'remote' | 'web' | undefined
  events: readonly OpenAgentEvent[]
}) {
  const session = target === 'web' ? cloudSession(events) : undefined
  const transcript = useBridgeEvents(session?.id)
  const turns = transcript.map(event => ({ ...event, text: scrubMirrorText(event.text) })).filter(turn => turn.text)
  const scroller = useScrollToNewest(turns.at(-1)?.seq, turns.at(-1)?.text.length)
  if (target !== 'web' || !session) return null
  return (
    <div role="status" aria-label="Cloud session mirror" className="mt-2 rounded-md border border-border bg-muted/40 font-sans">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        <Cloud className="h-3 w-3 shrink-0 text-primary" aria-hidden />
        <span className="font-medium uppercase tracking-wide">Cloud session mirror</span>
        <span className="opacity-70">a best-effort view of the Claude tab, not the run's own log</span>
      </div>
      {turns.length > 0 ? (
        <div ref={scroller} className="max-h-80 space-y-2 overflow-y-auto px-3 py-2 text-xs">
          {turns.map(turn =>
            turn.role === 'user' ? (
              // The user's side is one line: the opening turn is the run's whole prompt, and
              // what the session did is the point of the mirror, not what it was told.
              <div key={turn.seq} className="truncate text-muted-foreground/70" title={turn.text}>
                <span className="font-medium">you ›</span> {firstLine(turn.text)}
              </div>
            ) : (
              <div key={turn.seq} className="whitespace-pre-wrap break-words text-muted-foreground">
                {turn.text}
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />
          Connecting to the cloud session…
        </div>
      )}
    </div>
  )
}

/** The first non-empty line of a turn, which is all the mirror shows of the user's side. */
function firstLine(text: string): string {
  return text.split('\n').find(line => line.trim()) ?? ''
}

/**
 * Keep the newest turn in view: the box scrolls to its end whenever the last turn changes or
 * grows, so a reply streaming in is watched, not scrolled to.
 */
function useScrollToNewest(lastSeq: number | undefined, lastLength: number | undefined) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastSeq, lastLength])
  return ref
}

/** Poll the daemon for this session's transcript, on the same cadence as the question. */
function useBridgeEvents(sessionId: string | undefined): BridgeEvent[] {
  const [events, setEvents] = useState<BridgeEvent[]>([])
  useEffect(() => {
    if (!sessionId) {
      setEvents([])
      return
    }
    let live = true
    const read = () => {
      void onBridgeEvents(sessionId)
        .then(next => {
          if (live) setEvents(next)
        })
        .catch(() => {})
    }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [sessionId])
  return events
}

/** Poll the daemon for where this session's answer stands, on the question's cadence. */
function useBridgeAnswer(sessionId: string | undefined): BridgeAnswer | undefined {
  const [answer, setAnswer] = useState<BridgeAnswer | undefined>(undefined)
  useEffect(() => {
    if (!sessionId) {
      setAnswer(undefined)
      return
    }
    let live = true
    const read = () => {
      void onBridgeAnswer(sessionId)
        .then(next => {
          if (live) setAnswer(next ?? undefined)
        })
        .catch(() => {})
    }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [sessionId])
  return answer
}

/**
 * Poll the daemon for this session's parked question. Polled rather than streamed because the
 * bridge writes over HTTP from a browser extension and never touches the agent's event log, so
 * there is no event for the live channel to carry.
 */
function useBridgeQuestion(sessionId: string | undefined): BridgeQuestion | undefined {
  const [question, setQuestion] = useState<BridgeQuestion | undefined>(undefined)
  useEffect(() => {
    if (!sessionId) {
      setQuestion(undefined)
      return
    }
    let live = true
    const read = () => {
      void onBridgeQuestion(sessionId)
        .then(next => {
          if (live) setQuestion(next ?? undefined)
        })
        // A daemon with the bridge off answers null; a transport failure is not worth a banner.
        .catch(() => {})
    }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [sessionId])
  return question
}
