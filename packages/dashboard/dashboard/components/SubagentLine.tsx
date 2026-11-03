import { useEffect, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '../lib/utils.js'
import { formatElapsed } from '../lib/format-date.js'
import { STATUS_TONE } from '../lib/status-tone.js'
import { anyModelName, useModels } from '../lib/models.js'
import { stepWords, type SubagentRow, type SubagentStep } from '../lib/subagents.js'
import { Markdown } from './Markdown.js'
import { Seconds } from './ToolCalls.js'

// A main agent's subagents in its chat, as Claude Code on the web draws them, in the look of the
// agent's other steps: one grey line that says what is going on and opens to one bordered panel. While
// they work it names one of them, and the seconds are the chat's live line's, as Claude Code on the web
// has one counter; once they ended it says what came of them
// ("Ran 2 agents, received a message"). A row opens the subagent in the pane beside the chat, its
// prompt and its transcript.

/** How long the moving line stays on one working subagent's name. */
const NAME_EVERY_MS = 2500

function toneOf(status: string): string {
  return status === 'waiting' ? 'text-muted-foreground' : (STATUS_TONE[status] ?? 'text-muted-foreground')
}

/** A subagent's row: the verb in grey, its name in dark, its model; while it works the tool it is on; how long it took. */
function AgentRow({ row, onOpen }: { row: SubagentRow; onOpen?: ((key: string) => void) | undefined }) {
  const models = useModels()
  return (
    <button type="button" onClick={() => onOpen?.(row.key)} className="group/sub flex w-full min-w-0 items-center gap-1.5 text-left hover:text-foreground" aria-label={`Open the subagent: ${row.name}`}>
      <span className={cn('shrink-0', row.working && 'text-shimmer')}>{row.working ? 'Running agent' : 'Ran agent'}</span>
      <span className={cn('min-w-0 truncate text-foreground group-hover/sub:underline', row.working && 'text-shimmer')}>{row.name}</span>
      {/* On a phone the name has the line: the model is in the subagent's pane. */}
      {row.model && <span className="shrink-0 max-sm:hidden">{anyModelName(models, row.model)}</span>}
      {row.working
        ? row.calls !== undefined && (
            // What it is on now and how many calls it made; its last step whole on a hover.
            <span className="min-w-0 shrink-0 truncate" title={row.doing}>
              {[row.tool, `${row.calls} ${row.calls === 1 ? 'call' : 'calls'}`].filter(Boolean).join(' · ')}
            </span>
          )
        : row.status !== 'done' && <span className={cn('shrink-0', toneOf(row.status))}>{row.status}</span>}
      <span className="ml-auto shrink-0 tabular-nums" title={`Started ${new Date(row.startedAt).toLocaleString()}`}>
        {row.working ? <Seconds since={row.startedAt} /> : row.endedAt !== undefined ? formatElapsed(Date.parse(row.endedAt) - Date.parse(row.startedAt)) : null}
        {row.cost !== undefined && ` · $${row.cost.toFixed(2)}`}
      </span>
    </button>
  )
}

/**
 * What a subagent sent its main agent, folded: "Message from subagent". Opened, whose it is and the
 * message. One that did not end well says how, beside the words.
 */
export function SubagentMessage({ name, text, status, detail }: { name: string; text?: string | undefined; status?: string | undefined; detail?: string | undefined }) {
  const [open, setOpen] = useState(false)
  const body = text !== undefined && text !== ''
  const words = (
    <>
      <span className="shrink-0">Message from</span>
      <span className="shrink-0 text-foreground">subagent</span>
      {status !== undefined && status !== 'done' && <span className={cn('shrink-0', toneOf(status))}>{status}</span>}
    </>
  )
  return (
    <div className="min-w-0 flex-1 font-sans text-sm text-muted-foreground">
      {body || detail !== undefined ? (
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Message from subagent" className="flex max-w-full min-w-0 items-center gap-1.5 py-0.5 text-left hover:text-foreground">
          {words}
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
        </button>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5 py-0.5">{words}</div>
      )}
      {open && (
        <div className="mt-1 flex flex-col gap-1">
          <div>From: {name}{detail !== undefined && ` (${detail})`}</div>
          {body && <div className="text-foreground"><Markdown text={text} /></div>}
        </div>
      )}
    </div>
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
          {current ? (
            <>
              <span key={current.key} className="morph-in min-w-0 truncate text-left text-shimmer">
                {current.name}
              </span>
            </>
          ) : (
            <span key={words} className="morph-in min-w-0 truncate text-left group-hover/status:text-foreground/80 group-has-focus-visible/status:text-foreground/80">
              {words}
            </span>
          )}
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
