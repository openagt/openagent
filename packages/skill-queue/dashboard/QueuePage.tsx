import { useId, useRef, useState } from 'react'
import { CornerDownLeft, FastForward, Play, Trash2 } from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  ComposedField,
  ComposedFieldFoot,
  ComposedFieldInput,
  ConfirmDialog,
  Empty,
  Page,
  PanelGroup,
  PanelRow,
  Popover,
  PopoverContent,
  PopoverTrigger,
  PriorityBadge,
  RowShapes,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slot,
  StartAgentButton,
  StateCell,
  inPlace,
  pathsIn,
  useFileNames,
  runsAgain,
  useModuleHost,
  useOpenAgentDown,
  usePolled,
  useSchedule,
  type FileNames,
  type ModuleAgent,
  type ModulePageProps,
  type ModuleProject,
  type Schedule,
} from '@openagt/dashboard/module'
import type { PlacedEntry } from '../src/queue.js'
import { DEFAULT_PRIORITY, PRIORITIES, QUEUE_COMMAND, addTextArgs, doneArgs, entryTarget, fanOutLabel, fanOutPress, isPlacedEntry, isWorkingOn, ordinal, priorityMeaning, priorityName, readEntries, unclaimedEntries, workOnEntryPrompt } from '../src/module.js'
import { AgentOnEntry, entryView } from './entry.js'
import { useQueueStarts, type QueueStarts } from './starts.js'
import { BatchCount } from './batch-count.js'

/** One project's queue as read: its entries with their sections and the project's agents at work, or why the command failed. */
interface ProjectRead {
  project: ModuleProject
  entries?: PlacedEntry[]
  /** The project's agents that are working now or waiting on the person: an entry one of them was asked is being worked on. */
  working: ModuleAgent[]
  error?: string
}

const NOTHING_READ: ProjectRead[] = []

/** An entry with its place in the order of work, counted from 1 across the sections, and the agent on it. */
interface Numbered extends PlacedEntry {
  place: number
  agent: ModuleAgent | undefined
}

/**
 * The entries as the file runs, each run of neighbours in one section under one header: the file's
 * order is the order agents take them, so an entry above the first section shows first. Numbered
 * in that order, across the sections.
 */
function sections(entries: PlacedEntry[], working: ModuleAgent[]): { priority: number | undefined; entries: Numbered[] }[] {
  const runs: { priority: number | undefined; entries: Numbered[] }[] = []
  entries.forEach((placed, index) => {
    const last = runs[runs.length - 1]
    const numbered = { ...placed, place: index + 1, agent: working.find(agent => isWorkingOn(agent.ask, placed.entry)) }
    if (last && last.priority === placed.priority) last.entries.push(numbered)
    else runs.push({ priority: placed.priority, entries: [numbered] })
  })
  return runs
}

/**
 * The Queue page: every project's open entries, in the order agents will take them, under the
 * priority section each sits in, from `queue --local --full` in each project. A place to act: the
 * page's head says whether anything takes from the queue by itself; an entry is started here, alone
 * or as a batch from the top, as on the Overview's card; an entry is removed, and a new one added,
 * through the same `queue done` and `queue add` an agent runs. An entry that names a file another
 * page opens reads as that page's name for it. A project whose command fails is named with the
 * command's own reason, and the other projects still show.
 */
