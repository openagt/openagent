import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Facts, Page, Panel, PanelGroup, PanelShape, RunMark, Skeleton, Slot, Switch, WordsShape, Tooltip, TooltipContent, TooltipTrigger, Button, cn, formatAge, formatDateTime, inPlace, useCodingAgents, useIsMobile, useModuleHost, useOpenAgentDown, usePolled, type ModuleCommandResult, type ModuleHost, type ModuleProject } from '@openagt/dashboard/module'
import type { ModulePageProps } from '@openagt/dashboard/module'
import { MoreHorizontal, Play, Plus } from 'lucide-react'
import { AutomationForm } from './AutomationForm.js'
import { CodeWords, Command } from './CodeWords.js'
import { EditPanel } from './EditPanel.js'
import { openedAutomation, type OpenedAutomation } from './automation-form.js'
import { AGENT_LABELS, DEFAULT_AGENT, TICK_MS } from '../src/names.js'
import { atOnce, atOnceWords, cannotRun, decided, heldBy, notAsked, startedNow, type Answered, isOwn, modelLabel, pace, publishes, saysAtOnce, readSchedulers, schedulersKey, rowTitle, schedulerStatus, schedulerStopped, unlistedWords, type AgentModels, type SchedulerCommand, type SchedulerRow } from './schedulers.js'

// The Automations page: what starts by itself while nobody is at the keyboard. One part per
// project the page is given (every project that has this package, or the one picked in the
// dashboard), under its name and its scheduler's status. A project's rows come in two groups: the
// automations a person made with "New automation", and the commands the project's skills schedule,
// as the project's files say them now.
//
// A row is the same whichever group it is in, two lines after the mark of its last run: its name with
// what it says it does, and its three controls: "Run now" starts one run of it at once (`scheduler
// now`), "Edit" opens its panel in place (`EditPanel.tsx`), both shown under the pointer and in a "⋯"
// on a phone, and its switch, always there, says whether it runs by itself (`switch`); then one line
// of its picks (when it runs, how many agents at once, which coding agent and model its runs are on,
// how far its runs publish) and of where it stands (when it last ran or that its last run failed, and
// what the scheduler last decided for it). One panel or form is open at a time, and nothing opens over
// one that holds a change not saved yet.
//
// "New automation", the page's primary (beside each project's name when it shows several), opens a form for a prompt of the person's own
// (`AutomationForm.tsx`). The rest is this machine's, read with `scheduler status`: no
// tracked file changes. A command is off until its switch is flipped here.

const EMPTY: SchedulerRow[] = []

/** The commands that start the scheduler, run in the project: with the dashboard from then on, or once, now. */
const INIT = 'npx @openagt/skill-scheduler@0.1 init'
const START = 'npx @openagt/skill-scheduler@0.1 start'

/** The tick's note that says the project schedules nothing: the page says it in its own words under the heading. */
const NOTHING_SCHEDULED = 'no skill of this project schedules a command'

/** How long a running scheduler may go without a look before its line says so: two ticks missed. */
const LATE = 3 * TICK_MS

