import { useEffect, useState } from 'react'
import { Button, type ModuleCommandResult, type ModuleProject } from '@openagt/dashboard/module'
import type { PublishPick } from '../src/state.js'
import { MAX_AGENTS, OWN_AUTOMATIONS_DIR, type AgentName } from '../src/names.js'
import { parseInterval, parseTimeOfDay } from '../src/pace.js'
import { atRowsPace, draftProblem, draftRow, editArgs, editedWords, keptWhereHint, ownPaceArgs, removeWarning, removedWords, savedFile, saysTheSame, type AutomationDraft, type OpenedAutomation, type OwnPace } from './automation-form.js'
import { AgentsFields, PaceFields, PublishField, RunsOnFields, SaidFields, SaidShown, Section, type ModelDraft } from './fields.js'
import { RESUMES_ON, agentOf, agentsArgs, agentsDraftOf, atOnce, atOnceWords, draftOf, isOwn, pace, runsOnWords, paceArgs, paceProblem, publishes, rowTitle, saysAtOnce, spelled, withDraft, type AgentModels, type AgentsDraft, type PaceDraft, type SchedulerCommand } from './schedulers.js'

// The Edit panel of the Automations page: one panel, with the same parts in the same order, for
// every row. What it does; when it runs: what it waits for, and how long it waits after a start; how many agents at once; what it runs on, a coding agent
// and a model; what its runs publish. A row that resumes runs has no agent, model or publish level to pick: each run goes on with its own, and the panel says so.
//
// A row that comes from a skill of the project shows what it does greyed, since its words are the
// skill's, and its picks are this machine's: `agent-scheduler pace`, `agents`, `agent`, `model` and
// `publish`, and no tracked file changes. Its pace may follow the skill.
//
// A row a person made with "New automation" opens with its own words to change: what the agent is
// told, and its shell line. Its pace is picked in the same place and is the automation's own,
// saved into its file with its words (`agent-scheduler edit`); only a time of day, which is this
// machine's, is kept here (`pace`). It can be removed, after one question (`remove`). When its
// file cannot be opened, changed by hand since it was saved, the panel says why and shows it as a
// skill's row.
//
// Save sends only what changed, one command after the other, each only once the one before it is
// taken; one that is not taken stops there and says why, with everything still as picked.

const lower = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1)

