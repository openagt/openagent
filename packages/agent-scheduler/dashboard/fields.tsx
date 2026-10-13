import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Label, RadioGroup, RadioGroupItem, RadioGroupOption, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Textarea, cn, useModuleHost, type ModuleProject } from '@openagt/dashboard/module'
import type { PublishPick } from '../src/state.js'
import { AGENTS, AGENT_LABELS, AGENT_SKILLS_DIR, DEFAULT_AGENT, MAX_AGENTS, type AgentName } from '../src/names.js'
import { MAX_COUNT, PACE_UNITS, takesTimeOfDay, type PaceUnit } from '../src/pace.js'
import { triedLine, type TriedLine } from './automation-form.js'
import { UNIT_WORDS, modelLabel, publishChoices, publishLabel, type AgentModels, type AgentsDraft, type PaceDraft, type SchedulerCommand } from './schedulers.js'

// The fields of the Automations page, shared by the Edit panel of a row and the "New automation"
// form, so a thing is picked the same way wherever it is picked: what the agent is told and the
// shell line that says there is work, with "Try it"; when a row runs: what it waits for, said in a
// line, and the one choice a person has, how long it waits after a start; how many agents may work
// on it at once; which coding agent and which model its runs are on; and how far its runs publish.

/** A small text beside or under a field: what it means, or that it is optional. */
const hint = 'text-xs text-muted-foreground'

/** A sentence with its full stop, added only when it has none. */
const stopped = (text: string): string => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)

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
      <Label htmlFor="automation-prompt">What the agent is told</Label>
      <Textarea id="automation-prompt" rows={4} autoFocus={autoFocus} value={said.prompt} onChange={e => onChange({ prompt: e.target.value })} placeholder="Answer each new comment below." />
      <Label htmlFor="automation-when" className="pt-1">
        A shell line that prints what is new <span className={hint}>optional</span>
      </Label>
      <Textarea
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
        className="min-h-12 font-mono text-xs"
      />
      <p className={hint}>
        Run in this project while the row is on: every minute, or once its wait is over. When it prints something, an agent starts and is handed what it printed; when it prints nothing, or an empty list, nothing starts.{' '}
        <span className="font-mono">$LAST_RUN</span> is the time the row last started an agent, or was switched on when that is later.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" disabled={line === '' || tried === 'trying'} onClick={() => void tryIt()}>
          {tried === 'trying' ? 'Trying…' : 'Try it'}
        </Button>
        <span className={hint}>Runs the line once, now, on this machine, for 20 seconds at most. Nothing is saved and no agent starts.</span>
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
          <Label htmlFor="automation-waits-for" className="pt-1">
            What the line waits for, in plain words <span className={hint}>optional, said on the row</span>
          </Label>
          <Input id="automation-waits-for" type="text" value={said.waitsFor} onChange={e => onChange({ waitsFor: e.target.value })} placeholder="when someone commented" className="bg-background" />
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

/** What a row with a shell line waits for, when its words do not say: the line itself. */
export const PRINTS_SOMETHING = 'when its shell line prints something'

/**
 * "When it runs": the one place a row's pace is picked, in two parts that are not the same kind
 * of thing. First what the row waits for, which is no choice: a row with a shell line (`work`)
 * starts only when the line finds work, and the scheduler asks it every minute; a row without
 * one runs by time alone. Then the one choice, "Wait after a start": how long the row leaves
 * between two starts. A row that follows something else has that as its first choice (`asSaid`,
 * its label with what it says: "As the skill says", "6 hours"); then a number and a unit, with a
 * time of day beside days, weeks or months; then "No wait" (`noWait`), where the shell line alone
 * can say when. Beside a shell line a time of day is "not before": the row starts once the line
 * finds work, which may be later that day. Picking the number from another choice starts from
 * `start`. With one choice only there is nothing to pick, and no dot is drawn.
 */