export function QueuePage({ projects }: ModulePageProps) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  const {
    value: reads,
    state,
    failing,
    reload,
  } = usePolled<ProjectRead[]>(
    () =>
      Promise.all(
        projects.map(async (project): Promise<ProjectRead> => {
          const [read, agents] = await Promise.all([host.runCommand(project.id, ['--local', '--full']).then(result => readEntries(result, isPlacedEntry)), host.agents(project.id).catch(() => [])])
          const working = agents.filter(agent => agent.status === 'running' || agent.status === 'waiting')
          return 'error' in read ? { project, working, error: read.error } : { project, working, entries: read.entries }
        }),
      ),
    NOTHING_READ,
    // A local read, no fetch: cheap enough to follow the queue closely.
    10_000,
    [key],
    // Kept for the next visit: the page opens with the last list, faded until it is read again.
    { remember: `skill-queue:page:${key}`, stored: true },
    runsAgain(undefined),
  )
  const schedule = useSchedule(projects)
  const names = useFileNames(reads.map(read => ({ projectId: read.project.id, paths: (read.entries ?? []).flatMap(placed => pathsIn(placed.entry)) })))
  const starts = useQueueStarts(host)

  const total = reads.reduce((sum, read) => sum + (read.entries?.length ?? 0), 0)
  // One project's page: its start is the page's one primary press.
  const only = projects.length === 1 ? reads[0] : undefined

  return (
    <Page
      title="Queue"
      count={state !== 'unknown' && total > 0 ? total : undefined}
      description={`What agents will work on next, from the top${projects.length > 1 ? ', one list per project' : ''}. A higher priority is taken first: 10 is the most urgent, 0 is only if there is capacity.`}
      actions={
        only && (
          <>
            <TakerStatus read={only} schedule={schedule} />
            <BatchStart read={only} primary starts={starts} />
          </>
        )
      }
    >
      {starts.error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {starts.error}
        </p>
      )}
      <Slot of={{ state, value: reads, failing }} shape={<RowShapes rows={3} />} className="space-y-10">
        {reads =>
          reads.map(read =>
            only ? (
              <ProjectQueue key={read.project.id} read={read} names={names} starts={starts} reload={reload} />
            ) : (
              <Section
                key={read.project.id}
                title={read.project.name}
                count={read.entries?.length || undefined}
                action={
                  <>
                    <TakerStatus read={read} schedule={schedule} />
                    <BatchStart read={read} primary={false} starts={starts} />
                  </>
                }
              >
                <ProjectQueue read={read} names={names} starts={starts} reload={reload} />
              </Section>
            ),
          )
        }
      </Slot>
    </Page>
  )
}

/**
 * A project's batch act, as one control: how many, joined to the press the count qualifies. The
 * chevron sends the top entry alone: a launcher can only ever start one agent.
 */
function BatchStart({ read, primary, starts }: { read: ProjectRead; primary: boolean; starts: QueueStarts }) {
  const host = useModuleHost()
  const { project } = read
  // An entry an agent is on gets no second one: the batch starts from the top of the others.
  const free = unclaimedEntries((read.entries ?? []).map(placed => placed.entry), read.working)
  if (free.length === 0) return null
  const count = starts.batchOf(project.id, free)
  return (
    <StartAgentButton
      variant={primary ? 'default' : 'secondary'}
      size="default"
      leading={<BatchCount count={count} max={free.length} onChange={next => starts.setCount(project.id, next)} />}
      icon={<FastForward className="size-4" aria-hidden />}
      label={fanOutPress(count)}
      menuAriaLabel={`Other ways to start agents on ${project.name}'s queue`}
      tooltip={fanOutLabel(count)}
      busy={starts.inFlight}
      starting={starts.fanningOut(project.id)}
      onStart={() => void starts.fanOutProject(project.id, free)}
      onConfigure={() => host.configureRun(project.id, workOnEntryPrompt(free[0]!))}
      prompt={workOnEntryPrompt(free[0]!)}
      configureDescription="Opens the launcher with the top entry's prompt: one agent, not the batch."
    />
  )
}

/** One project's queue: the field that adds an entry, then its entries by priority, a card each, or a card saying it is empty. */
function ProjectQueue({ read, names, starts, reload }: { read: ProjectRead; names: FileNames; starts: QueueStarts; reload: () => Promise<void> }) {
  const { project, entries, error, working } = read
  if (error !== undefined)
    return (
      <p role="alert" className="text-sm text-danger">
        Could not read the queue of {project.name}: {error}
      </p>
    )
  const runs = sections(entries!, working)
  // The entry an agent takes next: the first nobody is on.
  const next = runs.flatMap(run => run.entries).find(placed => placed.agent === undefined)
  return (
    <div className="space-y-8">
      <AddEntry project={project} reload={reload} />
      {runs.length === 0 ? (
        <Card>
          <Empty title="Nothing queued">Add what an agent should do next. It waits here, the highest priority first, until an agent takes it.</Empty>
        </Card>
      ) : (
        runs.map((run, index) => (
          <PanelGroup key={index} title={run.priority === undefined ? 'No priority' : priorityName(run.priority)} badge={run.priority === undefined ? undefined : <PriorityBadge priority={run.priority} />} count={run.entries.length}>
            {run.entries.map(placed => (
              <EntryRow key={`${placed.place}\n${placed.entry}`} project={project} placed={placed} next={placed === next} names={names} starts={starts} reload={reload} />
            ))}
          </PanelGroup>
        ))
      )}
    </div>
  )
}

