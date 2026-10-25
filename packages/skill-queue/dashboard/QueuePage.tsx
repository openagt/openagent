import { useState } from 'react'
import { Bot, FastForward, Play, Plus, Trash2 } from 'lucide-react'
import {
  Button,
  ConfirmDialog,
  Input,
  Page,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StartAgentButton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
  pathsIn,
  useFileNames,
  useModuleHost,
  usePolled,
  useSchedule,
  type FileNames,
  type ModuleAgent,
  type ModulePageProps,
  type ModuleProject,
  type Schedule,
} from '@openagt/dashboard/module'
import type { PlacedEntry } from '../src/queue.js'
import { DEFAULT_PRIORITY, PRIORITIES, QUEUE_COMMAND, addTextArgs, doneArgs, fanOutLabel, isWorkingOn, priorityMeaning, workOnEntryPrompt } from '../src/module.js'
import { EntryTitle, entryView } from './entry.js'
import { useQueueStarts, type QueueStarts } from './starts.js'

/** One project's queue as read: its entries with their sections and the project's agents at work, or why the command failed. */
interface ProjectRead {
  project: ModuleProject
  entries?: PlacedEntry[]
  /** The project's agents that are working now: an entry one of them was asked is being worked on. */
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
 * to act: a line on top says whether anything takes from the queue by itself; an entry is started
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
    loaded,
    reload,
  } = usePolled<ProjectRead[]>(
    () =>
      Promise.all(
        projects.map(async (project): Promise<ProjectRead> => {
          const [result, agents] = await Promise.all([host.runCommand(project.id, ['--local', '--full']), host.agents(project.id).catch(() => [])])
          const working = agents.filter(agent => agent.status === 'running')
          if (!result.ok) return { project, working, error: result.error }
          if (!Array.isArray(result.output)) return { project, working, error: 'the queue command did not print a list' }
          return { project, working, entries: result.output.filter(isPlacedEntry) }
        }),
      ),
    NOTHING_READ,
    // A local read, no fetch: cheap enough to follow the queue closely.
    10_000,
    [key],
  )
  const schedule = useSchedule(projects)
  const names = useFileNames(reads.map(read => ({ projectId: read.project.id, paths: (read.entries ?? []).flatMap(placed => pathsIn(placed.entry)) })))
  const starts = useQueueStarts(host)

  return (
    <Page
      title="Queue"
      description={`What agents will work on next, from the top${projects.length > 1 ? ', one list per project' : ''}. A higher priority is taken first: 10 is the most urgent, 0 is only if there is capacity.`}
    >
      {!loaded && <p className="text-sm text-muted-foreground">Loading…</p>}
      {starts.error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {starts.error}
        </p>
      )}
      <div className="space-y-6">
        {reads.map(read => (
          <ProjectQueue key={read.project.id} read={read} titled={projects.length > 1} schedule={schedule} names={names} starts={starts} reload={reload} />
        ))}
      </div>
    </Page>
  )
}

