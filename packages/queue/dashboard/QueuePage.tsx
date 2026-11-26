import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
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
  PagePresses,
  PanelGroup,
  PanelRow,
  PanelShape,
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
  isUnreachable,
  rpcClient,
  useFileNames,
  useIsMobile,
  runsAgain,
  useModuleHost,
  useOpenAgentDown,
  usePolled,
  WordsShape,
  type FileNames,
  type ModuleAgent,
  type UiPageProps,
  type UiProject,
} from '@openagt/ui/module'
import { SCHEDULED_COMMANDS_PAGE } from '@openagt/hooks'
import type { PlacedEntry } from '../src/queue.js'
import { DEFAULT_PRIORITY, PRIORITIES, addTextArgs, paceWords, doneArgs, entryTarget, fanOutLabel, fanOutPress, entryHeadline, isWorkingOn, priorityMeaning, unclaimedEntries, workOnEntryPrompt } from '../src/module.js'
import { AgentOnEntry, entryView } from './entry.js'
import { useQueueStarts, type QueueStarts } from './starts.js'
import { BatchCount } from './batch-count.js'
import { useTakers, type Takers } from './takers.js'

/** One project's queue as read: its entries with their sections and the project's agents at work, or why it could not be read. */
interface ProjectRead {
  project: UiProject
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
 * priority section each sits in, from the server part's `entries` in each project. A place to act: the
 * page's head says whether anything takes from the queue by itself; an entry is started here, alone
 * or as a batch from the top, as on the Overview's card; an entry is removed, and a new one added,
 * through the same `queue done` and `queue add` an agent runs. An entry that names a file another
 * page opens reads as that page's name for it. A project whose queue cannot be read is named with
 * the reason, and the other projects still show.
 */
export function QueuePage({ projects }: UiPageProps) {
  const host = useModuleHost()
  const server = rpcClient<typeof import('../src/server.js')>(host)
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
          const [read, agents] = await Promise.all([
            server.entries(project.id, {}).then(
              entries => ({ entries }),
              (err: unknown) => {
                if (isUnreachable(err)) throw err
                return { error: err instanceof Error ? err.message : String(err) }
              },
            ),
            host.agents(project.id).catch(() => []),
          ])
          const working = agents.filter(agent => agent.status === 'running' || agent.status === 'waiting')
          return 'error' in read ? { project, working, error: read.error } : { project, working, entries: read.entries }
        }),
      ),
    NOTHING_READ,
    // A local read, no fetch: cheap enough to follow the queue closely.
    10_000,
    [key],
    // Kept for the next visit: the page opens with the last list, faded until it is read again.
    { remember: `queue:page:${key}`, stored: true },
    runsAgain(undefined),
  )
  const takers = useTakers(projects)
  const names = useFileNames(
    reads.map(read => ({ projectId: read.project.id, paths: (read.entries ?? []).flatMap(placed => pathsIn(placed.entry)) })),
    `queue:page-names:${key}`,
  )
  const starts = useQueueStarts(host)

  // One project's page: its start is the page's one primary press, and under its title one line says
  // who takes from the queue (the title and the places in line say the rest). Known before its read,
  // so the line and the field that adds an entry stand from the first frame.
  const onlyProject = projects.length === 1 ? projects[0] : undefined
  const only = onlyProject && reads[0]
  // A phone's bar names the page and hides a description: there the line stands first in the page, and
  // the count and the start stand under the field, over the entries they start (ProjectQueue).
  const phone = useIsMobile()
  const taker = onlyProject && <TakerLine projectId={onlyProject.id} takers={takers} />

  return (
    <Page
      title="Queue"
      {...(phone && onlyProject
        ? {}
        : {
            description: onlyProject ? taker : 'What agents take next, from the top, one list per project.',
            actions: only && <BatchStart read={only} primary names={names} starts={starts} />,
          })}
    >
      {phone && onlyProject && <p className="mb-6 text-sm text-muted-foreground">{taker}</p>}
      {starts.error && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {starts.error}
        </p>
      )}
      {onlyProject ? (
        <div data-queue="" className="space-y-8">
          {only?.error === undefined && <AddEntry project={onlyProject} reload={reload} />}
          {/* Its entries while they are read: a priority's heading over a card of one entry, its name over its facts.
              How many there are is not known until the read; one is the fewest a queue that shows any holds. */}
          <Slot
            of={{ state, value: reads, failing }}
            shape={
              <div>
                {/* On a phone, the batch's start over the entries: its row's room and the 16 under it, held as the read page draws them. */}
                {phone && <div aria-hidden className="mb-4 h-11" />}
                <PanelGroup title={<WordsShape words="Priority 5" />} bare>
                  <PanelShape rows={1} />
                </PanelGroup>
              </div>
            }
          >
            {reads => reads.map(read => <ProjectQueue key={read.project.id} read={read} names={names} starts={starts} reload={reload} field={false} batch={phone && <BatchStart read={read} primary fill names={names} starts={starts} />} />)}
          </Slot>
        </div>
      ) : (
      <Slot of={{ state, value: reads, failing }} shape={<RowShapes rows={3} />} className="space-y-10">
        {reads =>
          reads.map(read => (
              <Section
                key={read.project.id}
                title={read.project.name}
                count={read.entries?.length || undefined}
                action={<BatchStart read={read} primary={false} names={names} starts={starts} />}
              >
                <p className="-mt-1 mb-3 text-sm text-muted-foreground">
                  <TakerLine projectId={read.project.id} takers={takers} />
                </p>
                <ProjectQueue read={read} names={names} starts={starts} reload={reload} />
              </Section>
          ))
        }
      </Slot>
      )}
    </Page>
  )
}