/**
 * Whether anything takes from the project's queue by itself, as a status at the page's head: the
 * command that works the queue, among the commands the project starts by itself, as whichever
 * installed package schedules them says. Pressed, it says so in a sentence, with the page that
 * changes it.
 */
function TakerStatus({ read, schedule }: { read: ProjectRead; schedule: Schedule }) {
  const known = schedule.commands[read.project.id]
  // Not read yet, or a read that failed: no status, since "nothing takes from it" would be a guess. Nor on an empty queue, which nothing could take from.
  if (known === undefined || !read.entries?.length) return null
  const taker = known.find(command => command.command === QUEUE_COMMAND)
  const page = schedule.page
  return (
    <Popover>
      <div role="status" aria-label="Who takes from the queue">
        <PopoverTrigger render={<Button variant="ghost" />}>
          <Badge tone={taker?.on ? 'success' : 'neutral'} className="text-sm">
            {taker === undefined ? (
              'Started by hand'
            ) : (
              <>
                <span className="font-mono text-xs">/{QUEUE_COMMAND}</span> {taker.on ? 'is on' : 'is off'}
              </>
            )}
          </Badge>
        </PopoverTrigger>
      </div>
      <PopoverContent align="end" className="w-72 text-sm">
        <p>
          {taker === undefined ? (
            'Nothing takes from this queue by itself: entries wait until you start them.'
          ) : (
            <>
              <span className="font-mono">/{QUEUE_COMMAND}</span> {taker.on ? 'is on: an agent takes the first entry nobody has claimed.' : 'is off: entries wait until you start them.'}
              {taker.note !== undefined && ` ${taker.note}.`}
            </>
          )}
        </p>
        {taker !== undefined && page && (
          <p className="mt-2 text-muted-foreground">
            Change it in{' '}
            <a href={page.href} onClick={inPlace(schedule.open)} className="text-foreground underline underline-offset-2 hover:no-underline">
              {page.label}
            </a>
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Where an entry came from, as its row says it: a ticket's page, a web address, or typed as a task. */
function origin(entry: string): string {
  const target = entryTarget(entry) ?? pathsIn(entry)[0]
  if (target === undefined) return 'typed'
  if (URL.canParse(target)) return `from ${new URL(target).host || 'a link'}`
  return target.startsWith('tickets/') ? 'from a ticket' : `from ${target}`
}

/**
 * One entry: its state (an agent on it, or waiting its turn), what it reads as, who is on it or that
 * it is next, where it came from, the line as written where a name stands in for it; its place at the
 * right, which gives its room to its start and its removal.
 */
function EntryRow({ project, placed, next, names, starts, reload }: { project: ModuleProject; placed: Numbered; next: boolean; names: FileNames; starts: QueueStarts; reload: () => Promise<void> }) {
  const host = useModuleHost()
  const { entry, place, agent } = placed
  const view = entryView(project.id, entry, names)
  const remove = async (): Promise<void> => {
    const answer = await host.act(project.id, doneArgs(entry))
    if (!answer.ok) throw new Error(answer.error)
    await reload()
  }
  return (
    <PanelRow
      state={<StateCell state={agent === undefined ? 'queued' : agent.status === 'waiting' ? 'waiting' : 'working'} />}
      title={view.title}
      titleHint={entry}
      href={view.url}
      external={view.url !== undefined}
      onClick={view.open}
      meta={[
        agent !== undefined ? <AgentOnEntry projectId={project.id} agent={agent} /> : next && 'Next up',
        origin(entry),
        // The line as written, under a name that stands in for it: it is what an agent is handed.
        view.renamed && <span className="font-mono">{entry}</span>,
      ]}
      fact={ordinal(place)}
      actions={
        <>
          {agent === undefined && (
            <StartAgentButton
              variant="secondary"
              size="sm"
              icon={<Play className="size-3.5" aria-hidden />}
              label="Start now"
              ariaLabel={`Start now: entry ${place}`}
              menuAriaLabel={`Other ways to run ${view.title}`}
              tooltip="Start an agent working on this entry"
              busy={starts.inFlight}
              starting={starts.starting(project.id, entry)}
              onStart={() => void starts.startEntry(project.id, entry)}
              onConfigure={() => host.configureRun(project.id, workOnEntryPrompt(entry))}
              prompt={workOnEntryPrompt(entry)}
              configureDescription="Opens the launcher with this entry's prompt, so you can set the model and where it runs."
            />
          )}
          <ConfirmDialog
            trigger={
              <Button variant="ghost" size="icon-sm" aria-label={`Remove entry ${place} from the queue`} title="Remove from the queue" className="text-muted-foreground hover:text-danger">
                <Trash2 className="size-4" aria-hidden />
              </Button>
            }
            title="Remove this entry from the queue?"
            body={
              <>
                <span className="block break-words font-mono text-xs">{entry}</span>
                <span className="mt-2 block">It is deleted from the queue of {project.name}, for everyone who shares it. Nothing else changes: no ticket is closed, and an agent already working on it goes on.</span>
              </>
            }
            confirmLabel="Remove"
            confirmBusyLabel="Removing…"
            onConfirm={remove}
            fallbackError="The entry was not removed."
          />
        </>
      }
    />
  )
}

/**
 * The field that adds an entry, as one control: the task, the priority section it goes to the end
 * of, and the press, through `queue add`. Beside the pick, one line that stands from the first frame:
 * why the last press did nothing, else where the task goes.
 */
function AddEntry({ project, reload }: { project: ModuleProject; reload: () => Promise<void> }) {
  const host = useModuleHost()
  const [text, setText] = useState('')
  const [priority, setPriority] = useState(DEFAULT_PRIORITY)
  const [adding, setAdding] = useState(false)
  const [failed, setFailed] = useState<string | undefined>()
  const [asked, setAsked] = useState(false)
  // The next task goes in where this one went: the caret is back in the field once it is added.
  const field = useRef<HTMLInputElement>(null)
  const down = useOpenAgentDown()
  const items = PRIORITIES.map(p => ({ value: String(p), label: `Priority ${p}` }))
  const untyped = text.trim() === ''
  const lineId = useId()
  const add = async (): Promise<void> => {
    if (adding) return
    if (untyped) {
      setAsked(true)
      field.current?.focus()
      return
    }
    setAdding(true)
    setFailed(undefined)
    const answer = await host.act(project.id, addTextArgs(text, priority)).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    if (answer.ok) {
      setText('')
      await reload()
    } else setFailed(answer.error)
    setAdding(false)
    field.current?.focus()
  }
  const missing = asked && untyped
  return (
    <form
      aria-label={`Add to the queue of ${project.name}`}
      onSubmit={event => {
        event.preventDefault()
        void add()
      }}
    >
      <ComposedField>
        <ComposedFieldInput
          ref={field}
          name="task"
          value={text}
          onChange={event => (setText(event.target.value), setFailed(undefined), setAsked(false))}
          readOnly={adding}
          placeholder="Add a task: what should an agent do?"
          aria-label="A task to add to the queue"
          aria-invalid={missing}
          aria-describedby={lineId}
        />
        <ComposedFieldFoot>
          <Select items={items} value={String(priority)} disabled={adding} onValueChange={next => setPriority(Number(next))}>
            <SelectTrigger aria-label="Priority of the new task" className="h-7 w-auto gap-2 border-transparent bg-accent px-2 font-medium hover:border-transparent">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map(p => (
                <SelectItem key={p} value={String(p)}>
                  Priority {p}
                  <span className="ml-2 text-xs text-muted-foreground">{priorityMeaning(p) ?? priorityName(p).toLowerCase()}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={lineId} role={failed !== undefined ? 'alert' : undefined} className={`min-w-0 flex-1 truncate text-xs ${failed !== undefined || missing ? 'text-danger' : 'text-faint-foreground'}`}>
            {failed !== undefined ? `Not added: ${failed}` : missing ? 'Write the task first.' : `Goes to the end of priority ${priority}`}
          </p>
          <span className="inline-flex items-center gap-1 text-xs text-faint-foreground max-md:hidden" aria-hidden>
            <kbd className="inline-flex h-5 items-center rounded-sm px-1 ring-1 ring-hairline ring-inset">
              <CornerDownLeft className="size-3.5" />
            </kbd>
            to add
          </span>
          <Button type="submit" variant="secondary" size="sm" loading={adding} disabled={down} aria-label="Add to queue">
            {adding ? 'Adding…' : 'Add'}
          </Button>
        </ComposedFieldFoot>
      </ComposedField>
    </form>
  )
}
