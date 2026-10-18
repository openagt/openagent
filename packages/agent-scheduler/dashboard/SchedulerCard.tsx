import { CalendarClock } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitleLink, Tooltip, TooltipContent, TooltipTrigger, cn, formatAge, formatDateTime, useModuleHost, usePolled, type ModuleCardProps } from '@openagt/dashboard/module'
import { readSchedulers, rowTitle, schedulerStatus, schedulerStopped, startsNext, unlistedWords, type SchedulerCommand, type SchedulerRow } from './schedulers.js'

// The Overview's Automations card: what starts by itself in every project that has this package,
// read with `agent-scheduler status` every 10 seconds. It is called what its page is called, and
// its title opens that page. Per project: the rows that are switched on, each with when it starts
// next, in the words its Edit panel uses ("Next start in 3h, if there is work"); then one line for
// the rows that are switched off, however many they are. A row whose last look started a run opens
// that agent. A project whose scheduler is not running says so first: nothing starts there.
//
// No buttons. A row is switched on its own page; the scheduler is started and stopped by the
// project's own hooks when the dashboard opens and closes, and by hand from the command line.

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
  const { value: rows, loaded } = usePolled(() => readSchedulers(host, projects), EMPTY, 10_000, [key])
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
                    <ul className="mt-2 space-y-1.5">
                      {on.map(command => (
                        <OnRow key={command.command} command={command} stopped={stopped !== undefined} lookedAt={row.lastTick?.at} onOpenRun={run => host.openAgent(row.project.id, run)} />
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

/** One row that is switched on: its name, and when it starts next; the run its last look started opens from it. */
function OnRow({ command, stopped, lookedAt, onOpenRun }: { command: SchedulerCommand; stopped: boolean; /** When the scheduler last looked: the start its look made was then. */ lookedAt: string | undefined; onOpenRun: (run: string) => void }) {
  const started = command.decision?.run
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm">
      <span className="min-w-0 truncate font-mono text-[13px]">{rowTitle(command)}</span>
      {/* While the scheduler is stopped a row has no next start: the line above says why. */}
      {!stopped && <span className="text-xs text-muted-foreground">{startsNext(command)}</span>}
      {started !== undefined && (
        <button type="button" onClick={() => onOpenRun(started)} className="text-xs text-info hover:underline">
          Started an agent{lookedAt !== undefined ? ` ${formatAge(lookedAt)}` : ''}: open it
        </button>
      )}
    </li>
  )
}
