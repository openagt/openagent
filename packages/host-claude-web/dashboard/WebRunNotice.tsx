import { useEffect, useRef } from 'react'
import { Check, Cloud, ExternalLink, Loader2, TriangleAlert } from 'lucide-react'
import { AskedQuestion, CopyButton, buttonVariants, rpcClient, usePolled, useModuleHost, type ModuleHost, type UiRunNoticeProps } from '@openagt/ui/module'
import { questionCard, type BridgeQuestion } from '../src/bridge-question.js'
import type { BridgeEvent } from '../src/bridge-endpoints.js'
import type { BridgeAnswer } from '../src/bridge-store.js'
import type { WebRunView } from '../src/server.js'

/** The host's id, as the run's page names the host a run is on (`WEB_HOST`). */
const WEB = 'web'

/** How often the strip asks again: a question the session parks on, an answer on its way, the mirror. */
const POLL_MS = 4000

/** The module's server part, in the run's project. */
const server = (host: ModuleHost) => rpcClient<typeof import('../src/server.js')>(host)

/**
 * The strip above the chat of a run handed to Claude Code on the web (#610, #2394). The session
 * runs on claude.ai, makes its own branch and opens its own pull request, and nothing reads it
 * back, so the chat would look stalled: this says where the work is and how to reach it, draws
 * the question the session is parked on with the card a run's own question gets, every pick going
 * through the bridge, and under it a best-effort mirror of what the session said. Nothing on a run
 * of another host.
 */
export function WebRunNotice({ host, ...run }: UiRunNoticeProps) {
  return host === WEB ? <OnTheWeb {...run} /> : null
}

function OnTheWeb({ projectId, agentId, working }: Omit<UiRunNoticeProps, 'host'>) {
  const moduleHost = useModuleHost()
  const { value: view, reload } = usePolled<WebRunView | null>(() => server(moduleHost).run(projectId, { agentId }).catch(() => null), null, POLL_MS, [projectId, agentId])
  const session = view?.session
  if (!session) {
    // Its hand-off under way; one that failed says why at the end of its chat.
    return working ? (
      <div role="status" className="flex items-center gap-2 bg-muted px-4 py-2 text-sm text-muted-foreground">
        <Cloud className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">Starting a Claude Code cloud session…</span>
      </div>
    ) : null
  }
  const { question, answer } = view
  return (
    <div>
      {/* The banners' strip: a tinted fill with no edge, its links at the right. */}
      <div role="status" className="flex flex-wrap items-center gap-2 bg-muted px-4 py-2 text-sm text-muted-foreground">
        <Cloud className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">Running as a Claude Code cloud session. It opens its own pull request over there; a question it parks on shows here once the bridge sees it.</span>
        <span className="inline-flex shrink-0 items-center gap-1">
          <code className="rounded-sm bg-background px-1 py-0.5 font-mono text-xs">claude --teleport {session.id}</code>
          <CopyButton text={`claude --teleport ${session.id}`} label="Copy the command that continues this session here" />
        </span>
        <a href={session.url} target="_blank" rel="noreferrer" className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-sm text-primary underline-offset-4 hover:underline">
          Open the session
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>
      {question && (!answer || answer.state === 'failed') && (
        <ParkedQuestion question={question} url={session.url} projectId={projectId} agentId={agentId} failure={answer?.state === 'failed' ? answer : undefined} onSent={() => void reload()} />
      )}
      {answer && answer.state !== 'failed' && <AnswerState answer={answer} url={session.url} projectId={projectId} agentId={agentId} onCancelled={() => void reload()} />}
      <Mirror events={view.mirror} />
    </div>
  )
}

/**
 * The question the session is parked on, once the bridge reported it (#1237), drawn as the
 * question it is (#1554): the card a run's own question gets, where the module that asks is on,
 * its pick going through the bridge. The link out stays, for whoever answers over there.
 */