export function AutomationsPage({ projects }: ModulePageProps) {
  const host = useModuleHost()
  const down = useOpenAgentDown()
  const phone = useIsMobile()
  /** Every coding agent with the models it lists: what a row's agent and model are picked from, and named by. */
  const agents = useCodingAgents()
  const key = projects.map(p => p.id).join(',')
  // Kept for the next visit, as the Overview's card keeps it: the page opens with the last rows, faded until they are read again.
  const { value: read, state, reload } = usePolled(() => readSchedulers(host, projects), EMPTY, 10_000, [key], { remember: schedulersKey(key), stored: true })
  // A read that fails for a moment keeps the project's rows as they were last read, under the line
  // that says why: a panel open in one of them, and what was typed there, stays.
  const lastRead = useRef(new Map<string, SchedulerRow>())
  const rows = read.map(row => {
    if (row.error === undefined) lastRead.current.set(row.project.id, row)
    const before = lastRead.current.get(row.project.id)
    return row.error !== undefined && before ? { ...before, error: row.error } : row
  })
  /** The rows with a save waiting or in flight, each as often as it has one. */
  const [busy, setBusy] = useState<readonly string[]>([])
  /** Hold a row for one more thing of its own in flight, and let it go of one once that is over. */
  const hold = (id: string): void => setBusy(current => [...current, id])
  const letGo = (id: string): void => setBusy(current => current.filter((_, index) => index !== current.indexOf(id)))
  /** Where a row's switch was pressed to, while that is saved and read back: it moves at the press. */
  const [switched, setSwitched] = useState<Readonly<Record<string, boolean>>>({})
  /** The rows whose "Run now" has not answered yet, each as often as it was pressed. */
  const [starting, setStarting] = useState<readonly string[]>([])
  /** What the last save or start on a row answered, said on that row. */
  const [said, setSaid] = useState<{ id: string } & Answered>()
  /** The row whose panel is open, with its own automation as its file says it when it is one a person made, or why that could not be read. */
  const [panel, setPanel] = useState<{ id: string; opened?: OpenedAutomation; refused?: string } | undefined>()
  /** The project whose "New automation" form is open. */
  const [creating, setCreating] = useState<string | undefined>()
  /** Whether the open panel or form holds a change not saved yet: nothing else opens over it. */
  const [dirty, setDirtyState] = useState(false)
  /** The same, as of now: an automation read for its panel answers long after the click that asked for it. */
  const dirtyNow = useRef(false)
  const setDirty = (next: boolean): void => {
    dirtyNow.current = next
    setDirtyState(next)
  }
  /** What the last removal did and what is left for the person to do, under the project it was in, until they put it away. */
  const [removed, setRemoved] = useState<{ project: string; text: string } | undefined>()
  /** The last panel asked for: an automation that answers late, after another row was opened, opens nothing. */
  const asked = useRef(0)
  const held = dirty && (panel !== undefined || creating !== undefined)
  // A panel, or a form, whose row or project is no longer listed is closed: its row was removed
  // elsewhere, or another project was picked. Left open it would show nowhere, and hold every
  // button that opens one.
  useEffect(() => {
    if (state === 'unknown') return
    if (panel && !rows.some(row => row.commands.some(c => `${row.project.id}/${c.command}` === panel.id))) setPanel(undefined)
    if (creating !== undefined && !rows.some(row => row.project.id === creating)) setCreating(undefined)
  }, [rows, state, panel, creating])
  const editButtons = useRef(new Map<string, HTMLButtonElement>())
  /** Close a row's panel and hand the keyboard back to its Edit button. */
  const close = (id: string): void => {
    setPanel(current => (current?.id === id ? undefined : current))
    setTimeout(() => editButtons.current.get(id)?.focus())
  }
  const newButtons = useRef(new Map<string, HTMLButtonElement>())
  /** Hand the keyboard to a project's "New automation" button, once the form or the note that stood in its place is closed. */
  const backToNew = (projectId: string): void => {
    setTimeout(() => newButtons.current.get(projectId)?.focus())
  }
  // Saves go one at a time: each is a command that reads the state file, changes it and writes it
  // back. A command that could not even be asked is a save not taken, and the next one still runs.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const run = (project: ModuleProject, args: string[]): Promise<ModuleCommandResult> => {
    const answered = queue.current.then(() => host.runCommand(project.id, args).catch(notAsked))
    queue.current = answered
    return answered
  }
  /** A command asked without waiting for the saves: one that takes seconds and writes nothing a save reads. */
  const ask = (project: ModuleProject, args: string[]): Promise<ModuleCommandResult> => host.runCommand(project.id, args).catch(notAsked)
  /** One save or start of a row's own: the row is held until what it did has been read back, so it never shows the old value as if nothing had happened. */
  const save = async (id: string, pending: Promise<ModuleCommandResult>, answered: (answer: ModuleCommandResult) => Answered | undefined): Promise<void> => {
    hold(id)
    setSaid(current => (current?.id === id ? undefined : current))
    const answer = await pending
    await reload().catch(() => {})
    letGo(id)
    const says = answered(answer)
    if (says) setSaid({ id, ...says })
  }

  /** Start one run of a row at once (`scheduler now`): its button says so until the run is started, or why none was. */
  const startNow = async (id: string, project: ModuleProject, command: string): Promise<void> => {
    setStarting(current => [...current, id])
    await save(id, ask(project, ['now', command]), startedNow)
    setStarting(current => current.filter((_, index) => index !== current.indexOf(id)))
  }

  /**
   * Open a row's panel. A row a person made is read first, as its file says it now (`show`, which
   * refuses a file changed by hand): its words are then the panel's to change, and when it cannot
   * be read the panel says why and leaves them alone. Nothing opens over a change not saved yet.
   */
  const open = async (id: string, project: ModuleProject, scheduled: SchedulerCommand): Promise<void> => {
    const mine = ++asked.current
    setSaid(current => (current?.id === id ? undefined : current))
    if (!scheduled.editable) {
      setCreating(undefined)
      return setPanel({ id })
    }
    hold(id)
    const answer = await ask(project, ['show', scheduled.command])
    letGo(id)
    // Nothing opens over a change made, meanwhile, in what is open.
    if (asked.current !== mine || dirtyNow.current) return
    const opened = answer.ok ? openedAutomation(answer.output) : undefined
    setCreating(undefined)
    setPanel({ id, ...(opened ? { opened } : { refused: answer.ok ? 'its file holds something this panel cannot show' : answer.error }) })
  }

  /**
   * A project's "New automation": the page's one primary when it shows one project, a quieter press beside each project's
   * name when it shows several. Drawn from the first frame on a one-project page, and pressed once its scheduler is read.
   */
  const newButton = (project: ModuleProject, primary: boolean, read = true): ReactNode =>
    creating !== project.id && (
      <Button
        ref={button => {
          if (button) newButtons.current.set(project.id, button)
          else newButtons.current.delete(project.id)
        }}
        variant={primary ? 'default' : 'secondary'}
        disabled={held || !read}
        onClick={() => {
          asked.current++
          setPanel(undefined)
          setCreating(project.id)
        }}
        aria-label={`New automation in ${project.name}`}
      >
        <Plus className="size-4" aria-hidden />
        New automation
      </Button>
    )
  const single = rows.length === 1 ? rows[0] : undefined

  return (
    <Page
      title="Automations"
      description="What starts by itself while nobody is at the keyboard."
      actions={single ? single.error === undefined && newButton(single.project, true) : projects.length === 1 && newButton(projects[0]!, true, false)}
      // One project's status under the page's line, its height held from the first paint.
      bar={projects.length === 1 ? single ? <StatusLine row={single} agents={agents} /> : <StatusShape /> : undefined}
    >
      <Slot
        of={{ value: rows, state }}
        shape={
          <PanelGroup bare title={<WordsShape words="Your automations" />}>
            {phone ? <PhoneRowShapes /> : <PanelShape rows={2} />}
          </PanelGroup>
        }
        className="space-y-8"
      >
        {rows =>
          rows.map(row => {
            const groups: [title: string, commands: SchedulerCommand[]][] = [
              ['Your automations', row.commands.filter(isOwn)],
              ["From the project's skills", row.commands.filter(c => !isOwn(c))],
            ]
            return (
              // A project's part, named by the project: under its heading beside its own "New automation" when
              // the page shows several, and for a reader only when it shows one, which the page's head names.
              <section key={row.project.id} aria-labelledby={`automations-${row.project.id}`} className="min-w-0">
                <div className={cn('flex items-center gap-2', single === undefined && 'mb-2')}>
                  <h2 id={`automations-${row.project.id}`} className={cn('min-w-0 flex-1 truncate text-base font-semibold', single !== undefined && 'sr-only')}>
                    {row.project.name}
                  </h2>
                  {single === undefined && row.error === undefined && newButton(row.project, false)}
                </div>
                {single === undefined && <StatusLine row={row} agents={agents} className="mb-6" />}
                {creating === row.project.id && (
                  <AutomationForm
                    project={row.project}
                    schedulerRuns={schedulerStopped(row) === undefined}
                    run={args => run(row.project, args)}
                    onDirty={setDirty}
                    onClose={() => {
                      setCreating(undefined)
                      backToNew(row.project.id)
                    }}
                    onSaved={() => void reload().catch(() => {})}
                  />
                )}
                {removed?.project === row.project.id && (
                  <div role="status" aria-label="Removed" className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-hairline p-3 text-sm">
                    <p>{removed.text}</p>
                    <Button
                      variant="secondary"
                      autoFocus
                      onClick={() => {
                        setRemoved(undefined)
                        backToNew(row.project.id)
                      }}
                    >
                      Done
                    </Button>
                  </div>
                )}
                {row.error !== undefined && <p role="alert" className="text-sm text-danger">{`The scheduler could not be read: ${row.error}`}</p>}
                {row.unreadable.map((unreadable, index) => (
                  <p key={`${index}/${unreadable.skill}`} role="alert" className="mb-3 text-sm text-danger">
                    {unlistedWords(unreadable)}
                  </p>
                ))}
                {row.error === undefined && row.commands.length === 0 && row.unreadable.length === 0 && creating !== row.project.id && (
                  <p className="text-sm text-muted-foreground">
                    No automations yet: make one with New automation, or pick a skill that schedules one in <SkillsLink />.
                  </p>
                )}
                {groups.map(
                  ([group, commands]) =>
                    commands.length > 0 && (
                      <div key={group} className="not-last:mb-8">
                        <PanelGroup bare title={group}>
                          {/* Clipped to its corners without being a box that scrolls, so an open panel's Save row
                              keeps to the window's foot. */}
                          <Panel className="overflow-clip">
                            {commands.map(scheduled => {
                              const id = `${row.project.id}/${scheduled.command}`
                              const title = rowTitle(scheduled)
                              const saving = busy.includes(id)
                              const shown = panel?.id === id ? panel : undefined
                              const says = said?.id === id ? said : undefined
                              // What held every start back at the scheduler's last look holds one asked for now too: it would start nothing.
                              const unstartable = cannotRun(scheduled) !== undefined || (schedulerStopped(row) === undefined && heldBy(scheduled) === 'every start')
                              return (
                                // The mark of its last run, then two lines, as a card's row that says more than its name: the name
                                // with what it does, its presses and its switch at the right; then, quieter, its picks and where it
                                // stands. Its panel and what its last press answered open under them, on the name's edge.
                                <li
                                  key={id}
                                  aria-label={title}
                                  className={cn(
                                    'group/row relative px-4 py-3 text-sm',
                                    'before:absolute before:top-0 before:right-4 before:left-4 before:h-px not-first:before:bg-hairline',
                                    saving && 'opacity-60',
                                  )}
                                >
                                  <div className="flex items-start gap-3">
                                    <span className="flex h-5 w-4 shrink-0 items-center">
                                      {/* Its last run's state; an empty outline for one that never ran, as its line says. */}
                                      <RunMark status={scheduled.lastRun === undefined ? 'unknown' : scheduled.lastRun.failed ? 'failed' : scheduled.lastRun.running ? 'running' : 'done'} />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate leading-5 max-md:line-clamp-2 max-md:whitespace-normal">
                                        <span className="font-medium">{title}</span>
                                        {/* What it says it does, after its name and quieter, apart from it as a list's row sets its
                                            detail: cut with it at the row's end, and whole in its panel. */}
                                        {scheduled.description && <span className="ml-3 text-muted-foreground">{scheduled.description}</span>}
                                      </p>
                                      <Stands host={host} project={row.project} scheduled={scheduled} stopped={schedulerStopped(row)} picks={shown === undefined} />
                                    </div>
                                    {/* Centred on the name and its line. Under a mouse the presses take room only while the
                                        pointer or the keyboard is on the row, or while what they did is open; the switch is
                                        always there. On a phone they are the "⋯"'s, pulled out by its padding to the inset. */}
                                    <div className="-my-1 flex shrink-0 items-center gap-1 self-center">
                                      {phone ? null : (
                                        <div
                                          className={cn(
                                            'flex items-center gap-1',
                                            shown === undefined && !starting.includes(id) && 'pointer-fine:w-0 pointer-fine:overflow-hidden pointer-fine:group-hover/row:w-auto pointer-fine:group-hover/row:overflow-visible pointer-fine:group-focus-within/row:w-auto pointer-fine:group-focus-within/row:overflow-visible',
                                          )}
                                        >
                                          <Button variant="secondary" size="sm" disabled={saving || down || unstartable} onClick={() => void startNow(id, row.project, scheduled.command)} aria-label={`Run ${title} now`}>
                                            <Play className="size-3.5" aria-hidden />
                                            {starting.includes(id) ? 'Starting…' : 'Run now'}
                                          </Button>
                                          <Button
                                            ref={button => {
                                              if (button) editButtons.current.set(id, button)
                                              else editButtons.current.delete(id)
                                            }}
                                            variant="ghost"
                                            size="sm"
                                            disabled={saving || shown !== undefined || held}
                                            onClick={() => void open(id, row.project, scheduled)}
                                            aria-label={`Edit ${title}`}
                                          >
                                            Edit
                                          </Button>
                                        </div>
                                      )}
                                      <Switch
                                        checked={switched[id] ?? scheduled.on}
                                        disabled={saving || down}
                                        onCheckedChange={next => {
                                          setSwitched(current => ({ ...current, [id]: next }))
                                          void save(id, run(row.project, ['switch', scheduled.command, next ? 'on' : 'off']), answer => (answer.ok ? undefined : { failed: `The switch was not saved: ${answer.error}` })).then(() => setSwitched(({ [id]: _pressed, ...rest }) => rest))
                                        }}
                                        aria-label={`Run ${title} by itself`}
                                        className={cn(!phone && 'ml-2')}
                                      />
                                      {phone && (
                                        <DropdownMenu>
                                          <DropdownMenuTrigger
                                            ref={(button: HTMLButtonElement | null) => {
                                              if (button) editButtons.current.set(id, button)
                                              else editButtons.current.delete(id)
                                            }}
                                            render={<Button variant="ghost" size="icon-bar" className="-mr-1.5 ml-1 text-faint-foreground" />}
                                            aria-label={`More for ${title}`}
                                          >
                                            <MoreHorizontal className="size-4" aria-hidden />
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end" className="min-w-44">
                                            <DropdownMenuItem disabled={saving || down || unstartable} onClick={() => void startNow(id, row.project, scheduled.command)}>
                                              {starting.includes(id) ? 'Starting…' : 'Run now'}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem disabled={saving || shown !== undefined || held} onClick={() => void open(id, row.project, scheduled)}>
                                              Edit
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      )}
                                    </div>
                                  </div>
                                  <div className="px-7">
                                    {shown && (
                                      <EditPanel
                                        project={row.project}
                                        scheduled={scheduled}
                                        opened={shown.opened}
                                        refused={shown.refused}
                                        schedulerModel={row.model}
                                        agents={agents}
                                        run={args => run(row.project, args)}
                                        reload={reload}
                                        onDirty={setDirty}
                                        onClose={() => close(id)}
                                        onRemoved={text => {
                                          setPanel(undefined)
                                          setRemoved({ project: row.project.id, text })
                                          // Gone from what is kept of the last read too: a read that fails right now does not bring the row back.
                                          const before = lastRead.current.get(row.project.id)
                                          if (before) lastRead.current.set(row.project.id, { ...before, commands: before.commands.filter(c => c.command !== scheduled.command) })
                                        }}
                                      />
                                    )}
                                    {says?.started !== undefined && (
                                      <p role="status" className="mt-1 text-xs text-success">
                                        {says.resumed ? 'Resumed a run.' : 'Started a run.'}{' '}
                                        {says.started !== '' && (
                                          <button type="button" onClick={() => host.openAgent(row.project.id, says.started!)} className="focus-ring rounded-sm text-primary hover:underline">
                                            Open it
                                          </button>
                                        )}
                                      </p>
                                    )}
                                    {says?.note !== undefined && (
                                      <p role="status" className="mt-1 text-xs text-muted-foreground">
                                        <CodeWords text={says.note} />
                                      </p>
                                    )}
                                    {says?.failed !== undefined && (
                                      <p role="alert" className="mt-1 text-xs text-danger">
                                        <CodeWords text={says.failed} />
                                      </p>
                                    )}
                                  </div>
                                </li>
                              )
                            })}
                          </Panel>
                        </PanelGroup>
                      </div>
                    ),
                )}
                {row.error === undefined && row.on && !row.running && (
                  <div className="mt-4 max-w-180 text-sm text-warning">
                    <p>The scheduler is on but its process is not running, so nothing here starts by itself. To start it, run in the project:</p>
                    <Command text={START} />
                  </div>
                )}
              </section>
            )
          })
        }
      </Slot>
    </Page>
  )
}

