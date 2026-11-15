import { useId, useRef, useState } from 'react'
import { FastForward, Play, Plus, Trash2 } from 'lucide-react'
import {
  Button,
  ConfirmDialog,
  Input,
  List,
  Page,
  Row,
  RowShapes,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slot,
  StartAgentButton,
  cn,
  inPlace,
  pathsIn,
  useFileNames,
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
import { DEFAULT_PRIORITY, PRIORITIES, QUEUE_COMMAND, addTextArgs, doneArgs, fanOutLabel, fanOutPress, isPlacedEntry, isWorkingOn, priorityMeaning, readEntries, unclaimedEntries, workOnEntryPrompt } from '../src/module.js'
import { AgentOnEntry, EntryTitle, entryView } from './entry.js'
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

/** An entry with its place in the order of work, counted from 1 across the sections. */
interface Numbered extends PlacedEntry {
  place: number
}

/**
 * The entries as the file runs, each run of neighbours in one section under one header: the file's
 * order is the order agents take them, so an entry above the first section shows first. Numbered
 * in that order, across the sections.
 */
function sections(entries: PlacedEntry[]): { priority: number | undefined; entries: Numbered[] }[] {
  const runs: { priority: number | undefined; entries: Numbered[] }[] = []
  entries.forEach((placed, index) => {
    const last = runs[runs.length - 1]
    const numbered = { ...placed, place: index + 1 }
    if (last && last.priority === placed.priority) last.entries.push(numbered)
    else runs.push({ priority: placed.priority, entries: [numbered] })
  })
  return runs
}

/**
 * The Queue page: every project's open entries, in the order agents will take them, numbered,
 * under the priority section each sits in, from `queue --local --full` in each project. A place
 * to act: a line under them says whether anything takes from the queue by itself; an entry is started
 * here, alone or as a batch from the top, as on the Overview's card; an entry is removed, and a
 * new one added, through the same `queue done` and `queue add` an agent runs. An entry that names
 * a file another page opens reads as that page's name for it. A project whose command fails is
 * named with the command's own reason, and the other projects still show.
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
      actions={only && <BatchStart read={only} primary starts={starts} />}
    >
      {starts.error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {starts.error}
        </p>
      )}
      <Slot of={{ state, value: reads, failing }} shape={<RowShapes rows={3} />} className="space-y-8">
        {reads =>
          reads.map(read =>
            only ? (
              <ProjectQueue key={read.project.id} read={read} schedule={schedule} names={names} starts={starts} reload={reload} />
            ) : (
              <Section key={read.project.id} title={read.project.name} count={read.entries?.length || undefined} action={<BatchStart read={read} primary={false} starts={starts} />}>
                <ProjectQueue read={read} schedule={schedule} names={names} starts={starts} reload={reload} />
              </Section>
            ),
          )
        }
      </Slot>
    </Page>
  )
}

/**
 * A project's batch act, as one control: how many, then the press the count qualifies. The chevron
 * sends the top entry alone: a launcher can only ever start one agent.
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
      leading={<BatchCount count={count} max={free.length} onChange={next => starts.setCount(project.id, next)} className="h-8" />}
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

/** One project's queue: its entries by priority, the field that adds one, and who takes from it; an empty one says so in one line, over the field. */
function ProjectQueue({ read, schedule, names, starts, reload }: { read: ProjectRead; schedule: Schedule; names: FileNames; starts: QueueStarts; reload: () => Promise<void> }) {
  const { project, entries, error, working } = read
  if (error !== undefined)
    return (
      <p role="alert" className="text-sm text-danger">
        Could not read the queue of {project.name}: {error}
      </p>
    )
  return (
    <div className="space-y-6">
      {entries!.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing queued.</p>
      ) : (
        sections(entries!).map((section, index) => (
          <Section key={index} title={<PriorityTitle priority={section.priority} />} count={section.entries.length === 1 ? '1 entry' : `${section.entries.length} entries`}>
            <List>
              {section.entries.map(placed => (
                <EntryRow key={`${placed.place}\n${placed.entry}`} project={project} placed={placed} agent={working.find(agent => isWorkingOn(agent.ask, placed.entry))} names={names} starts={starts} reload={reload} />
              ))}
            </List>
          </Section>
        ))
      )}
      <AddEntry project={project} reload={reload} />
      {/* Under the field, so that the line, read after the entries, moves nothing when it comes. */}
      {entries!.length > 0 && <TakerLine schedule={schedule} projectId={project.id} />}
    </div>
  )
}

/** A run of entries' heading: the priority section they sit in, with what its number means at either end of the scale. */
function PriorityTitle({ priority }: { priority: number | undefined }) {
  if (priority === undefined) return 'No priority'
  const meaning = priorityMeaning(priority)
  return (
    <>
      Priority {priority}
      {meaning !== undefined && (
        <>
          {' '}
          <span className="font-normal text-muted-foreground">{meaning}</span>
        </>
      )}
    </>
  )
}

/**
 * Whether anything takes from the project's queue by itself: the command that works the queue,
 * among the commands the project starts by itself, as whichever installed package schedules them
 * says. On: when it starts next. Off, or not there: entries wait until a person starts them.
 */