/**
 * A project's batch act, as one control: how many, joined to the press the count qualifies. The
 * chevron sends the top entry alone: a launcher can only ever start one agent.
 */
function BatchStart({ read, primary, fill = false, names, starts }: { read: ProjectRead; primary: boolean; fill?: boolean; names: FileNames; starts: QueueStarts }) {
  const host = useModuleHost()
  const { project } = read
  // An entry an agent is on gets no second one, and one that is done already none at all: the batch starts from the top of the others.
  const free = unclaimedEntries((read.entries ?? []).map(placed => placed.entry), read.working).filter(entry => !entryView(project.id, entry, names).done)
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
      // On a phone each half reaches a finger's 44, 6 past its top and bottom, as the stepper's steps do.
      className="relative max-md:after:absolute max-md:after:inset-x-0 max-md:after:-inset-y-1.5"
    />
  )
  // A phone's, in the page: 16 over the first part's name.
  return fill ? <PagePresses className="mb-4">{press}</PagePresses> : press
}

/**
 * One project's queue: the field that adds an entry (unless `field` is false: a one-project page draws
 * it before the queue is read), then its entries by priority, a card each, or one line saying there are
 * none, where they would start. `batch`, a phone's start, stands under the field over the entries it
 * starts, so the field never moves when the first entry comes.
 */
function ProjectQueue({ read, names, starts, reload, batch, field = true }: { read: ProjectRead; names: FileNames; starts: QueueStarts; reload: () => Promise<void>; batch?: ReactNode; field?: boolean }) {
  const { project, entries, error, working } = read
  const queue = useRef<HTMLDivElement>(null)
  // A removed row takes the focus with it: it goes to the entry now in its place, else the one before it, else the field that adds one.
  const [removed, setRemoved] = useState<{ place: number }>()
  useEffect(() => {
    if (!removed || !queue.current) return
    const bins = queue.current.querySelectorAll<HTMLElement>('[data-remove-entry]')
    ;(bins[removed.place - 1] ?? bins[bins.length - 1] ?? queue.current.closest('[data-queue]')?.querySelector<HTMLElement>('input[name="task"]'))?.focus()
  }, [removed])
  if (error !== undefined)
    return (
      <p role="alert" className="text-sm text-danger">
        Could not read the queue of {project.name}: {error}
      </p>
    )
  const runs = sections(entries!, working)
  return (
    <div ref={queue} data-queue={field ? '' : undefined} className="space-y-8">
      {field && <AddEntry project={project} reload={reload} />}
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing queued.</p>
      ) : (
        <div>
          {batch}
          <div className="space-y-8">
            {runs.map((run, index) => (
              <PanelGroup key={index} title={run.priority === undefined ? 'No priority' : `Priority ${run.priority}`}>
                {run.entries.map(placed => (
                  <EntryRow key={`${placed.place}\n${placed.entry}`} project={project} placed={placed} names={names} starts={starts} reload={reload} onRemoved={() => setRemoved({ place: placed.place })} />
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
 * the scheduler's switch for the command that works the queue on this computer, and its pace where a
 * person set one, read from the settings, with the page that changes them. Until that is read the
 * sentence's room is held, unseen, so nothing under it moves when it comes.
 */
function TakerLine({ projectId, takers }: { projectId: string; takers: Takers }) {
  const host = useModuleHost()
  const known = takers[projectId]
  const { segment, label } = SCHEDULED_COMMANDS_PAGE
  const change = (
    <>
      {' '}
      Change it in{' '}
      <a href={host.pageHref(segment, [], projectId)} onClick={inPlace(() => host.openPage(segment, [], projectId))} className="font-medium text-primary pointer-fine:hover:underline">
        {label}
      </a>
      .
    </>
  )
  // Not read yet, or a read that failed: what takes from it would be a guess, so its words are not said,
  // only their room held.
  if (known === undefined)
    return (
      <span aria-hidden className="invisible">
        {WAITS} Change it in {label}.
      </span>
    )
  // Said in plain words: the command's name is Automations' to say.
  const pace = known.on && known.pace ? paceWords(known.pace) : undefined
  return (
    <span role="status" aria-label="Who takes from the queue">
      {known.on ? `Agents take entries from here by themselves${pace ? `, ${pace}` : ''}.` : WAITS}
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
 * first, then run" where it can be started, and its removal. A free entry has "Start now" before it, and
 * on a phone, where a row has one press, "Start now" is the menu's first item.
 */
function EntryRow({ project, placed, names, starts, reload, onRemoved }: { project: UiProject; placed: Numbered; names: FileNames; starts: QueueStarts; reload: () => Promise<void>; onRemoved: () => void }) {
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
    onRemoved()
  }
  // Nobody is on it and it is not done already: it can be started, from its press beside its menu, or on a phone from its menu.
  const free = agent === undefined && !view.done
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
              <DropdownMenuTrigger render={<Button data-remove-entry variant="ghost" size="icon-bar" aria-label={`More for entry ${place}`} className="-mr-1.5" />}>
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
            {/* The line as written under a name that stands in for it, as on the row. */}
            {view.renamed && <span className="mt-2 block break-words font-mono text-xs">{entry}</span>}
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
function AddEntry({ project, reload }: { project: UiProject; reload: () => Promise<void> }) {
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
            <SelectTrigger aria-label="Priority of the new task" title={`Goes to the end of priority ${priority}`} className="h-9 w-32 justify-between border-transparent bg-accent px-3 hover:border-transparent max-md:h-11 max-md:flex-1">
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
          <Button type="submit" variant="secondary" className="h-9 max-md:h-11" loading={adding} disabled={down} aria-label="Add to queue" title="Add to the queue (Enter)">
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
