import { useState } from 'react'
import { FilterChips, Page, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, cn, formatDateTime, formatDuration, useModuleHost, usePolled, type ModuleAgent, type ModulePageProps, type ModuleProject } from '@openagt/dashboard/module'
import type { RunCard } from '../src/run.js'

/** How many runs each project lists: the command's own default page is 20; the page shows more. */
const LIMIT = 50

/** One run, with the project it was recorded in. */
export interface Row {
  project: ModuleProject
  card: Omit<RunCard, 'caller' | 'status'> & {
    /** As recorded, or `unknown` while the computer it runs on does not answer. */
    status: RunCard['status'] | 'unknown'
    /** While it is unknown: which computer, and since when it was not seen. */
    offline?: string
  }
}

/** A project's runs as the dashboard lists them right now. */
export interface LiveRuns {
  project: ModuleProject
  runs: ModuleAgent[]
}

/**
 * The recorded runs with how the dashboard says they stand right now: a run's record stops at
 * what its computer shared last, and the dashboard asks the computers themselves. So a run the
 * dashboard lists is shown as it lists it, and one it lists that has no record here yet is shown
 * too, as far back as the project's own rows go.
 */
export function withLiveRuns(rows: readonly Row[], live: readonly LiveRuns[]): Row[] {
  const byId = new Map(live.flatMap(({ project, runs }) => runs.map(run => [`${project.id}/${run.id}`, run] as const)))
  const shown = rows.map(row => {
    const run = byId.get(`${row.project.id}/${row.card.id}`)
    return run ? { ...row, card: { ...row.card, ...cardOf(run) } } : row
  })
  const recorded = new Set(rows.map(row => `${row.project.id}/${row.card.id}`))
  for (const { project, runs } of live) {
    const own = rows.filter(row => row.project.id === project.id)
    // Only as far back as the project's own page: past it, its records are not read either.
    const from = own.length >= LIMIT ? own.reduce((oldest, row) => (row.card.startedAt < oldest ? row.card.startedAt : oldest), own[0]!.card.startedAt) : ''
    for (const run of runs) if (!recorded.has(`${project.id}/${run.id}`) && run.startedAt >= from) shown.push({ project, card: { id: run.id, startedAt: run.startedAt, ...cardOf(run) } })
  }
  return shown.sort((a, b) => b.card.startedAt.localeCompare(a.card.startedAt))
}

/** What a row takes from the dashboard's word on a run. */
function cardOf(run: ModuleAgent): Omit<Row['card'], 'id' | 'startedAt'> {
  return {
    status: run.status,
    ...(run.endedAt ? { endedAt: run.endedAt } : {}),
    ...(run.title ? { title: run.title } : {}),
    ...(run.ask ? { intent: run.ask } : {}),
    ...(run.name ? { branch: run.name } : {}),
    ...(run.cost !== undefined ? { cost: run.cost } : {}),
    ...(run.driver ? { driver: run.driver } : {}),
    ...(run.model ? { model: run.model } : {}),
    ...(run.status === 'unknown' ? { offline: `${run.machine ?? 'Its computer'} offline${run.seenAt ? ` · last seen ${formatDateTime(run.seenAt)}` : ''}` } : {}),
  }
}

/** What one read of every project gave: the runs, and the projects whose command failed, with why. */
interface Read {
  rows: Row[]
  failed: { project: ModuleProject; error: string }[]
}

const NOTHING_READ: Read = { rows: [], failed: [] }

/** Each status's tone: its word, and the dot before it. */
const STATUS_TONE: Record<string, { text: string; dot: string }> = {
  running: { text: 'text-primary', dot: 'bg-primary' },
  done: { text: 'text-success', dot: 'bg-success' },
  waiting: { text: 'text-info', dot: 'bg-info' },
  stopped: { text: 'text-warning', dot: 'bg-warning' },
  failed: { text: 'text-danger', dot: 'bg-danger' },
}

/** The statuses a chip picks, in this order: what is going, then how runs ended, then the runs whose computer does not answer. */
const STATUSES = ['running', 'waiting', 'done', 'stopped', 'failed', 'unknown']