/** The scheduler's line while it is read: a bar in its likely words' room, so the line lands in its own place. */
function StatusShape() {
  return (
    <p aria-hidden className="text-xs">
      <WordsShape words="Scheduler on · Claude Code, opus" />
    </p>
  )
}

/** A press in a line of facts: its words' size, and on a phone a finger's 44 around them. */
const LINE_PRESS = 'focus-ring relative rounded-sm font-medium hover:underline after:absolute after:-inset-y-3 after:-inset-x-1 md:after:-inset-y-1.5'

/**
 * A project's scheduler in one line: whether it runs, and the model rows on Claude Code start on where
 * nothing else names one; then, in the warning colour, a look that is late or that failed; while it is
 * off, the ways to turn it on: where it is ticked so it starts with the dashboard, and "In a terminal",
 * which shows under the line the two commands that start it, now (`start`) and with the dashboard from
 * now on (`init`). The page says it is off here alone. Under the page's line when the page shows one
 * project, else under the project's name.
 */
function StatusLine({ row, agents, className }: { row: SchedulerRow; agents: readonly AgentModels[]; className?: string }) {
  const status = schedulerStatus(row)
  const note = row.lastTick?.note
  const [commands, setCommands] = useState(false)
  const off = row.error === undefined && !row.on
  // What turns it on: a row of its own under the facts, in the page's words' size, so the way out of "off" reads as one.
  const presses = off && [
    <TurnOn />,
    <button type="button" aria-expanded={commands} onClick={() => setCommands(shown => !shown)} className={cn(LINE_PRESS, 'text-muted-foreground hover:text-foreground')}>
      In a terminal
    </button>,
  ]
  return (
    <div className={className}>
      {/* Joined as every line of facts is. */}
      <Facts
        className="text-xs text-muted-foreground"
        facts={[
          <span className={cn('inline-flex items-center gap-1.5 font-medium', status.tone)}>
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
            Scheduler {status.label}
          </span>,
          row.model && `${AGENT_LABELS[DEFAULT_AGENT]}, ${modelLabel(agents, DEFAULT_AGENT, row.model)}`,
          row.lastTick && row.running && Date.now() - Date.parse(row.lastTick.at) > LATE && (
            <Tooltip>
              <TooltipTrigger render={<span className="text-warning" />}>
                Last looked <span className="tabular-nums">{formatAge(row.lastTick.at)}</span>
              </TooltipTrigger>
              <TooltipContent>The scheduler last looked {formatDateTime(row.lastTick.at)}</TooltipContent>
            </Tooltip>
          ),
          // Why its last look decided nothing, when it says: a pull that failed. "off" is the status, and a project that schedules nothing says so below.
          note !== undefined && note !== 'off' && note !== NOTHING_SCHEDULED && <span className="text-warning">{`Its last look: ${note}`}</span>,
        ]}
      />
      {presses && <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm max-md:mt-3">{presses.map((press, at) => <span key={at}>{press}</span>)}</div>}
      {off && commands && (
        <div className="mt-3 max-w-180 space-y-2 text-sm text-muted-foreground">
          <p>To start it now, run in the project:</p>
          <Command text={START} />
          <p className="pt-2">To start it with the dashboard from now on:</p>
          <Command text={INIT} />
        </div>
      )}
    </div>
  )
}

/** Two rows while they are read on a phone, where a row's name and words take two lines and its facts two more: as tall as the rows that come */
function PhoneRowShapes() {
  return (
    <Panel>
      {[0, 1].map(at => (
        <li key={at} className="relative flex items-start gap-3 px-4 py-3 before:absolute before:top-0 before:right-4 before:left-4 before:h-px not-first:before:bg-hairline">
          <span className="flex h-5 w-4 shrink-0 items-center">
            <Skeleton className="size-3 rounded-sm" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex h-5 items-center">
              <Skeleton className="h-2.5 w-full" />
            </span>
            <span className="flex h-5 items-center">
              <Skeleton className="h-2.5 w-2/3" />
            </span>
            <span className="mt-0.5 flex h-4 items-center">
              <Skeleton className="h-2 w-1/2" />
            </span>
            <span className="flex h-4 items-center">
              <Skeleton className="h-2 w-2/3" />
            </span>
          </span>
        </li>
      ))}
    </Panel>
  )
}

/** Where a scheduler that is off is turned on: Settings › Skills, whose tick starts it with the dashboard. */
function TurnOn() {
  const host = useModuleHost()
  return (
    <button type="button" onClick={() => host.openSettings('skills')} className={cn(LINE_PRESS, 'text-primary')}>
      Turn it on in Skills
    </button>
  )
}

/** Settings › Skills, where a project's skills are ticked: the scheduler's among them. */
function SkillsLink() {
  const host = useModuleHost()
  return (
    <button type="button" onClick={() => host.openSettings('skills')} className="focus-ring rounded-sm text-primary hover:underline">
      Settings › Skills
    </button>
  )
}

/**
 * A row's second line, joined as a card's row joins its facts: where it stands (when it last ran, that its
 * last run failed, or that it is still going, which opens that run); what holds it or when it starts next,
 * when there is something to say (what the scheduler last decided for it while it is on, or, while the
 * scheduler is stopped, that it does not start; a command the coding agent cannot run says so whatever its
 * switch); then its picks: its pace, how many agents at once when that is worth saying, and how far its runs
 * publish, left to the panel while it is open, which says them as they would be. Its other picks are its Edit
 * panel's. One line, cut, under a mouse; wrapped whole on a phone.
 */
function Stands({ host, project, scheduled, stopped, picks }: { host: ModuleHost; project: ModuleProject; scheduled: SchedulerCommand; /** Why nothing starts by itself in its project, while that is so ({@link schedulerStopped}). */ stopped: string | undefined; /** Whether its picks are said: not while its panel is open. */ picks: boolean }) {
  const last = scheduled.lastRun
  const idle = scheduled.on && stopped !== undefined && cannotRun(scheduled) === undefined
  const decision = idle ? `Does not start: ${stopped.charAt(0).toLowerCase()}${stopped.slice(1)}` : decided(scheduled)
  // Switched on, and still not starting: its reason is said as a stopped scheduler's is.
  const held = cannotRun(scheduled) !== undefined || (scheduled.on && heldBy(scheduled) !== undefined)
  return (
    <Facts
      className="mt-1 text-xs text-faint-foreground"
      facts={[
        last === undefined ? (
          'Never ran'
        ) : (
          <Tooltip>
            <TooltipTrigger render={<a href={host.agentHref(project.id, last.id)} onClick={inPlace(() => host.openAgent(project.id, last.id))} className={cn('focus-ring relative rounded-sm underline-offset-2 hover:underline after:absolute after:-inset-y-1.5 after:inset-x-0', last.failed ? 'text-danger' : last.running ? 'text-info' : 'hover:text-foreground')} />}>
              {last.failed ? 'Last run failed' : last.running ? 'Running, started' : 'Last ran'} <span className="tabular-nums">{formatAge(last.at)}</span>
            </TooltipTrigger>
            <TooltipContent>{formatDateTime(last.at)}</TooltipContent>
          </Tooltip>
        ),
        decision !== undefined && (
          <span className={cn(idle || held ? 'text-warning' : undefined)}>
            <CodeWords text={decision} />
          </span>
        ),
        picks && pace(scheduled),
        picks && saysAtOnce(scheduled) && atOnceWords(atOnce(scheduled)),
        picks && publishes(scheduled),
      ]}
    />
  )
}