export function PaceFields({
  name,
  draft,
  work,
  asSaid,
  noWait,
  start,
  counted,
  disabled,
  autoFocus,
  onChange,
}: {
  /** What the choices are of, to tell this group from another's. */
  name: string
  draft: PaceDraft
  /** The row has a shell line: what the line waits for, in plain words, when they are said. Absent for a row that runs by time alone. */
  work?: { waitsFor?: string | undefined } | undefined
  asSaid?: { label: string; says: string } | undefined
  /** Whether "No wait" is offered: only where a shell line can say when alone. */
  noWait: boolean
  start: { count: number; unit: PaceUnit }
  /** Where the wait is counted from, in a line. */
  counted: string
  disabled: boolean
  /** Whether the keyboard lands on the choice in force. */
  autoFocus: boolean
  onChange: (next: PaceDraft) => void
}) {
  const typed = draft.kind === 'every' ? draft : { kind: 'every' as const, count: String(start.count), unit: start.unit, at: '' }
  const timed = takesTimeOfDay({ count: 1, unit: typed.unit, ms: 0, text: '' })
  // A pick of "No wait" made before its shell line was taken away still shows, so the person sees what to change.
  const offersNoWait = noWait || draft.kind === 'work'
  const choice = asSaid !== undefined || offersNoWait
  const own = draft.kind === 'every'
  const group = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (autoFocus) group.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus()
  }, [])
  const pick = (kind: unknown): void => onChange(kind === 'every' ? typed : kind === 'work' ? { kind: 'work' } : { kind: 'skill' })
  const interval = (
    // A field typed into is the pick: nobody types a wait and means another choice.
    <div className={cn('flex flex-wrap items-center gap-2 text-sm', !own && 'opacity-60')}>
      <Input type="number" min={1} max={MAX_COUNT} value={typed.count} disabled={disabled} onChange={e => onChange({ ...typed, count: e.target.value })} aria-label="How long" className="h-8 w-20 bg-background px-2" />
      <Select items={PACE_UNITS.map(unit => ({ value: unit, label: unitWord(unit, typed.count) }))} value={typed.unit} disabled={disabled} onValueChange={unit => onChange({ ...typed, unit: unit as PaceUnit })}>
        <SelectTrigger size="sm" aria-label="Unit" className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PACE_UNITS.map(unit => (
            <SelectItem key={unit} value={unit}>
              {unitWord(unit, typed.count)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {timed && (
        <>
          <span>{work ? 'not before' : 'at'}</span>
          <Input
            type="time"
            value={typed.at}
            disabled={disabled}
            // A time left half typed has no text; the browser says so on the field itself.
            onChange={e => onChange({ kind: 'every', count: typed.count, unit: typed.unit, at: e.target.value, ...(e.target.validity.badInput ? { atHalfTyped: true as const } : {}) })}
            aria-label={work ? 'Not before this time of day' : 'Time of day'}
            className="h-8 w-auto bg-background px-2"
          />
          <span className={hint}>optional, this machine's time{typed.unit === 'mo' ? '; a month counts as 30 days' : ''}</span>
        </>
      )}
    </div>
  )
  return (
    <div className="space-y-3">
      <p className="text-sm">
        {work ? (
          <>
            Only when there is work: {stopped(work.waitsFor ?? PRINTS_SOMETHING)} <span className="text-muted-foreground">The scheduler looks every minute.</span>
          </>
        ) : (
          <>
            By time alone. <span className="text-muted-foreground">It starts again once the wait is over.</span>
          </>
        )}
      </p>
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Wait after a start</legend>
        {choice ? (
          <RadioGroup ref={group} aria-label={name} value={draft.kind} onValueChange={pick} disabled={disabled}>
            {asSaid && (
              // On a phone what the skill says goes under the label, which otherwise breaks at every word.
              <RadioGroupOption value="skill">
                {asSaid.label}
                <span className={hint}>({asSaid.says})</span>
              </RadioGroupOption>
            )}
            <div className="flex items-start gap-2">
              <RadioGroupItem value="every" aria-label="A wait you set" className="mt-2" />
              {interval}
            </div>
            {offersNoWait && (
              <RadioGroupOption value="work">
                No wait
                <span className={hint}>{noWait ? 'it starts as soon as there is work' : 'needs a shell line: without one nothing says when'}</span>
              </RadioGroupOption>
            )}
          </RadioGroup>
        ) : (
          interval
        )}
        <p className={hint}>{counted}</p>
      </fieldset>
    </div>
  )
}

/** A unit as its menu names it beside a count: "hour" beside 1, "hours" beside any other. */
function unitWord(unit: PaceUnit, count: string): string {
  return Number(count) === 1 ? UNIT_WORDS[unit] : `${UNIT_WORDS[unit]}s`
}

/**
 * "How many at once": how many agents may work on a row at the same time. A row that follows its
 * skill has that as its first choice (`asSaid`), beside a number the person types; a row a person
 * made has the number alone. A new agent still starts only when the row is due.
 */
export function AgentsFields({ name, draft, asSaid, start, where, disabled, onChange }: { name: string; draft: AgentsDraft; asSaid?: { label: string; says: string } | undefined; start: number; where: string; disabled: boolean; onChange: (next: AgentsDraft) => void }) {
  const typed = draft.kind === 'own' ? draft : { kind: 'own' as const, count: String(start) }
  const count = (
    <div className={cn('flex flex-wrap items-center gap-2 text-sm', draft.kind !== 'own' && 'opacity-60')}>
      <span>Up to</span>
      <Input type="number" min={1} max={MAX_AGENTS} value={typed.count} disabled={disabled} onChange={e => onChange({ kind: 'own', count: e.target.value })} aria-label="How many agents" className="h-8 w-20 bg-background px-2" />
      <span>{Number(typed.count) === 1 ? 'agent' : 'agents'} at once</span>
    </div>
  )
  return (
    <fieldset disabled={disabled} className="space-y-2">
      {asSaid ? (
        <RadioGroup aria-label={name} value={draft.kind} onValueChange={kind => onChange(kind === 'own' ? typed : { kind: 'skill' })} disabled={disabled}>
          <RadioGroupOption value="skill">
            {asSaid.label}
            <span className={hint}>({asSaid.says})</span>
          </RadioGroupOption>
          <div className="flex items-start gap-2">
            <RadioGroupItem value="own" aria-label="A number you set" className="mt-2" />
            {count}
          </div>
        </RadioGroup>
      ) : (
        count
      )}
      <p className={hint}>A new one starts only when the row is due, and only while fewer than this are working {where}.</p>
    </fieldset>
  )
}

/** "What its runs publish": how far a run of the row may go, picked from the levels the project can offer. */
export function PublishField({ gitHost, own, pick, disabled, onChange }: { gitHost: boolean; /** Whether the row is one a person made: it has no skill to follow. */ own: boolean; pick: PublishPick; disabled: boolean; onChange: (next: PublishPick) => void }) {
  const choices = publishChoices(gitHost, pick).map(choice => ({ value: choice, label: publishLabel(choice, own) }))
  return (
    <Select items={choices} value={pick} disabled={disabled} onValueChange={next => onChange(next as PublishPick)}>
      <SelectTrigger size="sm" aria-label="What its runs publish" className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map(choice => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
  // A model picked before that the agent does not list, or has not listed yet, is still the pick.
  const models = [{ value: 'skill', label: follows }, ...listed, ...(model !== 'skill' && !listed.some(m => m.value === model) ? [{ value: model, label: model }] : [])]
  return (
    <fieldset disabled={disabled} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Label htmlFor="automation-agent" className="w-14">
          Agent
        </Label>
        <Select items={AGENTS.map(a => ({ value: a, label: AGENT_LABELS[a] }))} value={agent} disabled={disabled} onValueChange={next => onChange({ agent: next as AgentName, model: 'skill' })}>
          <SelectTrigger id="automation-agent" size="sm" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGENTS.map(a => (
              <SelectItem key={a} value={a} disabled={!command.able.includes(a) && a !== agent}>
                {AGENT_LABELS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Label htmlFor="automation-model" className="w-14">
          Model
        </Label>
        <Select items={models} value={model} disabled={disabled} onValueChange={next => onChange({ agent, model: next as ModelDraft })}>
          <SelectTrigger id="automation-model" size="sm" className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {models.map(m => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