/** A run's status as a dot and its word; one whose computer does not answer says which, pointed at. */
function Status({ status, offline }: { status: string; offline?: string | undefined }) {
  const tone = STATUS_TONE[status]
  return (
    <span className={cn('inline-flex items-center gap-1.5', tone?.text ?? 'text-muted-foreground')} {...(offline ? { title: offline } : {})}>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', tone?.dot ?? 'bg-muted-foreground')} />
      {status === 'unknown' ? 'status unknown' : status}
    </span>
  )
}

/** The day a run started, as a heading says it: "Today", "Yesterday", else the weekday and the date. */
export function dayOf(iso: string, now: Date = new Date()): string {
  const day = new Date(iso)
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((start(now) - start(day)) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', ...(day.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

/** The runs in order, cut into their days, each day with what its runs cost together. */
export function byDay(rows: Row[], now: Date = new Date()): { day: string; rows: Row[]; cost: number }[] {
  const days: { day: string; rows: Row[]; cost: number }[] = []
  for (const row of rows) {
    const day = dayOf(row.card.startedAt, now)
    const last = days[days.length - 1]
    if (last?.day === day) last.rows.push(row)
    else days.push({ day, rows: [row], cost: 0 })
    days[days.length - 1]!.cost += row.card.cost ?? 0
  }
  return days
}

/** How long a run took, from its start to its end; nothing for one still going. */
function took(card: Row['card']): string {
  return card.endedAt ? formatDuration(Date.parse(card.endedAt) - Date.parse(card.startedAt)) : '—'
}

/** The time of day a run started, its day being the heading's. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** What cost a sum of runs: "$1.23", nothing for none. */
function dollars(cost: number): string {
  return `$${cost.toFixed(2)}`
}

/**
 * The Logs page: every project's recorded runs, newest first, from `logs --limit 50` in each
 * project, each as the dashboard says it stands right now ({@link withLiveRuns}). A row opens the
 * run's own page in the dashboard. A project whose command fails is named with the command's own
 * reason, and the other projects still show.
 */
export function LogsPage({ projects }: ModulePageProps) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  const { value: live } = usePolled<LiveRuns[]>(
    () => Promise.all(projects.map(async project => ({ project, runs: await host.agents(project.id).catch((): ModuleAgent[] => []) }))),
    [],
    10_000,
    [key],
  )
  const { value: recorded, loaded } = usePolled<Read>(
    async () => {
      const results = await Promise.all(projects.map(async project => ({ project, result: await host.runCommand(project.id, ['--limit', String(LIMIT)]) })))
      const rows: Row[] = []
      const failed: Read['failed'] = []
      for (const { project, result } of results) {
        if (!result.ok) failed.push({ project, error: result.error })
        else if (Array.isArray(result.output)) for (const card of result.output as Row['card'][]) rows.push({ project, card })
        else failed.push({ project, error: 'the logs command did not print a list' })
      }
      rows.sort((a, b) => b.card.startedAt.localeCompare(a.card.startedAt))
      return { rows, failed }
    },
    NOTHING_READ,
    // Each read fetches origin's copy of the records branch, and a run lands only when it ends.
    60_000,
    [key],
  )
  const read = { ...recorded, rows: withLiveRuns(recorded.rows, live) }

  // Which status the list shows: every one, until a chip picks one. One no run has any more goes back to all.
  const [picked, setPicked] = useState<string | null>(null)
  const counts = STATUSES.map(value => ({ value, label: value[0]!.toUpperCase() + value.slice(1), count: read.rows.filter(row => row.card.status === value).length })).filter(c => c.count > 0)
  const status = counts.some(c => c.value === picked) ? picked : null
  const shown = status === null ? read.rows : read.rows.filter(row => row.card.status === status)
  const days = byDay(shown)
  const many = projects.length > 1

  return (
    <Page
      title="Logs"
      description={`Every run recorded in ${projects.length === 1 ? 'this project' : 'these projects'}, newest first.`}
      bar={<FilterChips chips={counts} total={read.rows.length} picked={status} onPick={setPicked} />}
    >
      {read.failed.map(({ project, error }) => (
        <p key={project.id} role="alert" className="mb-3 text-sm text-danger">
          Could not read the runs of {project.name}: {error}
        </p>
      ))}
      {!loaded && <p className="text-sm text-muted-foreground">Loading…</p>}
      {loaded && read.rows.length === 0 && read.failed.length === 0 && <p className="text-sm text-muted-foreground">No runs recorded yet.</p>}
      {days.length > 0 && (
        // One table for every day, so the columns stand in one place down the page; each day opens
        // with a row of its own: the day, how many runs it had and what they cost together.
        <div className="max-md:hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Status</TableHead>
                <TableHead>Run</TableHead>
                {many && <TableHead>Project</TableHead>}
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Took</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="w-20 text-right">Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {days.map(({ day, rows, cost }) => [
                <TableRow key={day} className="hover:bg-transparent">
                  <TableCell colSpan={many ? 7 : 6} className="pt-5 pb-1.5">
                    <DayHeading day={day} runs={rows.length} cost={cost} />
                  </TableCell>
                </TableRow>,
                ...rows.map(({ project, card }) => (
                  <TableRow key={`${project.id}/${card.id}`} onClick={() => host.openAgent(project.id, card.id)} className="cursor-pointer">
                    <TableCell>
                      <Status status={card.status} offline={card.offline} />
                    </TableCell>
                    {/* The run's short name, and what it was asked under it; a run with no name yet is its ask. */}
                    <TableCell className="max-w-md">
                      <p className="truncate font-medium" title={card.title ?? card.intent}>
                        {card.title?.trim() || card.intent?.trim() || card.id}
                      </p>
                      {card.title?.trim() && card.intent?.trim() && (
                        <p className="truncate text-xs text-muted-foreground" title={card.intent}>
                          {card.intent}
                        </p>
                      )}
                    </TableCell>
                    {many && <TableCell className="text-muted-foreground">{project.name}</TableCell>}
                    <TableCell className="max-w-56">
                      {card.pr ? (
                        <a href={card.pr.url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} className="text-info hover:underline">
                          #{card.pr.number}
                        </a>
                      ) : (
                        <span className="block truncate font-mono text-xs text-muted-foreground" title={card.branch}>
                          {card.branch ?? '—'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">{took(card)}</TableCell>
                    <TableCell className="text-right tabular-nums">{card.cost !== undefined ? dollars(card.cost) : '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-muted-foreground tabular-nums" title={formatDateTime(card.startedAt)}>
                      {clock(card.startedAt)}
                    </TableCell>
                  </TableRow>
                )),
              ])}
            </TableBody>
          </Table>
        </div>
      )}
      {/* A phone has no width for the table's columns: there a run is two lines, its name and then
          the rest, and its branch is left to its own page. */}
      <div className="space-y-5 md:hidden">
        {days.map(({ day, rows, cost }) => (
          <section key={day} aria-label={day}>
            <DayHeading day={day} runs={rows.length} cost={cost} />
            <ul className="mt-1 text-sm">
              {rows.map(({ project, card }) => (
                <li key={`${project.id}/${card.id}`} onClick={() => host.openAgent(project.id, card.id)} className="cursor-pointer border-b border-border py-2 hover:bg-accent">
                  <p className="truncate font-medium" title={card.intent}>
                    {card.title?.trim() || card.intent?.trim() || card.id}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <Status status={card.status} offline={card.offline} />
                    {many && <span>{project.name}</span>}
                    {card.pr && (
                      <a href={card.pr.url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} className="text-info hover:underline">
                        #{card.pr.number}
                      </a>
                    )}
                    {card.cost !== undefined && <span className="tabular-nums">{dollars(card.cost)}</span>}
                    <span className="tabular-nums">{clock(card.startedAt)}</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Page>
  )
}

/** A day's heading: the day, how many runs it had and what they cost together. */
function DayHeading({ day, runs, cost }: { day: string; runs: number; cost: number }) {
  return (
    <h2 className="flex items-baseline gap-2 text-sm font-semibold text-foreground">
      {day}
      <span className="text-xs font-normal text-muted-foreground tabular-nums">
        {runs === 1 ? '1 run' : `${runs} runs`}
        {cost > 0 && ` · ${dollars(cost)}`}
      </span>
    </h2>
  )
}
