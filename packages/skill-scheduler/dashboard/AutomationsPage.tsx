import { useEffect, useRef, useState } from 'react'
import { Page, Switch, Tooltip, TooltipContent, TooltipTrigger, Button, buttonVariants, cn, formatAge, formatDateTime, useCodingAgents, useModuleHost, usePolled, type ModuleCommandResult, type ModuleHost, type ModuleProject } from '@openagt/dashboard/module'
import type { ModulePageProps } from '@openagt/dashboard/module'
import { AutomationForm } from './AutomationForm.js'
import { EditPanel } from './EditPanel.js'
import { openedAutomation, type OpenedAutomation } from './automation-form.js'
import { atOnce, atOnceWords, cannotRun, decided, startedNow, type Answered, isOwn, outcomeWords, ownPace, pace, publishes, readSchedulers, schedulersKey, rowTitle, runsOnWords, saysAtOnce, schedulerStatus, unlistedWords, type AgentModels, type SchedulerCommand, type SchedulerRow } from './schedulers.js'

// The Automations page: what starts by itself while nobody is at the keyboard. One part per
// project the page is given (every project that has this package, or the one picked in the
// dashboard), under its name and its scheduler's status. A project's rows come in two groups: the
// automations a person made with "New automation", and the commands the project's skills schedule,
// as the project's files say them now.
//
// A row is the same whichever group it is in: its name, what it says it does, one line of where it
// stands (on or off, when it last ran or that its last run failed, and what the scheduler last
// decided for it), one line of its picks (when it runs, how many agents at once, which coding agent
// and model its runs are on, how far its runs publish), and three controls: "Run now" starts one run of it at once (`scheduler now`),
// "Edit" opens its panel in place (`EditPanel.tsx`), and its switch says whether it runs by itself
// (`switch`). One panel or form is open at a time, and nothing opens over one that holds a change
// not saved yet.
//
// "New automation", beside a project's name, opens a form for a prompt of the person's own
// (`AutomationForm.tsx`). The rest is this machine's, read with `scheduler status`: no
// tracked file changes. A command is off until its switch is flipped here.

const EMPTY: SchedulerRow[] = []

/** The tick's note that says the project schedules nothing: the page says it in its own words under the heading. */
const NOTHING_SCHEDULED = 'no skill of this project schedules a command'

