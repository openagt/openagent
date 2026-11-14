import { useState } from 'react'
import { Button, PageLink, RowShapes, Section, Slot, Tooltip, TooltipContent, TooltipTrigger, cn, formatAge, inPlace, formatDateTime, useModuleHost, useOpenAgentDown, usePolled, type ModuleCardProps, type ModuleProject } from '@openagt/dashboard/module'
import { CodeWords } from './CodeWords.js'
import { cannotRun, notAsked, readSchedulers, schedulersKey, rowTitle, schedulerStatus, schedulerStopped, startedNow, startsNext, unlistedWords, type Answered, type SchedulerCommand, type SchedulerRow } from './schedulers.js'

// The Overview's Automations card: what starts by itself in every project that has this package,
// read with `scheduler status` every 10 seconds. It is called what its page is called, and
// its title opens that page. Per project: the rows that are switched on, each with when it starts
// next, in the words its Edit panel uses ("Next start in 3h, if there is work"); then one line for
// the rows that are switched off, however many they are. A row whose last look started a run opens
// that agent. A project whose scheduler is not running says, under its status, that nothing starts
// there, and leads to the page, which says how to start it; one that schedules nothing leads there too.
//
// One button, on the row under the pointer: "Run now", as the page's (`scheduler now`), for a
// row the person wants once, now, without going to the page. A row is switched on its own page;
// the scheduler is started and stopped by the project's own hooks when the dashboard opens and
// closes, and by hand from the command line.

const EMPTY: SchedulerRow[] = []

/** How many rows are switched off, in a line: "5 more are switched off", "All 6 are switched off". */
export function offWords(off: number, on: number): string | undefined {
  if (off === 0) return undefined
  if (on === 0) return off === 1 ? 'Its one automation is switched off' : `All ${off} are switched off`
  return off === 1 ? '1 more is switched off' : `${off} more are switched off`
}

