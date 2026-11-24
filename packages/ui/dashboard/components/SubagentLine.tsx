import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { formatElapsed } from '../lib/format-date.js'
import { runTone, runWord } from '../lib/run-words.js'
import { anyModelName, useAgents } from '../lib/agents.js'
import { stepWords, type SubagentRow, type SubagentStep } from '../lib/subagents.js'
import { Markdown } from './Markdown.js'
import { Seconds } from './ToolCalls.js'
import { Facts } from './ui/panel.js'

// A main agent's subagents in its chat, as Claude Code on the web draws them, in the look of the
// agent's other steps: one grey line that says what is going on and opens to one bordered panel. While
// they work it names one of them, and the seconds are the chat's live line's, as Claude Code on the web
// has one counter; once they ended it says what came of them
// ("Ran 2 agents, received a message"). A row opens the subagent in the pane beside the chat, its
// prompt and its transcript.

/** How long the moving line stays on one working subagent's name. */
const NAME_EVERY_MS = 2500

/** A subagent's row: the verb in grey, its name in dark, its model; while it works the tool it is on; how long it took. */
function AgentRow({ row, onOpen }: { row: SubagentRow; onOpen?: ((key: string) => void) | undefined }) {
  const models = useAgents()
  return (
    <button type="button" onClick={() => onOpen?.(row.key)} className="group/sub flex w-full min-w-0 items-center gap-1.5 text-left hover:text-foreground" aria-label={`Open the subagent: ${row.name}`}>
      <span className={cn('shrink-0', row.working && 'text-shimmer')}>{row.working ? 'Running agent' : 'Ran agent'}</span>
      <span className={cn('min-w-0 truncate text-foreground group-hover/sub:underline', row.working && 'text-shimmer')}>{row.name}</span>
      {/* On a phone the name has the line: the model is in the subagent's pane. */}
      {row.model && <span className="shrink-0 max-sm:hidden">{anyModelName(models, row.model)}</span>}
      {row.working
        ? row.calls !== undefined && (
            // What it is on now and how many calls it made.
            <span className="min-w-0 shrink-0 truncate">
              <Facts facts={[row.tool, `${row.calls} ${row.calls === 1 ? 'call' : 'calls'}`]} />
            </span>
          )
        : row.status !== 'done' && <span className={cn('shrink-0', runTone(row.status))}>{runWord(row.status)}</span>}
      <span className="ml-auto shrink-0 tabular-nums" title={`Started ${new Date(row.startedAt).toLocaleString()}`}>
        <Facts facts={[row.working ? <Seconds since={row.startedAt} /> : row.endedAt !== undefined && formatElapsed(Date.parse(row.endedAt) - Date.parse(row.startedAt))]} />
      </span>
    </button>
  )
}

/** What a subagent sent its main agent, folded: "Message from subagent". Opened, whose it is and the message. */
function SubagentMessage({ name, text }: { name: string; text?: string | undefined }) {
  const [open, setOpen] = useState(false)
  const body = text !== undefined && text !== ''
  const words = (
    <>
      <span className="shrink-0">Message from</span>
      <span className="shrink-0 text-foreground">subagent</span>
    </>
  )
  return (
    <div className="min-w-0 flex-1 font-sans text-sm text-muted-foreground">
      {body ? (
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Message from subagent" className="flex max-w-full min-w-0 items-center gap-1.5 py-0.5 text-left hover:text-foreground">
          {words}
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5 py-0.5">{words}</div>
      )}
      {open && (
        <div className="mt-1 flex flex-col gap-1">
          <div>From: {name}</div>
          {body && <div className="text-foreground"><Markdown text={text} /></div>}
        </div>
      )}
    </div>
  )
}

/** What the folded line says: a working subagent's name, or what came of them. */
interface Said {
  text: string
  working: boolean
}

/**
 * The folded line's words, changing in place. The words that leave stay under the ones that come
 * until those are readable (`morph-out`), so the line is never its chevron alone; the first words
 * of a line come with it, at once. The arrival is the words' box, its shimmer the words in it: one
 * element cannot run both animations.
 */
function LineWords({ said }: { said: Said }) {
  const [shown, setShown] = useState<{ now: Said; before?: Said }>({ now: said })
  if (shown.now.text !== said.text || shown.now.working !== said.working) setShown({ now: said, before: shown.now })
  const words = (each: Said) => <span className={each.working ? 'text-shimmer' : 'group-hover/status:text-foreground group-has-focus-visible/status:text-foreground'}>{each.text}</span>
  return (
    <span className="grid min-w-0 text-left">
      {shown.before && (
        <span key={`left:${shown.before.text}`} aria-hidden className="morph-out min-w-0 truncate [grid-area:1/1]" onAnimationEnd={e => e.target === e.currentTarget && setShown(was => ({ now: was.now }))}>
          {words(shown.before)}
        </span>
      )}
      <span key={shown.now.text} className={cn('min-w-0 truncate [grid-area:1/1]', shown.before && 'morph-in')}>
        {words(shown.now)}
      </span>
    </span>
  )
}

/** The subagents and messages of one stretch of the chat, as one line. `lead` is a row the panel opens with: the session's set-up. */
export function SubagentSteps({ steps, lead, onOpen }: { steps: readonly SubagentStep[]; lead?: ReactNode; onOpen?: ((key: string) => void) | undefined }) {
  const [open, setOpen] = useState(false)
  const working = steps.flatMap(step => (step.kind === 'agent' && step.row.working ? [step.row] : []))
  const [turn, setTurn] = useState(0)
  useEffect(() => {
    if (working.length < 2) return
    const next = setInterval(() => setTurn(at => at + 1), NAME_EVERY_MS)
    return () => clearInterval(next)
  }, [working.length])
  const only = steps.length === 1 && !lead ? steps[0] : undefined
  if (only?.kind === 'message') return <SubagentMessage name={only.row.name} text={only.text} />
  if (only?.kind === 'agent') {
    return (
      <div className="min-w-0 flex-1 py-0.5 font-sans text-sm text-muted-foreground">
        <AgentRow row={only.row} onOpen={onOpen} />
      </div>
    )
  }
  const current = working[turn % Math.max(working.length, 1)]
  const words = stepWords(steps)
  return (
    <div className="min-w-0 flex-1 font-sans text-sm text-muted-foreground">
      <div className="group/status flex">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label={current ? `Working: ${current.name}` : words} className="flex min-w-0 items-center gap-1.5 py-0.5">
          <LineWords said={current ? { text: current.name, working: true } : { text: words, working: false }} />
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        </button>
      </div>
      {open && (
        <div className="mt-1.5 flex flex-col divide-y divide-border rounded-lg border border-border">
          {lead && <div className="px-2 py-1.5">{lead}</div>}
          {steps.map(step => (
            <div key={`${step.kind}-${step.row.key}`} className="px-2 py-1.5">
              {step.kind === 'agent' ? <AgentRow row={step.row} onOpen={onOpen} /> : <SubagentMessage name={step.row.name} text={step.text} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
