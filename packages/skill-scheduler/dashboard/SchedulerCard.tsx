import { useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { Button, Card, CardContent, CardHeader, CardTitleLink, Tooltip, TooltipContent, TooltipTrigger, cn, formatAge, formatDateTime, useModuleHost, usePolled, type ModuleCardProps, type ModuleProject } from '@openagt/dashboard/module'
import { cannotRun, readSchedulers, schedulersKey, rowTitle, schedulerStatus, schedulerStopped, startedNow, startsNext, unlistedWords, type Answered, type SchedulerCommand, type SchedulerRow } from './schedulers.js'

// The Overview's Automations card: what starts by itself in every project that has this package,
// read with `scheduler status` every 10 seconds. It is called what its page is called, and
// its title opens that page. Per project: the rows that are switched on, each with when it starts
// next, in the words its Edit panel uses ("Next start in 3h, if there is work"); then one line for
// the rows that are switched off, however many they are. A row whose last look started a run opens
// that agent. A project whose scheduler is not running says so first: nothing starts there.
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
  const { value: rows, loaded, reload } = usePolled(() => readSchedulers(host, projects), EMPTY, 10_000, [key], { remember: schedulersKey(key), stored: true })
  const open = (): void => host.openPage('automations')
  return (
    <Card>
      <CardHeader>
        <CardTitleLink icon={<CalendarClock className="h-4 w-4 text-muted-foreground" aria-hidden />} segment="automations" onOpen={open}>
          Automations
        </CardTitleLink>
        <p className="text-xs text-muted-foreground">What starts by itself while nobody is at the keyboard</p>
      </CardHeader>
      <CardContent>
        {!loaded ? (
          <p className="py-2 text-sm text-muted-foreground">Loading…</p>
        ) : (
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
                  {stopped !== undefined && row.error === undefined && on.length > 0 && <p className="mt-1 text-xs text-warning">{stopped}: nothing starts by itself.</p>}
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
                      {off}.{' '}
                      {on.length === 0 && (
                        <a
                          href={host.pageHref('automations')}
                          onClick={event => {
                            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                            event.preventDefault()
                            open()
                          }}
                          className="underline hover:text-foreground"
                        >
                          Switch one on
                        </a>
                      )}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * One row that is switched on: a dot, its name, and when it starts next; the run its last look
 * started opens from it. Under the pointer, "Run now" starts one at once, and what it answered
 * stays on the row: the run it started, or why none did.
 */
function OnRow({ project, command, stopped, lookedAt, onOpenRun, reload }: { project: ModuleProject; command: SchedulerCommand; stopped: boolean; /** When the scheduler last looked: the start its look made was then. */ lookedAt: string | undefined; onOpenRun: (run: string) => void; reload: () => Promise<void> }) {
  const host = useModuleHost()
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState<Answered>()
  const started = said?.started || command.decision?.run
  const runNow = async (): Promise<void> => {
    setBusy(true)
    setSaid(undefined)
    const answer = await host.runCommand(project.id, ['now', command.command]).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }))
    await reload().catch(() => {})
    setBusy(false)
    setSaid(startedNow(answer))
  }
  return (
    // One line, whatever the card's width: the name whole, when it starts next cut short (and said
    // whole on hover), never a second line that leaves the rows at uneven gaps.
    <li className="group/row relative -mx-2 flex h-8 items-center gap-3 rounded-md px-2 text-sm hover:bg-accent/60">
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-success" />
      <span className="shrink-0 font-mono text-[13px]">{rowTitle(command)}</span>
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
      {said?.note && <span title={said.note} className="min-w-0 truncate text-xs text-muted-foreground">{said.note}</span>}
      {said?.failed && <span title={said.failed} className="min-w-0 truncate text-xs text-danger">{said.failed}</span>}
      {/* Under the pointer, or with the keyboard on it; a phone has no hover, and there it always shows. */}
      {cannotRun(command) === undefined && (
        <Button
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => void runNow()}
          aria-label={`Run ${rowTitle(command)} now`}
          className="absolute inset-y-0 right-1 my-auto bg-[inherit] opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 disabled:opacity-100 max-md:static max-md:ml-auto max-md:opacity-100"
        >
          {busy ? 'Starting…' : 'Run now'}
        </Button>
      )}
    </li>
  )
}
