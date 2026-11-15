import { useId, useRef, useState, type ReactNode } from 'react'
import { Ellipsis, FastForward, Play } from 'lucide-react'
import {
  Button,
  ComposedField,
  ComposedFieldInput,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Page,
  PanelGroup,
  PanelRow,
  RowShapes,
  Section,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slot,
  StartAgentButton,
  StartAgentPress,
  StateCell,
  inPlace,
  pathsIn,
  useFileNames,
  useIsMobile,
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
import { DEFAULT_PRIORITY, PRIORITIES, QUEUE_COMMAND, addTextArgs, doneArgs, entryTarget, fanOutLabel, fanOutPress, isPlacedEntry, entryHeadline, isWorkingOn, priorityMeaning, readEntries, unclaimedEntries, workOnEntryPrompt } from '../src/module.js'
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

  // One project's page: its start is the page's one primary press, and under its title one line says
  // who takes from the queue (the title and the places in line say the rest).
  const only = projects.length === 1 ? reads[0] : undefined
  // A phone's bar names the page and hides a description: there the line stands first in the page, and
  // the count and the start stand under the field, over the entries they start (ProjectQueue).
  const phone = useIsMobile()
  const taker = only && <TakerLine projectId={only.project.id} schedule={schedule} />

  return (
    <Page
      title="Queue"
      {...(phone && only
        ? {}
        : {
            description: only ? taker : 'What agents take next, from the top, one list per project.',
            actions: only && <BatchStart read={only} primary starts={starts} />,
          })}
    >
      {phone && only && <p className="mb-6 text-sm text-muted-foreground">{taker}</p>}
      {starts.error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {starts.error}
        </p>
      )}
      <Slot of={{ state, value: reads, failing }} shape={<RowShapes rows={3} />} className="space-y-10">
        {reads =>
          reads.map(read =>
            only ? (
              <ProjectQueue key={read.project.id} read={read} names={names} starts={starts} reload={reload} batch={phone && <BatchStart read={read} primary fill starts={starts} />} />
            ) : (
              <Section
                key={read.project.id}
                title={read.project.name}
                count={read.entries?.length || undefined}
                action={<BatchStart read={read} primary={false} starts={starts} />}
              >
                <p className="-mt-1 mb-3 text-sm text-muted-foreground">
                  <TakerLine projectId={read.project.id} schedule={schedule} />
                </p>
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
function BatchStart({ read, primary, fill = false, starts }: { read: ProjectRead; primary: boolean; fill?: boolean; starts: QueueStarts }) {
  const host = useModuleHost()
  const { project } = read
  // An entry an agent is on gets no second one: the batch starts from the top of the others.
  const free = unclaimedEntries((read.entries ?? []).map(placed => placed.entry), read.working)
  if (free.length === 0) return null
  const count = starts.batchOf(project.id, free)
  const press = (
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
      fill={fill}
    />
  )
  // A phone's, in the page: 16 over the first part's name.
  return fill ? <div className="mb-4">{press}</div> : press
}

/**
 * One project's queue: the field that adds an entry, then its entries by priority, a card each, or one
 * line saying there are none, where they would start. `batch`, a phone's start, stands under the field
 * over the entries it starts, so the field never moves when the first entry comes.
 */
function ProjectQueue({ read, names, starts, reload, batch }: { read: ProjectRead; names: FileNames; starts: QueueStarts; reload: () => Promise<void>; batch?: ReactNode }) {
  const { project, entries, error, working } = read
  if (error !== undefined)
    return (
      <p role="alert" className="text-sm text-danger">
        Could not read the queue of {project.name}: {error}
      </p>
    )
  const runs = sections(entries!, working)
  return (
    <div className="space-y-8">
      <AddEntry project={project} reload={reload} />
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing queued.</p>
      ) : (
        <div>
          {batch}
          <div className="space-y-8">
            {runs.map((run, index) => (
              <PanelGroup key={index} title={run.priority === undefined ? 'No priority' : `Priority ${run.priority}`}>
                {run.entries.map(placed => (
                  <EntryRow key={`${placed.place}\n${placed.entry}`} project={project} placed={placed} names={names} starts={starts} reload={reload} />
                ))}
              </PanelGroup>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Whether anything takes from the project's queue by itself, in one sentence under the page's title:
 * read from the command that works the queue, among the commands the project starts by itself, as
 * whichever installed package schedules them says, with the page that changes it. Until that is read
 * the sentence's room is held, unseen, so nothing under it moves when it comes.
 */
function TakerLine({ projectId, schedule }: { projectId: string; schedule: Schedule }) {
  const known = schedule.commands[projectId]
  const page = schedule.page
  // The page where what starts by itself is changed, where a package holds one.
  const change = page && (
    <>
      {' '}
      Change it in{' '}
      <a href={page.href} onClick={inPlace(schedule.open)} className="font-medium text-primary pointer-fine:hover:underline">
        {page.label}
      </a>
      .
    </>
  )
  // Not read yet, or a read that failed: what takes from it would be a guess, so its words are not said,
  // only their room held.
  if (known === undefined)
    return (
      <span aria-hidden className="invisible">
        {WAITS}
        {page && ` Change it in ${page.label}.`}
      </span>
    )
  const taker = known.find(command => command.command === QUEUE_COMMAND)
  // Said in plain words: the command's name is Automations' to say.
  return (
    <span role="status" aria-label="Who takes from the queue">
      {taker?.on ? 'Agents take entries from here by themselves.' : WAITS}
      {taker?.note !== undefined && ` ${taker.note}.`}
      {change}
    </span>
  )
}

/** A part of a row's second line as it starts: with a capital. */
function capitalised(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** What the queue's line says while nothing takes from it by itself. */
const WAITS = 'Entries wait here until you start them.'

/** Where an entry came from, where it names something: a ticket, a web address, a file. A typed entry names nothing. */
function origin(entry: string): string | undefined {
  const target = entryTarget(entry) ?? pathsIn(entry)[0]
  if (target === undefined) return undefined
  if (URL.canParse(target)) return `From ${new URL(target).host || 'a link'}`
  return target.startsWith('tickets/') ? 'From a ticket' : `From ${target}`
}

/**
 * One entry: its place in line, what it reads as, then who is on it (the state's mark first), where it
 * came from, or a typed entry's words after its name, or the line as written where a name stands in
 * for it, each part starting with a capital. Nothing at its right at rest: its presses come under the
 * pointer and the keyboard, and are always there on touch. Every entry has one menu ("⋯"): "Configure
 * first, then run" where nobody is on it, and its removal. A free entry has "Start now" before it, and
 * on a phone, where a row has one press, "Start now" is the menu's first item.
 */
function EntryRow({ project, placed, names, starts, reload }: { project: ModuleProject; placed: Numbered; names: FileNames; starts: QueueStarts; reload: () => Promise<void> }) {
  const host = useModuleHost()
  const phone = useIsMobile()
  const down = useOpenAgentDown()
  const [removing, setRemoving] = useState(false)
  const { entry, place, agent } = placed
  const view = entryView(project.id, entry, names)
  const from = origin(entry)
  const headline = from === undefined && !view.renamed ? entryHeadline(view.title) : undefined
  // What the row calls it, and the dialog that removes it.
  const name = headline?.name ?? view.title
  const remove = async (): Promise<void> => {
    const answer = await host.act(project.id, doneArgs(entry))
    if (!answer.ok) throw new Error(answer.error)
    await reload()
  }
  // Nobody is on it: it can be started, from its press beside its menu, or on a phone from its menu.
  const free = agent === undefined
  const start = (): void => void starts.startEntry(project.id, entry)
  return (
    <>
      <PanelRow
        state={<span className="text-xs tabular-nums text-faint-foreground">{place}</span>}
        title={name}
        titleHint={entry}
        href={view.url}
        external={view.url !== undefined}
        onClick={view.open}
        meta={[
          agent !== undefined && (
            <span className="inline-flex h-4 items-center gap-1.5 align-top">
              <StateCell state={agent.status === 'waiting' ? 'waiting' : 'working'} />
              <AgentOnEntry projectId={project.id} agent={agent} />
            </span>
          ),
          from ?? (headline?.rest !== undefined ? capitalised(headline.rest) : undefined),
          // The line as written, under a name that stands in for it: it is what an agent is handed.
          view.renamed && <span className="font-mono">{entry}</span>,
        ]}
        actions={
          <>
            {free && !phone && (
              <StartAgentPress
                variant="secondary"
                size="sm"
                icon={<Play className="size-3.5" aria-hidden />}
                label="Start now"
                ariaLabel={`Start now: entry ${place}`}
                tooltip="Start an agent working on this entry"
                busy={starts.inFlight}
                starting={starts.starting(project.id, entry)}
                onStart={start}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`More for entry ${place}`} className="-mr-1.5" />}>
                <Ellipsis className="size-4" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {free && phone && (
                  <DropdownMenuItem disabled={starts.inFlight || down} onClick={start}>
                    Start now
                  </DropdownMenuItem>
                )}
                {free && <DropdownMenuItem onClick={() => host.configureRun(project.id, workOnEntryPrompt(entry))}>Configure first, then run</DropdownMenuItem>}
                <DropdownMenuItem onClick={() => setRemoving(true)}>Remove from the queue</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove this entry from the queue?"
        body={
          <>
            <span className="break-words font-medium text-foreground">{name}</span> is deleted from the queue of {project.name}, for everyone who shares it. Nothing else changes: no ticket is closed, and an agent already working on it goes on.
          </>
        }
        confirmLabel="Remove"
        confirmBusyLabel="Removing…"
        onConfirm={remove}
        fallbackError="The entry was not removed."
      />
    </>
  )
}

/**
 * The field that adds an entry, as one control: the task, the priority section it goes to the end
 * of (said in the pick's title), and the press, through `queue add`. Under it, only after a press that
 * added nothing, why.
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
  // Why the last press added nothing, under the field; nothing there otherwise.
  const problem = failed !== undefined ? `Not added: ${failed}` : missing ? 'Write the task first.' : undefined
  return (
    <form
      aria-label={`Add to the queue of ${project.name}`}
      onSubmit={event => {
        event.preventDefault()
        void add()
      }}
    >
      <ComposedField>
        {/* One row: the task, the priority it goes in at the end of, the press; on a phone the task over the other two. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1 max-md:basis-full">
            <ComposedFieldInput
              ref={field}
              name="task"
              value={text}
              onChange={event => (setText(event.target.value), setFailed(undefined), setAsked(false))}
              readOnly={adding}
              placeholder="Add a task: what should an agent do?"
              aria-label="A task to add to the queue"
              aria-invalid={missing}
              {...(problem !== undefined ? { 'aria-describedby': lineId } : {})}
            />
          </div>
          <Select items={items} value={String(priority)} disabled={adding} onValueChange={next => setPriority(Number(next))}>
            <SelectTrigger aria-label="Priority of the new task" title={`Goes to the end of priority ${priority}`} className="h-9 w-32 justify-between border-transparent bg-accent px-3 hover:border-transparent max-md:flex-1">
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
          <Button type="submit" variant="secondary" className="h-9" loading={adding} disabled={down} aria-label="Add to queue" title="Add to the queue (Enter)">
            {adding ? 'Adding…' : 'Add'}
          </Button>
        </div>
      </ComposedField>
      {problem !== undefined && (
        <p id={lineId} role="alert" className="mt-2 text-sm text-danger">
          {problem}
        </p>
      )}
    </form>
  )
}