/** A sentence with its full stop, added only when it has none. */
const stopped = (text: string): string => (/[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)

/** What a save of an automation's file answered: the file, where a run's checkout starts, and whether it is kept on this machine alone. */
type Written = ReturnType<typeof savedFile>

/** The pace this machine holds for a row, as `pace <command>` would be given it: `skill` when it holds none. */
function heldPace(row: SchedulerCommand): string[] {
  const pick = row.pace
  if (pick === undefined) return ['skill']
  if ('work' in pick) return ['work']
  const at = pick.at === undefined ? undefined : (parseTimeOfDay(pick.at)?.text ?? pick.at)
  return [parseInterval(pick.every)?.text ?? pick.every, ...(at !== undefined ? [at] : [])]
}

export function EditPanel({
  project,
  scheduled,
  opened,
  refused,
  schedulerModel,
  agents: codingAgents,
  run,
  reload,
  onDirty,
  onClose,
  onRemoved,
}: {
  project: ModuleProject
  scheduled: SchedulerCommand
  /** The row's own automation as its file says it, for a row a person made: its words are then the panel's to change. */
  opened?: OpenedAutomation | undefined
  /** Why the file of a row a person made could not be opened. */
  refused?: string | undefined
  /** The scheduler's own model: what a run on Claude Code starts on when neither its skill nor a person names another. */
  schedulerModel: string | undefined
  /** Every coding agent with the models it lists. */
  agents: readonly AgentModels[]
  /** Run one command of the scheduler in the project, in turn with the page's other saves. */
  run: (args: string[]) => Promise<ModuleCommandResult>
  /** Read the rows again: a save is over once what it saved has been read back. */
  reload: () => Promise<unknown>
  /** Whether something in the panel is changed and not saved: closing it then would lose it. */
  onDirty: (dirty: boolean) => void
  onClose: () => void
  /** The row's automation was removed: what was deleted and what is left for the person to do. */
  onRemoved: (text: string) => void
}) {
  const title = rowTitle(scheduled)
  /** What the file said when the panel opened, or was last saved from here. */
  const [file, setFile] = useState<AutomationDraft | undefined>(opened?.draft)
  /** The row's own automation as the panel opened: what its file said, at the pace the row ran at here. */
  const [base] = useState<AutomationDraft | undefined>(() => (opened ? atRowsPace(opened.draft, scheduled) : undefined))
  const [own, setOwn] = useState<AutomationDraft | undefined>(base)
  const [paceDraft, setPaceDraft] = useState<PaceDraft>(() => draftOf(scheduled))
  const [agents, setAgents] = useState<AgentsDraft>(() => (opened ? { kind: 'own', count: String(atOnce(scheduled)) } : agentsDraftOf(scheduled)))
  const [runsOn, setRunsOn] = useState<{ agent: AgentName; model: ModelDraft }>(() => ({ agent: agentOf(scheduled), model: scheduled.model ?? 'skill' }))
  const [publish, setPublish] = useState<PublishPick>(scheduled.publish)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<string | undefined>()
  const [asking, setAsking] = useState(false)
  /** What the file said when the panel last read or wrote it, by the name the tool gives it: a save is held against it, so it writes over no change made to the file by hand since. */
  const [version, setVersion] = useState<string | undefined>(opened?.version)
  /** The file as a save from here wrote it: said once the save is over, and with a later step that was not taken. */
  const [written, setWritten] = useState<Written | undefined>()
  const [saved, setSaved] = useState<Written | undefined>()

  // What each part would send, and whether it differs from what the row has now.
  const counted = agentsArgs(agents)
  // A row a person made has a number alone: the one its file gives is no pick of this machine's.
  const ownCount = (typed: string): string => (own && typed === String(scheduled.skillAgents ?? 1) ? 'skill' : typed)
  const count = counted === undefined ? undefined : ownCount(counted[0]!)
  const paced = own ? ownPaceArgs(own) : paceArgs(paceDraft)
  // Whether the person changed the row's own words or pace. Held against the panel as it opened, not against the file: a pace picked on
  // this machine before the page had one place for it opens as the row's pace, and goes into the file only with a change of theirs.
  const touched = own !== undefined && base !== undefined && (!saysTheSame(own, base) || ownPaceArgs(own)?.join(' ') !== ownPaceArgs(base)?.join(' '))
  const changes = {
    file: touched && own !== undefined && file !== undefined && !saysTheSame(own, file),
    // A row a person made keeps only a time of day here: whatever else this machine holds for it goes once its pace is in its file.
    pace: paced !== undefined && (own ? touched && paced.join(' ') !== heldPace(scheduled).join(' ') : paced.join(' ') !== paceArgs(draftOf(scheduled))!.join(' ')),
    agents: count !== undefined && count !== ownCount(agentsArgs(agentsDraftOf(scheduled))![0]!),
    agent: runsOn.agent !== agentOf(scheduled),
    // Picking an agent takes the model picked for the row back, so a model picked with another agent is always sent after it.
    model: runsOn.model !== (scheduled.model ?? 'skill') || (runsOn.agent !== agentOf(scheduled) && runsOn.model !== 'skill'),
    publish: publish !== scheduled.publish,
  }
  const dirty = touched || changes.pace || changes.agents || changes.agent || changes.model || changes.publish
  // Words that are not sent are not held against the form's limits: a prompt made longer by hand, in its file, still lets the row's picks be saved.
  const problem = (own && opened ? (changes.file ? draftProblem(own, opened.file) : paceProblem(own.pace)) : paceProblem(paceDraft)) ?? (counted ? undefined : `Type a whole number of agents, from 1 to ${MAX_AGENTS}.`)
  useEffect(() => onDirty(dirty && !saved), [dirty, saved])
  useEffect(() => () => onDirty(false), [])

  /** The row as it would read with everything in the panel saved: what the sentence under the fields describes. */
  const would = ((): SchedulerCommand | undefined => {
    if (count === undefined) return undefined
    let row: SchedulerCommand
    if (own) {
      // What its file would say, and the time of day this machine would hold, in place of what the row has now.
      const drafted = draftRow(own)
      if (!drafted) return undefined
      const { pace: _pace, every: _every, when: _when, waitsFor: _waitsFor, ...rest } = scheduled
      const { command: _command, on: _on, publish: _publish, ...said } = drafted
      row = { ...rest, ...said }
    } else {
      if (!paceArgs(paceDraft)) return undefined
      row = withDraft(scheduled, paceDraft)
    }
    const { agents: _agents, ...rest } = row
    const { runsOn: _runsOn, model: _model, ...unpicked } = { ...rest, ...(count !== 'skill' ? { agents: Number(count) } : {}), publish }
    return { ...unpicked, ...(runsOn.agent !== scheduled.home ? { runsOn: runsOn.agent } : {}), ...(runsOn.model !== 'skill' ? { model: runsOn.model } : {}) }
  })()
  const sentence = would && `${pace(would)}. ${saysAtOnce(would) ? `${atOnceWords(atOnce(would))}. ` : ''}${runsOnWords(would, schedulerModel, codingAgents)}.${would.resumes ? '' : ` ${publishes(would)}.`}`

  const save = async (): Promise<void> => {
    if (problem !== undefined || paced === undefined || count === undefined) return
    const steps: [what: string, args: string[]][] = []
    if (changes.file && own && opened) steps.push(['It', [...editArgs(own, opened.file)!, ...(version !== undefined ? [`--was=${version}`] : [])]])
    if (changes.pace) steps.push(['The pace', ['pace', scheduled.command, ...paced]])
    if (changes.agents) steps.push(['The number of agents', ['agents', scheduled.command, count]])
    if (changes.agent) steps.push(['The agent', ['agent', scheduled.command, runsOn.agent === scheduled.home ? 'skill' : runsOn.agent]])
    if (changes.model && !(changes.agent && runsOn.model === 'skill')) steps.push(['The model', ['model', scheduled.command, runsOn.model]])
    if (changes.publish) steps.push(['The publish pick', ['publish', scheduled.command, publish]])
    setSaving(true)
    setFailed(undefined)
    let wrote = written
    for (const [what, args] of steps) {
      const answer = await run(args)
      if (!answer.ok) {
        await reload().catch(() => {})
        setSaving(false)
        // A file written by an earlier step stays written: the person is told, since nothing else would say so.
        const why = `${what} was not saved: ${answer.error}`
        return setFailed(wrote ? `${stopped(why)} Its words and its pace are saved, in ${wrote.file}${wrote.onThisMachine ? '' : ': a change of yours to commit'}.` : why)
      }
      if (args[0] === 'edit') {
        wrote = savedFile(answer.output)
        setWritten(wrote)
        setFile(own)
        setVersion(wrote.version)
      }
    }
    await reload().catch(() => {})
    setSaving(false)
    // A change to a shared file is the person's to commit: the panel says so before it goes. Any other save is on the row already.
    if (wrote && !wrote.onThisMachine) setSaved(wrote)
    else onClose()
  }

  const remove = async (): Promise<void> => {
    setSaving(true)
    setFailed(undefined)
    const answer = await run(['remove', scheduled.command])
    if (answer.ok) onRemoved(removedWords(title, answer.output))
    await reload().catch(() => {})
    setSaving(false)
    if (!answer.ok) setFailed(`It was not removed: ${answer.error}`)
  }

  /** Back from the question to the panel: why a removal was not taken is said in the question alone. */
  const back = (): void => (setAsking(false), setFailed(undefined))

  const frame = 'mt-3 rounded-md border border-border bg-muted/40 p-4'

  if (saved) {
    return (
      <div role="group" aria-label={`Editing ${title}`} className={`${frame} text-sm`}>
        <p>
          Saved <span className="font-mono">{title}</span> again, in <span className="font-mono">{saved.file}</span>.
        </p>
        <p className="mt-2">{editedWords(saved)}</p>
        <div className="mt-3 flex justify-end">
          <Button size="sm" autoFocus onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  if (asking) {
    return (
      <div
        role="group"
        aria-label={`Removing ${title}`}
        onKeyDown={e => {
          if (e.key === 'Escape' && !saving) back()
        }}
        className={`${frame} text-sm`}
      >
        <p>
          Remove <span className="font-mono">{title}</span>?
        </p>
        <p className="mt-2">{removeWarning(scheduled)}</p>
        {failed !== undefined && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {failed}
          </p>
        )}
        <div className="mt-3 flex justify-end gap-2">
          {/* The keyboard lands on the way out, not on the deletion. */}
          <Button variant="outline" size="sm" autoFocus disabled={saving} onClick={back}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={saving} onClick={() => void remove()}>
            Remove
          </Button>
        </div>
      </div>
    )
  }

  const where = scheduled.onThisMachine ? 'on this machine' : 'on any machine that shares this repository'
  const skills = scheduled.every === undefined ? undefined : parseInterval(scheduled.every)
  const asSaid = scheduled.onThisMachine || scheduled.editable ? 'As it was saved' : 'As the skill says'
  return (
    <div
      role="group"
      aria-label={`Editing ${title}`}
      onKeyDown={e => {
        // Escape closes a panel that has nothing to lose. Any other is closed with Cancel, so a slip of a key loses no prompt and no pick.
        if (e.key === 'Escape' && !saving && !dirty) onClose()
      }}
      className={`${frame} space-y-5`}
    >
      <Section title="What it does">
        {own ? (
          <fieldset disabled={saving} className="space-y-2">
            <SaidFields project={project} said={own} agent={runsOn.agent} autoFocus onChange={change => (setOwn({ ...own, ...change }), setFailed(undefined))} />
          </fieldset>
        ) : (
          <SaidShown
            description={scheduled.description}
            when={scheduled.when}
            waitsFor={scheduled.waitsFor}
            where={
              refused !== undefined
                ? `Its words cannot be changed here: ${refused}`
                : scheduled.onThisMachine
                  ? `Its words cannot be changed here: its file was changed by hand since it was saved. They are changed in the file itself, ${OWN_AUTOMATIONS_DIR}/${scheduled.command}.md.`
                  : `Its words are its skill's, ${title}: they are changed in the skill's file, by whoever writes the skill.`
            }
          />
        )}
      </Section>
      <Section title="When it runs">
        {own ? (
          <PaceFields
            name={`How long ${title} waits after a start`}
            draft={own.pace}
            work={own.when.trim() !== '' ? { waitsFor: own.waitsFor.trim() || undefined } : undefined}
            noWait={own.when.trim() !== ''}
            start={{ count: 1, unit: 'd' }}
            counted={`Counted from its last start, ${where}.`}
            disabled={saving}
            autoFocus={false}
            onChange={next => (setOwn({ ...own, pace: next as OwnPace }), setFailed(undefined))}
          />
        ) : (
          <PaceFields
            name={`How long ${title} waits after a start`}
            draft={paceDraft}
            work={scheduled.when !== undefined ? { waitsFor: scheduled.waitsFor } : undefined}
            asSaid={{ label: asSaid, says: scheduled.every !== undefined ? spelled(scheduled.every) : 'no wait' }}
            noWait={scheduled.when !== undefined && scheduled.every !== undefined}
            start={{ count: skills?.count ?? 1, unit: skills?.unit ?? 'd' }}
            counted={`Counted from its last start, ${where}.`}
            disabled={saving}
            autoFocus
            onChange={next => (setPaceDraft(next), setFailed(undefined))}
          />
        )}
      </Section>
      <Section title="How many at once">
        <AgentsFields
          name={`How many of ${title} at once`}
          draft={agents}
          asSaid={own ? undefined : { label: asSaid, says: lower(atOnceWords(scheduled.skillAgents ?? 1)) }}
          start={scheduled.skillAgents ?? 1}
          where={where}
          disabled={saving}
          onChange={next => (setAgents(next), setFailed(undefined))}
        />
      </Section>
      <Section title="What it runs on">
        {/* A row that resumes has no agent, model or publish level to pick: each run goes on with its own. */}
        {scheduled.resumes ? (
          <p className="text-sm text-muted-foreground">{RESUMES_ON}.</p>
        ) : (
          <RunsOnFields command={scheduled} schedulerModel={schedulerModel} agents={codingAgents} agent={runsOn.agent} model={runsOn.model} disabled={saving} onChange={next => (setRunsOn(next), setFailed(undefined))} />
        )}
      </Section>
      {!scheduled.resumes && (
        <Section title="What its runs publish">
          <PublishField gitHost={project.gitHost} own={isOwn(scheduled)} pick={publish} disabled={saving} onChange={next => (setPublish(next), setFailed(undefined))} />
        </Section>
      )}
      <p className="rounded-md border border-border bg-background px-3 py-2 text-sm">{problem ?? (dirty ? sentence : `${sentence} Nothing is changed yet.`)}</p>
      {failed !== undefined && (
        <p role="alert" className="text-xs text-danger">
          {failed}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">{keptWhereHint(opened)}</p>
        <div className="flex gap-2">
          {/* Only what the tool wrote is the tool's to delete. */}
          {scheduled.editable && opened && (
            <Button variant="outline" size="sm" disabled={saving} onClick={() => (setAsking(true), setFailed(undefined))} className="text-danger">
              Remove
            </Button>
          )}
          <Button variant="outline" size="sm" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving || problem !== undefined || !dirty} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