export function AutomationsPage({ projects }: ModulePageProps) {
  const host = useModuleHost()
  /** Every coding agent with the models it lists: what a row's agent and model are picked from, and named by. */
  const agents = useCodingAgents()
  const key = projects.map(p => p.id).join(',')
  const { value: read, loaded, reload } = usePolled(() => readSchedulers(host, projects), EMPTY, 10_000, [key], { remember: schedulersKey(key) })
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
    if (!loaded) return
    if (panel && !rows.some(row => row.commands.some(c => `${row.project.id}/${c.command}` === panel.id))) setPanel(undefined)
    if (creating !== undefined && !rows.some(row => row.project.id === creating)) setCreating(undefined)
  }, [rows, loaded, panel, creating])
  const editButtons = useRef(new Map<string, HTMLButtonElement>())
  /** Close a row's panel and hand the keyboard back to its Edit button. */
  const close = (id: string): void => {
    setPanel(current => (current?.id === id ? undefined : current))
    setTimeout(() => editButtons.current.get(id)?.focus())
  }
  // Saves go one at a time: each is a command that reads the state file, changes it and writes it
  // back. A command that could not even be asked is a save not taken, and the next one still runs.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const run = (project: ModuleProject, args: string[]): Promise<ModuleCommandResult> => {
    const answered = queue.current.then(() => host.runCommand(project.id, args).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) })))
    queue.current = answered
    return answered
  }
  /** A command asked without waiting for the saves: one that takes seconds and writes nothing a save reads. */
  const ask = (project: ModuleProject, args: string[]): Promise<ModuleCommandResult> => host.runCommand(project.id, args).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
  /** One save or start of a row's own: the row is held until what it did has been read back, so it never shows the old value as if nothing had happened. */
  const save = async (id: string, project: ModuleProject, pending: Promise<ModuleCommandResult>, answered: (answer: ModuleCommandResult) => Answered | undefined): Promise<void> => {
    setBusy(current => [...current, id])
    setSaid(current => (current?.id === id ? undefined : current))
    const answer = await pending
    await reload().catch(() => {})
    setBusy(current => current.filter((_, index) => index !== current.indexOf(id)))
    const says = answered(answer)
    if (says) setSaid({ id, ...says })
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
    setBusy(current => [...current, id])
    const answer = await ask(project, ['show', scheduled.command])
    setBusy(current => current.filter((_, index) => index !== current.indexOf(id)))
    // Nothing opens over a change made, meanwhile, in what is open.
    if (asked.current !== mine || dirtyNow.current) return
    const opened = answer.ok ? openedAutomation(answer.output) : undefined
    setCreating(undefined)
    setPanel({ id, ...(opened ? { opened } : { refused: answer.ok ? 'its file holds something this panel cannot show' : answer.error }) })
  }

  return (
    <Page title="Automations" description="What starts by itself while nobody is at the keyboard. Every row starts switched off: it runs on this machine only once you switch it on here.">
      {!loaded && <p className="text-sm text-muted-foreground">Loading…</p>}
      {rows.map(row => {
        const status = schedulerStatus(row)
        const note = row.lastTick?.note
        const groups: [title: string, commands: SchedulerCommand[]][] = [
          ['Your automations', row.commands.filter(isOwn)],
          ["From the project's skills", row.commands.filter(c => !isOwn(c))],
        ]
        return (
          <section key={row.project.id} aria-label={row.project.name} className="not-first:mt-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-2">
              <h2 className="text-sm font-semibold">{row.project.name}</h2>
              <span className={cn('text-xs font-medium', status.tone)}>Scheduler {status.label}</span>
              {row.model && <span className="text-xs text-muted-foreground">{row.model}</span>}
              {row.lastTick && (
                <span className="text-xs text-muted-foreground">
                  last tick{' '}
                  <Tooltip>
                    <TooltipTrigger render={<span className="tabular-nums" />}>{formatAge(row.lastTick.at)}</TooltipTrigger>
                    <TooltipContent>{formatDateTime(row.lastTick.at)}</TooltipContent>
                  </Tooltip>
                  {/* Why that tick decided nothing, when it says: a pull that failed. "off" is the status beside the name, and a project that schedules nothing says so below. */}
                  {note !== undefined && note !== 'off' && note !== NOTHING_SCHEDULED && `: ${note}`}
                </span>
              )}
              {row.error === undefined && creating !== row.project.id && (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={held}
                  onClick={() => {
                    asked.current++
                    setPanel(undefined)
                    setCreating(row.project.id)
                  }}
                  aria-label={`New automation in ${row.project.name}`}
                  className="ml-auto"
                >
                  New automation
                </Button>
              )}
            </div>
            {creating === row.project.id && <AutomationForm project={row.project} run={args => run(row.project, args)} onDirty={setDirty} onClose={() => setCreating(undefined)} onSaved={() => void reload().catch(() => {})} />}
            {removed?.project === row.project.id && (
              <div role="status" aria-label="Removed" className="mt-3 flex items-start justify-between gap-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
                <p>{removed.text}</p>
                <Button variant="outline" size="sm" onClick={() => setRemoved(undefined)}>
                  Done
                </Button>
              </div>
            )}
            {row.error !== undefined && <p role="alert" className="py-3 text-sm text-danger">{`The scheduler could not be read: ${row.error}`}</p>}
            {row.error === undefined && !row.on && <p className="py-3 text-sm text-muted-foreground">The scheduler is off in this project, so nothing here starts by itself. It starts with the dashboard once the project has run `npx @openagt/skill-scheduler@0.1 init`, or by hand with `npx @openagt/skill-scheduler@0.1 start`.</p>}
            {row.error === undefined && row.on && !row.running && <p className="py-3 text-sm text-warning">The scheduler is on but its process is not running, so nothing here starts by itself. `npx @openagt/skill-scheduler@0.1 start`, run in the project, starts it.</p>}
            {row.unreadable.map((unreadable, index) => (
              <p key={`${index}/${unreadable.skill}`} role="alert" className="py-3 text-sm text-danger">
                {unlistedWords(unreadable)}
              </p>
            ))}
            {row.error === undefined && row.commands.length === 0 && row.unreadable.length === 0 && (
              <p className="py-3 text-sm text-muted-foreground">Nothing here: no skill of this project says it can be scheduled.</p>
            )}
            {groups.map(
              ([group, commands]) =>
                commands.length > 0 && (
                  <div key={group} role="group" aria-label={group} className="mt-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
                    <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                      {commands.map(scheduled => {
                        const id = `${row.project.id}/${scheduled.command}`
                        const title = rowTitle(scheduled)
                        const saving = busy.includes(id)
                        const shown = panel?.id === id ? panel : undefined
                        const says = said?.id === id ? said : undefined
                        return (
                          <li key={id} aria-label={title} className={cn('p-4', saving && 'opacity-60')}>
                            {/* On a phone the buttons go under the words, which need the whole width. */}
                            <div className="flex items-start justify-between gap-4 max-md:flex-col">
                              <div className="min-w-0">
                                <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                                  <span className="font-mono font-medium">{title}</span>
                                  {isOwn(scheduled) && <span className="text-xs text-info">{scheduled.onThisMachine ? 'only on this machine' : 'shared with the project'}</span>}
                                </p>
                                {scheduled.description && <p className="line-clamp-2 text-sm text-muted-foreground">{scheduled.description}</p>}
                                <Stands host={host} project={row.project} scheduled={scheduled} />
                                {!shown && <Picks scheduled={scheduled} schedulerModel={row.model} agents={agents} />}
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <Button
                                  variant="outline"
                                  size="xs"
                                  disabled={saving || cannotRun(scheduled) !== undefined}
                                  onClick={() => void save(id, row.project, ask(row.project, ['now', scheduled.command]), startedNow)}
                                  aria-label={`Run ${title} now`}
                                >
                                  Run now
                                </Button>
                                <button
                                  type="button"
                                  ref={button => {
                                    if (button) editButtons.current.set(id, button)
                                    else editButtons.current.delete(id)
                                  }}
                                  disabled={saving || shown !== undefined || held}
                                  onClick={() => void open(id, row.project, scheduled)}
                                  aria-label={`Edit ${title}`}
                                  className={buttonVariants({ variant: 'outline', size: 'xs' })}
                                >
                                  Edit
                                </button>
                                <Switch
                                  checked={scheduled.on}
                                  disabled={saving}
                                  onCheckedChange={next => void save(id, row.project, run(row.project, ['switch', scheduled.command, next ? 'on' : 'off']), answer => (answer.ok ? undefined : { failed: `The switch was not saved: ${answer.error}` }))}
                                  aria-label={`Run ${title} by itself`}
                                />
                              </div>
                            </div>
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
                              <p role="status" className="mt-2 text-xs text-success">
                                {says.resumed ? 'Resumed a run.' : 'Started a run.'}{' '}
                                {says.started !== '' && (
                                  <button type="button" onClick={() => host.openAgent(row.project.id, says.started!)} className="underline">
                                    Open it
                                  </button>
                                )}
                              </p>
                            )}
                            {says?.note !== undefined && (
                              <p role="status" className="mt-2 text-xs text-muted-foreground">
                                {says.note}
                              </p>
                            )}
                            {says?.failed !== undefined && (
                              <p role="alert" className="mt-2 text-xs text-danger">
                                {says.failed}
                              </p>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ),
            )}
          </section>
        )
      })}
    </Page>
  )
}

/** What a save or a start on a row answered, for the row to say: why it was not taken, that nothing was to do, or the run it started (empty when the answer names none). */
/**
 * Where a row stands, in one line: on or off; when it last ran, or that its last run failed, which
 * opens that run; and what the scheduler last decided for it while it is on. A command the coding
 * agent cannot run says so whatever its switch.
 */
function Stands({ host, project, scheduled }: { host: ModuleHost; project: ModuleProject; scheduled: SchedulerCommand }) {
  const last = scheduled.lastRun
  const decision = decided(scheduled)
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
      <span className={cn('inline-flex items-center gap-1.5 font-medium', scheduled.on ? 'text-success' : 'text-muted-foreground')}>
        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', scheduled.on ? 'bg-success' : 'bg-muted-foreground/50')} />
        {scheduled.on ? 'On' : 'Off'}
      </span>
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      {last === undefined ? (
        <span className="text-muted-foreground">Never ran</span>
      ) : (
        <Tooltip>
          <TooltipTrigger render={<button type="button" onClick={() => host.openAgent(project.id, last.id)} className={cn('underline', last.failed ? 'text-danger' : 'text-muted-foreground hover:text-foreground')} />}>
            {last.failed ? 'Last run failed' : 'Last ran'} <span className="tabular-nums">{formatAge(last.at)}</span>
          </TooltipTrigger>
          <TooltipContent>{formatDateTime(last.at)}</TooltipContent>
        </Tooltip>
      )}
      {decision !== undefined && (
        <>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className={cannotRun(scheduled) ? 'text-warning' : 'text-muted-foreground'}>{decision}</span>
        </>
      )}
    </p>
  )
}

/** A row's picks, in one line: when it runs, how many agents at once when that is worth saying, which coding agent and model its runs are on, and how far they publish. A pick of the person's own, on a row that could follow its skill, says so. */
function Picks({ scheduled, schedulerModel, agents }: { scheduled: SchedulerCommand; schedulerModel: string | undefined; agents: readonly AgentModels[] }) {
  const follows = !isOwn(scheduled)
  return (
    <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
      <span>{pace(scheduled)}</span>
      {follows && ownPace(scheduled) && (
        <>
          <span aria-hidden>·</span>
          <span className="text-info">your pick</span>
        </>
      )}
      {saysAtOnce(scheduled) && (
        <>
          <span aria-hidden>·</span>
          <span>{atOnceWords(atOnce(scheduled))}</span>
          {follows && scheduled.agents !== undefined && (
            <>
              <span aria-hidden>·</span>
              <span className="text-info">your pick</span>
            </>
          )}
        </>
      )}
      <span aria-hidden>·</span>
      <span>{runsOnWords(scheduled, schedulerModel, agents)}</span>
      {follows && (scheduled.runsOn !== undefined || scheduled.model !== undefined) && (
        <>
          <span aria-hidden>·</span>
          <span className="text-info">your pick</span>
        </>
      )}
      <span aria-hidden>·</span>
      <span>{publishes(scheduled)}</span>
    </p>
  )
}