function TakerLine({ schedule, projectId }: { schedule: Schedule; projectId: string }) {
  const known = schedule.commands[projectId]
  // Not read yet, or a read that failed: no line, since "nothing takes from it" would be a guess.
  if (known === undefined) return null
  const taker = known.find(command => command.command === QUEUE_COMMAND)
  const page = schedule.page
  return (
    <p role="status" aria-label="Who takes from the queue" className="flex items-baseline gap-2 text-sm text-muted-foreground">
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', taker?.on ? 'bg-success' : 'bg-faint-foreground')} />
      <span className="min-w-0">
        {taker === undefined ? (
          'Nothing takes from this queue by itself: entries wait until you start them.'
        ) : (
          <>
            <span className="font-mono">/{QUEUE_COMMAND}</span> {taker.on ? 'is on: an agent takes the first entry nobody has claimed.' : 'is off: entries wait until you start them.'}
            {taker.note !== undefined && ` ${taker.note}.`}
          </>
        )}
        {taker !== undefined && page && (
          <span className="ml-2 whitespace-nowrap">
            Change it in{' '}
            <a href={page.href} onClick={inPlace(schedule.open)} className="text-primary hover:underline">
              {page.label}
            </a>
          </span>
        )}
      </span>
    </p>
  )
}

/** One entry: its place, what it reads as, the agent on it when one is, its start button, and its removal. */
function EntryRow({ project, placed, agent, names, starts, reload }: { project: ModuleProject; placed: Numbered; agent: ModuleAgent | undefined; names: FileNames; starts: QueueStarts; reload: () => Promise<void> }) {
  const host = useModuleHost()
  const { entry, place } = placed
  const view = entryView(project.id, entry, names)
  const remove = async (): Promise<void> => {
    const answer = await host.act(project.id, doneArgs(entry))
    if (!answer.ok) throw new Error(answer.error)
    await reload()
  }
  return (
    <Row
      stackOnPhone
      leading={<span className="w-5 text-right text-xs tabular-nums">{place}.</span>}
      title={<EntryTitle view={view} entry={entry} className={cn('block max-w-full truncate text-left max-md:line-clamp-2 max-md:whitespace-normal', (view.open ?? view.url) !== undefined && 'hover:underline')} />}
      // The line as written, under a name that stands in for it: it is what an agent is handed.
      detail={view.renamed ? <span className="font-mono">{entry}</span> : undefined}
      meta={agent && <AgentOnEntry projectId={project.id} agent={agent} />}
      actions={
        <>
          {!agent && (
            <StartAgentButton
              variant="ghost"
              size="icon-sm"
              icon={<Play className="size-4" aria-hidden />}
              ariaLabel={`Start an agent on entry ${place}`}
              menuAriaLabel={`Other ways to run ${view.title}`}
              tooltip="Start an agent working on this entry"
              busy={starts.inFlight}
              starting={starts.starting(project.id, entry)}
              onStart={() => void starts.startEntry(project.id, entry)}
              onConfigure={() => host.configureRun(project.id, workOnEntryPrompt(entry))}
              prompt={workOnEntryPrompt(entry)}
              configureDescription="Opens the launcher with this entry's prompt, so you can set the model and where it runs."
              className="text-muted-foreground hover:text-foreground"
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

/** The field that adds an entry: its text and the priority section it goes to the end of, through `queue add`. */
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
  const formId = useId()
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
  return (
    <form
      aria-label={`Add to the queue of ${project.name}`}
      onSubmit={event => {
        event.preventDefault()
        void add()
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={field}
          name="task"
          value={text}
          onChange={event => (setText(event.target.value), setFailed(undefined), setAsked(false))}
          readOnly={adding}
          placeholder="Add a task: what an agent should do"
          aria-label="A task to add to the queue"
          aria-invalid={asked && untyped}
          aria-describedby={asked && untyped ? `${formId}-missing` : undefined}
          className="min-w-48 flex-1 max-md:basis-full"
        />
        <Select items={items} value={String(priority)} disabled={adding} onValueChange={next => setPriority(Number(next))}>
          <SelectTrigger aria-label="Priority of the new task" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITIES.map(p => (
              <SelectItem key={p} value={String(p)}>
                Priority {p}
                {priorityMeaning(p) !== undefined && <span className="ml-2 text-xs text-muted-foreground">{priorityMeaning(p)}</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="secondary" loading={adding} disabled={down}>
          <Plus className="size-4" aria-hidden />
          {adding ? 'Adding…' : 'Add to queue'}
        </Button>
      </div>
      {asked && untyped && (
        <p id={`${formId}-missing`} className="mt-2 text-xs text-danger">
          Write the task first.
        </p>
      )}
      {/* While a task is typed: what the press does with it. */}
      {!untyped && <p className="mt-2 text-xs text-muted-foreground">It goes to the end of its priority. The text is what an agent is handed, so write the whole task.</p>}
      {failed !== undefined && (
        <p role="alert" className="mt-1 text-xs text-danger">
          Not added: {failed}
        </p>
      )}
    </form>
  )
}
