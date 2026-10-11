import { useRef, useState, type ReactNode } from 'react'
import { Button, cn, useModuleHost, type ModuleProject } from '@openagt/dashboard/module'
import type { PublishPick } from '../src/state.js'
import { AGENTS, AGENT_LABELS, AGENT_SKILLS_DIR, DEFAULT_AGENT, MAX_AGENTS, type AgentName } from '../src/names.js'
import { MAX_COUNT, PACE_UNITS, takesTimeOfDay, type PaceUnit } from '../src/pace.js'
import { triedLine, type TriedLine } from './automation-form.js'
import { UNIT_WORDS, modelLabel, publishChoices, publishLabel, type AgentModels, type AgentsDraft, type PaceDraft, type SchedulerCommand } from './schedulers.js'

// The fields of the Automations page, shared by the Edit panel of a row and the "New automation"
// form, so a thing is picked the same way wherever it is picked: what the agent is told and the
// shell line that says there is work, with "Try it"; when a row runs, the one pace control; how
// many agents may work on it at once; which coding agent and which model its runs are on; and how
// far its runs publish.

const field = 'rounded-md border border-border bg-background px-2 py-1 text-sm disabled:opacity-50'

/** A part of a panel: its name, then its fields. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  )
}

/** What a person's own automation says, as typed: what the agent is told, its shell line, and what the line waits for. */
export interface Said {
  prompt: string
  when: string
  waitsFor: string
}

/**
 * "What it does", for an automation a person wrote: what the agent is told, and an optional shell
 * line that prints what is new, with what it waits for in plain words. "Try it" runs the line
 * once in the project and shows what it printed and whether an agent would start; nothing is
 * saved and nothing starts. The answer shown is for the line as it stands: changing the line
 * takes it away, and an answer that comes back late is dropped.
 */
export function SaidFields({ project, said, autoFocus, onChange }: { project: ModuleProject; said: Said; autoFocus: boolean; onChange: (change: Partial<Said>) => void }) {
  const host = useModuleHost()
  const [tried, setTried] = useState<'trying' | TriedLine | undefined>()
  /** The last try asked for: an answer to an earlier one, come back late, changes nothing. */
  const asked = useRef(0)
  const line = said.when.trim()
  const tryIt = async (): Promise<void> => {
    const mine = ++asked.current
    setTried('trying')
    const answer = await host.runCommand(project.id, ['try', `--when=${line}`]).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    if (asked.current !== mine) return
    setTried(answer.ok ? triedLine(answer.output) : { printed: '', verdict: `The line could not be tried: ${answer.error}`, tone: 'failed' })
  }
  return (
    <>
      <label htmlFor="automation-prompt" className="block text-sm">
        What the agent is told
      </label>
      <textarea id="automation-prompt" rows={4} autoFocus={autoFocus} value={said.prompt} onChange={e => onChange({ prompt: e.target.value })} placeholder="Answer each new comment below." className={cn(field, 'block w-full')} />
      <label htmlFor="automation-when" className="block pt-1 text-sm">
        A shell line that prints what is new <span className="text-xs text-muted-foreground">optional</span>
      </label>
      <textarea
        id="automation-when"
        rows={2}
        value={said.when}
        onChange={e => {
          onChange({ when: e.target.value })
          // The answer shown, and a try in flight, were for the line as it was.
          asked.current++
          setTried(undefined)
        }}
        placeholder={'gh api "repos/{owner}/{repo}/issues/comments?since=$LAST_RUN" --jq \'[.[] | select(.body | startswith("🤖") | not) | {url: .html_url}]\''}
        spellCheck={false}
        className={cn(field, 'block w-full font-mono text-xs')}
      />
      <p className="text-xs text-muted-foreground">
        Run in this project while the row is on: every minute, or once its pace has passed. When it prints something, an agent starts and is handed what it printed; when it prints nothing, or an empty list, nothing starts.{' '}
        <span className="font-mono">$LAST_RUN</span> is the time the row last started an agent, or was switched on when that is later.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" disabled={line === '' || tried === 'trying'} onClick={() => void tryIt()}>
          {tried === 'trying' ? 'Trying…' : 'Try it'}
        </Button>
        <span className="text-xs text-muted-foreground">Runs the line once, now, on this machine, for 20 seconds at most. Nothing is saved and no agent starts.</span>
      </div>
      {tried !== undefined && tried !== 'trying' && (
        <div role="status" aria-label="What the line answered" className="rounded-md border border-border bg-background px-3 py-2 text-sm">
          <p className={cn(tried.tone === 'start' && 'text-success', tried.tone === 'failed' && 'text-danger')}>{tried.verdict}</p>
          {tried.printed !== '' && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{tried.printed}</pre>}
          {tried.lastRun !== undefined && <p className="mt-2 text-xs text-muted-foreground">Tried as if the row had last started a day ago: $LAST_RUN was {tried.lastRun}.</p>}
        </div>
      )}
      {line !== '' && (
        <>
          <label htmlFor="automation-waits-for" className="block pt-1 text-sm">
            What the line waits for, in plain words <span className="text-xs text-muted-foreground">optional, said on the row</span>
          </label>
          <input id="automation-waits-for" type="text" value={said.waitsFor} onChange={e => onChange({ waitsFor: e.target.value })} placeholder="when someone commented" className={cn(field, 'block w-full')} />
        </>
      )}
    </>
  )
}