function ParkedQuestion({
  question,
  url,
  projectId,
  agentId,
  failure,
  onSent,
}: {
  question: BridgeQuestion
  url: string
  projectId: string
  agentId: string
  failure?: BridgeAnswer | undefined
  onSent: () => void
}) {
  const host = useModuleHost()
  // The card's options are the labels (`questionCard`): what the extension types back.
  const send = async (pick: string | string[]) => {
    const result = await server(host).answer(projectId, { agentId, labels: Array.isArray(pick) ? pick : [pick] })
    if (!result.ok) throw new Error(result.error)
    onSent()
  }
  return (
    <div>
      {failure && (
        <p className="flex items-center gap-2 px-4 pt-2 text-sm text-danger">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          Sending “{failure.labels.join(', ')}” failed{failure.note ? `: ${failure.note}` : ''}. Pick again, or answer in the session.
        </p>
      )}
      {/* Not `active`: the keys belong to a question in the chat, and to the message box. */}
      <AskedQuestion key={question.title} projectId={projectId} agentId={agentId} question={questionCard(question)} send={send} />
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-4 py-2 text-sm text-primary hover:underline">
        Answer it in the session
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </div>
  )
}

/**
 * Where a pick stands (#1237): queued until an extension collects it, the one stretch where taking
 * it back still means something; sent once it was typed into the session.
 */
function AnswerState({ answer, url, projectId, agentId, onCancelled }: { answer: BridgeAnswer; url: string; projectId: string; agentId: string; onCancelled: () => void }) {
  const host = useModuleHost()
  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
      {answer.state === 'queued' ? (
        <>
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />
          <span className="min-w-0 flex-1">Sending “{answer.labels.join(', ')}” through your Claude web tab… It goes out the next time the extension checks in.</span>
          <button
            type="button"
            onClick={() =>
              void server(host)
                .cancel(projectId, { agentId })
                .catch(() => {})
                .finally(onCancelled)
            }
            className={buttonVariants({ variant: 'secondary', size: 'sm' })}
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <Check className="size-3.5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1">Answered “{answer.labels.join(', ')}”. The session goes on over there, and the mirror below follows it.</span>
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline">
            Open the session
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </>
      )}
    </div>
  )
}

/**
 * Lines of claude.ai's own page a scraped turn drags in (#1265): a turn is its row's text, so
 * tile-focus hints, a message's action labels and the bare model name ride along. Matched per
 * line, anchored, so a message that merely mentions a model is untouched.
 */
const MIRROR_CHROME = [/^Arrow keys move the tile/i, /^Show message actions$/i, /^(Claude\s+)?(Fable|Opus|Sonnet|Haiku)(\s+\d[\d.]*)?$/i]

/** Drop the page's own lines from a mirrored turn, closing the holes they leave. */
export function scrubMirrorText(text: string): string {
  return text
    .split('\n')
    .filter(line => !MIRROR_CHROME.some(chrome => chrome.test(line.trim())))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * What the session said, as the extension read it off its page (#1265): one box, clearly labelled,
 * apart from the run's own chat, which is the run's record, while this is a best-effort read of a
 * browser tab, with no steps and no times, and nothing while no tab is open on it.
 */
function Mirror({ events }: { events: readonly BridgeEvent[] }) {
  const turns = events.map(event => ({ ...event, text: scrubMirrorText(event.text) })).filter(turn => turn.text)
  const scroller = useScrollToNewest(turns.at(-1)?.seq, turns.at(-1)?.text.length)
  return (
    <div role="status" aria-label="Cloud session mirror" className="mx-4 my-2 rounded-lg border border-hairline font-sans">
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2 text-xs text-muted-foreground">
        <Cloud className="size-3.5 shrink-0 text-primary" aria-hidden />
        <span className="font-medium">Cloud session mirror</span>
        <span className="text-faint-foreground">a best-effort view of the Claude tab, not the run's own log</span>
      </div>
      {turns.length > 0 ? (
        <div ref={scroller} className="max-h-80 space-y-2 overflow-y-auto px-3 py-2 text-xs">
          {turns.map(turn =>
            turn.role === 'user' ? (
              // The person's side is one line: the opening turn is the run's whole prompt, and what
              // the session did is the point of the mirror, not what it was told.
              <div key={turn.seq} className="truncate text-faint-foreground" title={turn.text}>
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
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden />
          Connecting to the cloud session…
        </div>
      )}
    </div>
  )
}

/** The first line of a turn with words on it: all the mirror shows of the person's side. */
function firstLine(text: string): string {
  return text.split('\n').find(line => line.trim()) ?? ''
}

/** Keep the newest turn in view: the box scrolls to its end whenever the last turn changes or grows. */
function useScrollToNewest(lastSeq: number | undefined, lastLength: number | undefined) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lastSeq, lastLength])
  return ref
}