export function SchedulerCard({ projects }: ModuleCardProps) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  // One read with the Automations page and Settings under the same key, kept for the next visit.
  const { value: rows, state, reload } = usePolled(() => readSchedulers(host, projects), EMPTY, 10_000, [key], { remember: schedulersKey(key), stored: true })
  const open = (): void => host.openPage('automations')
  /** A link to the Automations page, which also opens in a new tab. */
  const toPage = (words: string) => (
    <a
      href={host.pageHref('automations')}
      onClick={inPlace(open)}
      className="underline hover:text-foreground"
    >
      {words}
    </a>
  )
  return (
    <Section title="Automations" action={<PageLink href={host.pageHref('automations')} onOpen={open}>Automations</PageLink>}>
      <p className="-mt-1 mb-3 text-xs text-muted-foreground">What starts by itself while nobody is at the keyboard</p>
      <Slot of={{ state, value: rows }} shape={<RowShapes />}>
        {() => (
          <ul className="space-y-4">
            {rows.map(row => {
              const status = schedulerStatus(row)
              const stopped = schedulerStopped(row)
              const on = row.commands.filter(command => command.on)
              const off = offWords(row.commands.length - on.length, on.length)
              return (
                <li key={row.project.id} aria-label={row.project.name}>
                  <div className="flex items-center gap-2">
                    {projects.length > 1 && <span className="truncate text-sm font-medium">{row.project.name}</span>}
                    <span className={cn('shrink-0 text-xs font-medium', status.tone)}>Scheduler {status.label}</span>
                    {row.keepAlive && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">keep-alive</span>}
                    {row.lastTick && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        looked{' '}
                        <Tooltip>
                          <TooltipTrigger render={<span className="tabular-nums" />}>{formatAge(row.lastTick.at)}</TooltipTrigger>
                          <TooltipContent>The scheduler last looked {formatDateTime(row.lastTick.at)}</TooltipContent>
                        </Tooltip>
                      </span>
                    )}
                  </div>
                  {row.error !== undefined && <p className="mt-1 text-xs text-muted-foreground">{row.error}</p>}
                  {/* Why the last look decided nothing; a scheduler that is stopped says that itself, above. */}
                  {row.lastTick?.note && stopped === undefined && <p className="mt-1 text-xs text-muted-foreground">Its last look: {row.lastTick.note}</p>}
                  {stopped !== undefined && row.error === undefined && on.length > 0 && <p className="mt-1 text-xs text-warning">Nothing starts by itself. {toPage('How to start it')}</p>}
                  {row.error === undefined && row.commands.length === 0 && row.unreadable.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Nothing is scheduled here. {toPage('New automation')}</p>}
                  {on.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {on.map(command => (
                        <OnRow key={command.command} project={row.project} command={command} stopped={stopped !== undefined} lookedAt={row.lastTick?.at} onOpenRun={run => host.openAgent(row.project.id, run)} reload={reload} />
                      ))}
                    </ul>
                  )}
                  {row.unreadable.map(unreadable => (
                    <p key={unreadable.skill} className="mt-1.5 text-xs text-warning">
                      {unlistedWords(unreadable)}
                    </p>
                  ))}
                  {off !== undefined && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {off}. {on.length === 0 && toPage('Switch one on')}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Slot>
    </Section>
  )
}

/**
 * One row that is switched on: a dot, its name, and when it starts next; the run its last look
 * started opens from it. Under the pointer, "Run now" starts one at once, and what it answered
 * stays on the row: the run it started, or why none did.
 */
function OnRow({ project, command, stopped, lookedAt, onOpenRun, reload }: { project: ModuleProject; command: SchedulerCommand; stopped: boolean; /** When the scheduler last looked: the start its look made was then. */ lookedAt: string | undefined; onOpenRun: (run: string) => void; reload: () => Promise<void> }) {
  const host = useModuleHost()
  const down = useOpenAgentDown()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<Answered>()
  const started = said?.started || command.decision?.run
  const runNow = async (): Promise<void> => {
    setBusy(true)
    setSaid(undefined)
    const answer = await host.runCommand(project.id, ['now', command.command]).catch(notAsked)
    await reload().catch(() => {})
    setBusy(false)
    setSaid(startedNow(answer))
  }
  return (
    // One line, whatever the card's width: the name whole, when it starts next cut short (and said
    // whole on hover), never a second line that leaves the rows at uneven gaps.
    <li className="group/row relative -mx-3 flex items-center gap-3 rounded-md px-3 text-sm transition-colors hover:bg-accent md:h-10 max-md:h-11">
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', stopped ? 'bg-muted-foreground/50' : 'bg-success')} />
      <span className="shrink-0 font-mono text-xs font-medium">{rowTitle(command)}</span>
      {/* While the scheduler is stopped a row has no next start: the line above says why. */}
      {!stopped && (
        <span title={startsNext(command)} className="min-w-0 truncate text-xs text-muted-foreground">
          {startsNext(command)}
        </span>
      )}
      {started !== undefined && started !== '' && (
        <button type="button" onClick={() => onOpenRun(started)} className="min-w-0 truncate text-xs text-info hover:underline">
          {said?.started ? 'Started: open it' : `Started an agent${lookedAt !== undefined ? ` ${formatAge(lookedAt)}` : ''}: open it`}
        </button>
      )}
      {said?.note && (
        <span title={said.note} className="min-w-0 truncate text-xs text-muted-foreground">
          <CodeWords text={said.note} />
        </span>
      )}
      {said?.failed && (
        <span title={said.failed} className="min-w-0 truncate text-xs text-danger">
          <CodeWords text={said.failed} />
        </span>
      )}
      {/* Under the pointer, or with the keyboard on it; a touch screen has no hover, and there it always shows. */}
      {cannotRun(command) === undefined && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || down}
          onClick={() => void runNow()}
          aria-label={`Run ${rowTitle(command)} now`}
          className="bg-[inherit] transition-opacity md:absolute md:inset-y-0 md:right-1 md:my-auto pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:focus-visible:opacity-100 pointer-fine:disabled:opacity-100 max-md:ml-auto"
        >
          {busy ? 'Starting…' : 'Run now'}
        </Button>
      )}
    </li>
  )
}