/**
 * "What it does", for a row whose words are not the panel's to change: a skill of the project, or
 * an automation whose file the panel could not open. Greyed: what it says it does, its shell line
 * when it has one, and where its words are changed.
 */
export function SaidShown({ description, when, waitsFor, where }: { description?: string | undefined; when?: string | undefined; waitsFor?: string | undefined; where: string }) {
  return (
    <div className="space-y-2 opacity-70">
      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">{description ?? 'It does not say.'}</p>
      {when !== undefined && (
        <>
          <p className="text-sm">Its shell line{waitsFor !== undefined && <span className="text-xs text-muted-foreground"> {waitsFor}</span>}</p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">{when}</pre>
        </>
      )}
      <p className="text-xs text-muted-foreground">{where}</p>
    </div>
  )
}

/**
 * "When it runs": the one place a row's pace is picked. A row that follows something else has
 * that as its first choice: `asSaid`, its label with what it says ("As the skill says", "every 6
 * hours at most…"). Then `work`, the label of "whenever there is work" where the row has a check
 * that can pace it alone. Then every so many of a unit, with a time of day beside days, weeks or
 * months. Picking "Every" from another choice starts from `start`, a count and a unit.
 */
export function PaceFields({
  name,
  draft,
  asSaid,
  work,
  everyHint,
  start,
  counted,
  disabled,
  autoFocus,
  onChange,
}: {
  /** What the choices are of, to tell this group of radios from another's. */
  name: string
  draft: PaceDraft
  asSaid?: { label: string; says: string } | undefined
  work?: { label: string; disabled?: boolean } | undefined
  /** What the words beside the interval say of it. */
  everyHint?: string | undefined
  start: { count: number; unit: PaceUnit }
  /** Where the pace is counted from, in a line. */
  counted: string
  disabled: boolean
  /** Whether the keyboard lands on the choice in force. */
  autoFocus: boolean
  onChange: (next: PaceDraft) => void
}) {
  const typed = draft.kind === 'every' ? draft : { kind: 'every' as const, count: String(start.count), unit: start.unit, at: '' }
  const timed = takesTimeOfDay({ count: 1, unit: typed.unit, ms: 0, text: '' })
  return (
    <fieldset disabled={disabled} className="space-y-2">
      {asSaid && (
        // On a phone what the skill says goes under the label, which otherwise breaks at every word.
        <label className="flex items-center gap-2 text-sm max-md:flex-wrap">
          <input type="radio" name={name} autoFocus={autoFocus && draft.kind === 'skill'} checked={draft.kind === 'skill'} onChange={() => onChange({ kind: 'skill' })} />
          {asSaid.label}
          <span className="text-xs text-muted-foreground">{asSaid.says}</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name={name} autoFocus={autoFocus && draft.kind === 'every'} checked={draft.kind === 'every'} onChange={() => onChange(typed)} />
          Every
        </label>
        <input type="number" min={1} max={MAX_COUNT} value={typed.count} disabled={draft.kind !== 'every'} onChange={e => onChange({ ...typed, count: e.target.value })} aria-label="How many" className={cn(field, 'w-20')} />
        <select value={typed.unit} disabled={draft.kind !== 'every'} onChange={e => onChange({ ...typed, unit: e.target.value as PaceUnit })} aria-label="Unit" className={field}>
          {PACE_UNITS.map(unit => (
            <option key={unit} value={unit}>
              {Number(typed.count) === 1 ? UNIT_WORDS[unit] : `${UNIT_WORDS[unit]}s`}
            </option>
          ))}
        </select>
        {timed && (
          <>
            <span>at</span>
            <input
              type="time"
              value={typed.at}
              disabled={draft.kind !== 'every'}
              // A time left half typed has no text; the browser says so on the field itself.
              onChange={e => onChange({ kind: 'every', count: typed.count, unit: typed.unit, at: e.target.value, ...(e.target.validity.badInput ? { atHalfTyped: true as const } : {}) })}
              aria-label="Time of day"
              className={field}
            />
            <span className="text-xs text-muted-foreground">optional, this machine's time{typed.unit === 'mo' ? '; a month counts as 30 days' : ''}</span>
          </>
        )}
        {everyHint !== undefined && draft.kind === 'every' && <span className="text-xs text-muted-foreground">{everyHint}</span>}
      </div>
      {work && (
        <label className={cn('flex items-center gap-2 text-sm', work.disabled && 'opacity-50')}>
          <input type="radio" name={name} autoFocus={autoFocus && draft.kind === 'work'} checked={draft.kind === 'work'} disabled={work.disabled === true && draft.kind !== 'work'} onChange={() => onChange({ kind: 'work' })} />
          {work.label}
        </label>
      )}
      <p className="text-xs text-muted-foreground">{counted}</p>
    </fieldset>
  )
}

/**
 * "How many at once": how many agents may work on a row at the same time. A row that follows its
 * skill has that as its first choice (`asSaid`), beside a number the person types; a row a person
 * made has the number alone. A new agent still starts only when the row is due.
 */
export function AgentsFields({ name, draft, asSaid, start, where, disabled, onChange }: { name: string; draft: AgentsDraft; asSaid?: { label: string; says: string } | undefined; start: number; where: string; disabled: boolean; onChange: (next: AgentsDraft) => void }) {
  const typed = draft.kind === 'own' ? draft : { kind: 'own' as const, count: String(start) }
  return (
    <fieldset disabled={disabled} className="space-y-2">
      {asSaid && (
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name={name} checked={draft.kind === 'skill'} onChange={() => onChange({ kind: 'skill' })} />
          {asSaid.label}
          <span className="text-xs text-muted-foreground">{asSaid.says}</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          {asSaid && <input type="radio" name={name} checked={draft.kind === 'own'} onChange={() => onChange(typed)} />}
          Up to
        </label>
        <input type="number" min={1} max={MAX_AGENTS} value={typed.count} disabled={draft.kind !== 'own'} onChange={e => onChange({ kind: 'own', count: e.target.value })} aria-label="How many agents" className={cn(field, 'w-20')} />
        <span>{Number(typed.count) === 1 ? 'agent' : 'agents'} at once</span>
      </div>
      <p className="text-xs text-muted-foreground">A new one starts only when the row is due, and only while fewer than this are working {where}.</p>
    </fieldset>
  )
}

/** "What its runs publish": how far a run of the row may go, picked from the levels the project can offer. */
export function PublishField({ gitHost, own, pick, disabled, onChange }: { gitHost: boolean; /** Whether the row is one a person made: it has no skill to follow. */ own: boolean; pick: PublishPick; disabled: boolean; onChange: (next: PublishPick) => void }) {
  return (
    <select value={pick} disabled={disabled} onChange={e => onChange(e.target.value as PublishPick)} aria-label="What its runs publish" className={field}>
      {publishChoices(gitHost, pick).map(choice => (
        <option key={choice} value={choice}>
          {publishLabel(choice, own)}
        </option>
      ))}
    </select>
  )
}

/** The model a row's runs start on, while a person picks: the one that follows from its skill and the scheduler (`skill`), or a model's id. */
export type ModelDraft = 'skill' | (string & {})

/**
 * "Which agent" and "Which model": the coding agent a row's runs are on, and the model they start
 * on. An agent whose own skills folder does not hold the row's skill cannot run it, and is
 * offered greyed with why. The models are the picked agent's own list; the first choice is the
 * one that follows when nobody picks: what the skill names, else the scheduler's model on Claude
 * Code, else the agent's own default. Picking another agent starts its model from that choice.
 */
export function RunsOnFields({
  command,
  schedulerModel,
  agents,
  agent,
  model,
  disabled,
  onChange,
}: {
  command: Pick<SchedulerCommand, 'skillModel' | 'skillModelAgent' | 'able'>
  /** The scheduler's own model, which a run on Claude Code starts on when nothing else names one. */
  schedulerModel: string | undefined
  /** Every coding agent with the models it lists. */
  agents: readonly AgentModels[]
  agent: AgentName
  model: ModelDraft
  disabled: boolean
  onChange: (next: { agent: AgentName; model: ModelDraft }) => void
}) {
  const lists = agents.find(a => a.value === agent)
  const listed = lists?.models ?? []
  const follows = agent === command.skillModelAgent && command.skillModel !== undefined ? `As the skill says (${modelLabel(agents, agent, command.skillModel)})` : agent === DEFAULT_AGENT ? `The scheduler's model${schedulerModel !== undefined ? ` (${modelLabel(agents, agent, schedulerModel)})` : ''}` : `${AGENT_LABELS[agent]}'s own default`
  const unable = AGENTS.filter(a => !command.able.includes(a))
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="automation-agent" className="w-14">
          Agent
        </label>
        <select id="automation-agent" value={agent} onChange={e => onChange({ agent: e.target.value as AgentName, model: 'skill' })} className={field}>
          {AGENTS.map(a => (
            <option key={a} value={a} disabled={!command.able.includes(a) && a !== agent}>
              {AGENT_LABELS[a]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="automation-model" className="w-14">
          Model
        </label>
        <select id="automation-model" value={model} onChange={e => onChange({ agent, model: e.target.value })} className={field}>
          <option value="skill">{follows}</option>
          {listed.map(m => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
          {/* A model picked before that the agent does not list, or has not listed yet, is still the pick. */}
          {model !== 'skill' && !listed.some(m => m.value === model) && <option value={model}>{model}</option>}
        </select>
      </div>
      {/* Why the agent's own models are not offered: it is still being asked, or could not say. A model can still be picked by its id from the command line. */}
      {listed.length === 0 && lists?.modelsNote !== undefined && <p className="text-xs text-muted-foreground">{lists.modelsNote}</p>}
      {unable.map(a => (
        <p key={a} className="text-xs text-muted-foreground">
          {AGENT_LABELS[a]} cannot run this row: it reads the project's skills from <span className="font-mono">{AGENT_SKILLS_DIR[a]}</span>, and this row's skill is not there.
        </p>
      ))}
      {agent !== DEFAULT_AGENT && <p className="text-xs text-muted-foreground">How much of {AGENT_LABELS[agent]}'s quota is left cannot be read, so its runs start without that check, and their cost is not recorded.</p>}
    </fieldset>
  )
}