/** One project's queue: who takes from it, its batch start, its entries, and the field that adds one. */
function ProjectQueue({ read, titled, schedule, names, starts, reload }: { read: ProjectRead; titled: boolean; schedule: Schedule; names: FileNames; starts: QueueStarts; reload: () => Promise<void> }) {
  const host = useModuleHost()
  const { project, entries, error, working } = read
  const raw = (entries ?? []).map(placed => placed.entry)
  const count = Math.min(starts.countOf(project.id), Math.max(raw.length, 1))
  return (
    <section aria-label={project.name}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {titled && <h2 className="text-sm font-semibold">{project.name}</h2>}
        {raw.length > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{raw.length === 1 ? '1 entry' : `${raw.length} entries`}</span>}
        {raw.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            {/* The project's batch act: how many, then the button the count qualifies. */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={starts.countOf(project.id)}
                    aria-label="How many agents to start"
                    onChange={event => {
                      // An emptied box is mid-edit rather than a count: `Number('')` is 0.
                      const typed = event.target.value.trim()
                      if (!typed) return
                      const next = Math.round(Number(typed))
                      if (Number.isFinite(next)) starts.setCount(project.id, next)
                    }}
                    className="h-7 w-14 px-1 text-center text-xs tabular-nums"
                  />
                }
              />
              <TooltipContent>How many agents to start: one per entry, from the top of the queue.</TooltipContent>
            </Tooltip>
            {/* The chevron sends the top entry alone: a launcher can only ever start one agent. */}
            <StartAgentButton
              size="xs"
              icon={<FastForward className="h-3.5 w-3.5" aria-hidden />}
              label={count === 1 ? 'Start 1 agent' : `Start ${count} agents`}
              menuAriaLabel={`Other ways to start agents on ${project.name}'s queue`}
              tooltip={fanOutLabel(count)}
              busy={starts.inFlight}
              starting={starts.fanningOut(project.id)}
              onStart={() => void starts.fanOutProject(project.id, raw)}
              onConfigure={() => host.configureRun(project.id, workOnEntryPrompt(raw[0]!))}
              prompt={workOnEntryPrompt(raw[0]!)}
              configureDescription="Opens the launcher with the top entry's prompt: one agent, not the batch."
            />
          </div>
        )}
      </div>
      {error === undefined && <TakerLine schedule={schedule} projectId={project.id} />}
      {error !== undefined ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          Could not read the queue of {project.name}: {error}
        </p>
      ) : entries!.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nothing queued.</p>
      ) : (
        sections(entries!).map((section, index) => (
          <div key={index} className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.priority === undefined ? 'No priority' : `Priority ${section.priority}`}
              {section.priority !== undefined && priorityMeaning(section.priority) !== undefined && ' '}
              {section.priority !== undefined && priorityMeaning(section.priority) !== undefined && <span className="ml-1 font-normal normal-case tracking-normal">{priorityMeaning(section.priority)}</span>}
            </h3>
            {/* Counted on from the section before, so the number a screen reader says is the one shown. */}
            <ol start={section.entries[0]!.place} className="mt-1.5 list-none divide-y divide-border rounded-md border border-border">
              {section.entries.map(placed => (
                <EntryRow key={`${placed.place}\n${placed.entry}`} project={project} placed={placed} agent={working.find(agent => isWorkingOn(agent.ask, placed.entry))} names={names} starts={starts} reload={reload} />
              ))}
            </ol>
          </div>
        ))
      )}
      {error === undefined && <AddEntry project={project} reload={reload} />}
    </section>
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
    <p role="status" aria-label="Who takes from the queue" className="mt-3 flex items-baseline gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 -translate-y-0.5 rounded-full', taker?.on ? 'bg-success' : 'bg-muted-foreground/50')} />
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
          <span className="ml-2 whitespace-nowrap text-xs text-muted-foreground">
            Change it in{' '}
            <a
              href={page.href}
              onClick={event => {
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                event.preventDefault()
                schedule.open()
              }}
              className="underline hover:text-foreground"
            >
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
    <li className="flex items-center gap-3 px-3 py-2 text-sm max-md:gap-1.5 max-md:px-2">
      <span aria-hidden className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {place}.
      </span>
      <div className="min-w-0 flex-1">
        <EntryTitle view={view} entry={entry} className={cn('block max-w-full truncate text-left max-md:line-clamp-2 max-md:whitespace-normal', (view.open ?? view.url) !== undefined && 'hover:underline')} />
        {/* The line as written, under a name that stands in for it: it is what an agent is handed. */}
        {view.renamed && <span className="block truncate font-mono text-xs text-muted-foreground">{entry}</span>}
      </div>
      {agent && (
        <Tooltip>
          <TooltipTrigger
            render={<button type="button" onClick={() => host.openAgent(project.id, agent.id)} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success hover:underline" />}
          >
            <Bot className="h-3 w-3" aria-hidden />
            <span className="max-md:sr-only">An agent is on it</span>
          </TooltipTrigger>
          <TooltipContent>An agent is working on this entry: open it</TooltipContent>
        </Tooltip>
      )}
      <StartAgentButton
        variant="ghost"
        size="icon-sm"
        icon={<Play className="h-3.5 w-3.5" aria-hidden />}
        ariaLabel={`Start an agent on entry ${place}`}
        menuAriaLabel={`Other ways to run ${view.title}`}
        tooltip="Spin up an agent working on this entry"
        busy={starts.inFlight}
        starting={starts.starting(project.id, entry)}
        onStart={() => void starts.startEntry(project.id, entry)}
        onConfigure={() => host.configureRun(project.id, workOnEntryPrompt(entry))}
        prompt={workOnEntryPrompt(entry)}
        configureDescription="Opens the launcher with this entry's prompt, so you can set the model and where it runs."
        className="text-muted-foreground hover:text-foreground"
      />
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="icon-sm" aria-label={`Remove entry ${place} from the queue`} title="Remove from the queue" className="shrink-0 text-muted-foreground hover:text-danger">
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
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
    </li>
  )
}

/** The field that adds an entry: its text and the priority section it goes to the end of, through `queue add`. */
function AddEntry({ project, reload }: { project: ModuleProject; reload: () => Promise<void> }) {
  const host = useModuleHost()
  const [text, setText] = useState('')
  const [priority, setPriority] = useState(DEFAULT_PRIORITY)
  const [adding, setAdding] = useState(false)
  const [failed, setFailed] = useState<string | undefined>()
  const items = PRIORITIES.map(p => ({ value: String(p), label: `Priority ${p}` }))
  const add = async (): Promise<void> => {
    if (text.trim() === '' || adding) return
    setAdding(true)
    setFailed(undefined)
    const answer = await host.act(project.id, addTextArgs(text, priority)).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    if (answer.ok) {
      setText('')
      await reload()
    } else setFailed(answer.error)
    setAdding(false)
  }
  return (
    <form
      aria-label={`Add to the queue of ${project.name}`}
      onSubmit={event => {
        event.preventDefault()
        void add()
      }}
      className="mt-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input value={text} onChange={event => (setText(event.target.value), setFailed(undefined))} disabled={adding} placeholder="Add a task: what an agent should do" aria-label="A task to add to the queue" className="h-8 min-w-48 flex-1 px-2" />
        <Select items={items} value={String(priority)} disabled={adding} onValueChange={next => setPriority(Number(next))}>
          <SelectTrigger size="sm" aria-label="Priority of the new task" className="w-32">
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
        <Button type="submit" variant="outline" size="sm" disabled={text.trim() === '' || adding}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          {adding ? 'Adding…' : 'Add to queue'}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">It goes to the end of its priority. The text is what an agent is handed, so write the whole task.</p>
      {failed !== undefined && (
        <p role="alert" className="mt-1 text-xs text-danger">
          Not added: {failed}
        </p>
      )}
    </form>
  )
}

/** Whether the command printed one entry as `--full` prints it. */
function isPlacedEntry(value: unknown): value is PlacedEntry {
  if (!value || typeof value !== 'object') return false
  const { entry, priority } = value as Record<string, unknown>
  return typeof entry === 'string' && (priority === undefined || typeof priority === 'number')
}
