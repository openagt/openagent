import { FilterChips, List, MiddleCut, Page, PersonMark, Row, RowShapes, STATUS_DOT, Section, STATUS_RING, Slot, cn, formatDateTime, formatDuration, needsWord, personSaid, runName, useGitHostPeople, useModuleHost, usePolled, type ModuleAgent, type ModuleHostPerson, type ModulePageProps, type ModuleProject, type ReadState } from '@openagt/dashboard/module'
import type { RunCard } from '../src/run.js'

/** How many runs each project lists: the command's own default page is 20; the page shows more. */
const LIMIT = 50

/** One run, with the project it was recorded in. */
export interface RunRow {
  project: ModuleProject
  card: Omit<RunCard, 'caller' | 'status'> & {
    /** As recorded, or `unknown` while the computer it runs on does not answer. */
    status: RunCard['status'] | 'unknown'
    /** While it is unknown: which computer, and since when it was not seen. */
    offline?: string
    /** Whose run it is, by the email its record is kept under; a very old card has none. */
    person?: string
    /** Its work that never left this machine, as the dashboard lists it: files left uncommitted, commits never pushed. */
    uncommitted?: number
    unpublished?: number
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
export function withLiveRuns(rows: readonly RunRow[], live: readonly LiveRuns[]): RunRow[] {
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
function cardOf(run: ModuleAgent): Omit<RunRow['card'], 'id' | 'startedAt'> {
  return {
    status: run.status,
    ...(run.endedAt ? { endedAt: run.endedAt } : {}),
    ...(run.title ? { title: run.title } : {}),
    ...(run.person ? { person: run.person } : {}),
    ...(run.ask ? { intent: run.ask } : {}),
    ...(run.name ? { branch: run.name } : {}),
    ...(run.cost !== undefined ? { cost: run.cost } : {}),
    ...(run.driver ? { driver: run.driver } : {}),
    ...(run.model ? { model: run.model } : {}),
    ...(run.uncommitted ? { uncommitted: run.uncommitted } : {}),
    ...(run.unpublished ? { unpublished: run.unpublished } : {}),
    ...(run.status === 'unknown' ? { offline: `${run.machine ?? 'Its computer'} offline${run.seenAt ? ` · last seen ${formatDateTime(run.seenAt)}` : ''}` } : {}),
  }
}

/** What one read of every project gave: the runs, and the projects whose command failed, with why. */
interface Read {
  rows: RunRow[]
  failed: { project: ModuleProject; error: string }[]
}

const NOTHING_READ: Read = { rows: [], failed: [] }

/** The statuses a chip picks, in this order: what is going, then how runs ended, then the runs whose computer does not answer. */
const STATUSES = ['running', 'waiting', 'done', 'stopped', 'failed', 'unknown']

/** A status as the page says it, on a chip and beside a run's dot alike, and as the rest of the dashboard says it: a live run is "Working"; "Status unknown". */
function statusWord(status: string): string {
  const word = status === 'unknown' ? 'status unknown' : status === 'running' ? 'working' : status
  return word[0]!.toUpperCase() + word.slice(1)
}

/** A run's status as a dot in the dashboard's colors: filled while something is going on, a ring once nothing is. */
function StatusDot({ status }: { status: string }) {
  return (
    <span className="flex size-4 items-center justify-center">
      <span aria-hidden className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[status] ?? cn('border', STATUS_RING[status] ?? STATUS_RING['done']))} />
    </span>
  )
}

/** A run's status in words; one whose computer does not answer says which, pointed at. */
function StatusWord({ status, offline }: { status: string; offline?: string | undefined }) {
  return <span {...(offline ? { title: offline } : {})}>{statusWord(status)}</span>
}

/** What a run's work still needs before it leaves this machine, as its row in the sidebar says it: "Needs commit · 2 files", "Needs push · 1 commit". */
export function leftWords(card: Pick<RunRow['card'], 'uncommitted' | 'unpublished'>, gitHost: boolean): string | undefined {
  if (card.uncommitted) return `${needsWord('uncommitted')} · ${card.uncommitted} file${card.uncommitted === 1 ? '' : 's'}`
  if (card.unpublished) return `${needsWord('unpushed', gitHost)} · ${card.unpublished} commit${card.unpublished === 1 ? '' : 's'}`
  return undefined
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
export function byDay(rows: RunRow[], now: Date = new Date()): { day: string; rows: RunRow[]; cost: number }[] {
  const days: { day: string; rows: RunRow[]; cost: number }[] = []
  for (const row of rows) {
    const day = dayOf(row.card.startedAt, now)
    const last = days[days.length - 1]
    if (last?.day === day) last.rows.push(row)
    else days.push({ day, rows: [row], cost: 0 })
    days[days.length - 1]!.cost += row.card.cost ?? 0
  }
  return days
}

/** The statuses of a run that is over: a waiting run's end is only its last turn's. */
const ENDED = ['done', 'stopped', 'failed']

/** How long a run took, from its start to its end; nothing for one not over. */
function took(card: RunRow['card']): string | undefined {
  return card.endedAt && ENDED.includes(card.status) ? formatDuration(Date.parse(card.endedAt) - Date.parse(card.startedAt)) : undefined
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
 * project, each as the dashboard says it stands right now ({@link withLiveRuns}). A chip shows one
 * status, at `/logs/<status>`. A row opens the run's own page in the dashboard. A project whose
 * command fails is named with the command's own reason, and the other projects still show.
 */
export function LogsPage({ projects, path }: ModulePageProps) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  const { value: live, state: liveState } = usePolled<LiveRuns[]>(
    () => Promise.all(projects.map(async project => ({ project, runs: await host.agents(project.id).catch((): ModuleAgent[] => []) }))),
    [],
    10_000,
    [key],
    { remember: `skill-logs:live:${key}`, stored: true },
  )
  const { value: recorded, state: recordedState, failing } = usePolled<Read>(
    async () => {
      const results = await Promise.all(projects.map(async project => ({ project, result: await host.runCommand(project.id, ['--limit', String(LIMIT)]) })))
      const rows: RunRow[] = []
      const failed: Read['failed'] = []
      for (const { project, result } of results) {
        if (!result.ok) failed.push({ project, error: result.error })
        else if (Array.isArray(result.output)) for (const card of result.output as RunRow['card'][]) rows.push({ project, card })
        else failed.push({ project, error: 'the logs command did not print a list' })
      }
      rows.sort((a, b) => b.card.startedAt.localeCompare(a.card.startedAt))
      return { rows, failed }
    },
    NOTHING_READ,
    // Each read fetches origin's copy of the records branch, and a run lands only when it ends.
    60_000,
    [key],
    // Kept for the next visit: the page opens with the last list, faded until it is read again.
    { remember: `skill-logs:runs:${key}`, stored: true },
  )
  const read = { ...recorded, rows: withLiveRuns(recorded.rows, live) }
  // The runs the dashboard lists show while the records are read; with none of those, the list waits for the records.
  const state: ReadState = recordedState === 'unknown' ? (read.rows.length > 0 ? liveState : 'unknown') : liveState === 'kept' ? 'kept' : recordedState
  const accountOf = useGitHostPeople(read.rows.map(({ project, card }) => ({ projectId: project.id, person: card.person })), host.gitHostPeople, 'skill-logs:people')

  // Which status the list shows: every one, until a chip picks one, kept in the address (`/logs/waiting`) so a
  // reload or Back from a run shows the list the person left. One no run has any more goes back to all.
  const picked = path[0] ?? null
  const counts = STATUSES.map(value => ({ value, label: statusWord(value), count: read.rows.filter(row => row.card.status === value).length })).filter(c => c.count > 0)
  const status = counts.some(c => c.value === picked) ? picked : null
  const shown = status === null ? read.rows : read.rows.filter(row => row.card.status === status)
  const days = byDay(shown)
  const many = projects.length > 1
  // The one project shown, by its name: with every project picked, the page may still have only one.
  const only = projects[0]?.name ?? 'this project'
  // Over every run, not the ones the chip shows, so picking a status moves no column.
  const columns = {
    who: new Set(read.rows.map(row => row.card.person).filter(Boolean)).size > 1,
    took: read.rows.some(row => took(row.card) !== undefined),
    cost: read.rows.some(row => row.card.cost !== undefined),
    left: read.rows.some(row => leftWords(row.card, row.project.gitHost) !== undefined),
  }
  // A project that gave a whole page may have older runs the page does not list.
  const capped = projects.some(project => recorded.rows.filter(row => row.project.id === project.id).length >= LIMIT)

  return (
    <Page
      title="Logs"
      description={capped ? `The last ${LIMIT} runs recorded in ${many ? 'each of these projects' : only}, newest first.` : `Every run recorded in ${many ? 'these projects' : only}, newest first.`}
      bar={state === 'unknown' ? undefined : <FilterChips chips={counts} total={read.rows.length} picked={status} onPick={value => host.adjustPage(value === null ? [] : [value])} />}
    >
      <Slot of={{ state, value: read, failing }} shape={<RowShapes rows={3} />} className="@container space-y-6">
        {() => (
          <>
            {read.failed.map(({ project, error }) => (
              <p key={project.id} role="alert" className="text-sm text-danger">
                Could not read the runs of {project.name}: {error}
              </p>
            ))}
            {read.rows.length === 0 && read.failed.length === 0 && <p className="text-sm text-muted-foreground">No runs recorded yet.</p>}
            {/* Each run is a row: its name, then what is said of it in columns that stand in one place down the
                page and whatever the chip picks; a column no run has a value for is not drawn. Columns give way
                to the name as the page's column narrows, and on a phone they go under it. */}
            {days.map(({ day, rows, cost }) => (
              <Section key={day} title={day} count={runsSaid(rows.length, cost)}>
                <List>
                  {rows.map(({ project, card }) => (
                    <Row
                      key={`${project.id}/${card.id}`}
                      stackOnPhone
                      // As every list names a run, over what it was asked; a run with none of those goes by its id.
                      title={runName(card) ?? card.id}
                      detail={card.title?.trim() && card.intent?.trim() ? card.intent : undefined}
                      href={host.agentHref(project.id, card.id)}
                      onClick={() => host.openAgent(project.id, card.id)}
                      meta={
                        <>
                          {/* Its state said once: the dot beside its word. */}
                          <span className="flex items-center gap-1 md:w-28">
                            <StatusDot status={card.status} />
                            <StatusWord status={card.status} offline={card.offline} />
                          </span>
                          {columns.who && <RunPerson person={card.person} account={accountOf(project.id, card.person)} />}
                          {many && <span className="truncate md:w-24">{project.name}</span>}
                          {card.pr ? (
                            <a href={card.pr.url} target="_blank" rel="noreferrer" className="relative text-primary hover:underline md:w-40 @max-3xl:md:w-auto">
                              #{card.pr.number}
                            </a>
                          ) : (
                            // Cut in its middle: runs started the same minute differ only at their branch's end.
                            <span className="flex min-w-0 font-mono max-md:hidden md:w-40 @max-3xl:hidden" title={card.branch}>
                              {card.branch && <MiddleCut text={card.branch} />}
                            </span>
                          )}
                          {/* What its work still needs before it leaves this machine, in the sidebar's words. */}
                          {columns.left && <span className="truncate md:w-40">{leftWords(card, project.gitHost)}</span>}
                          {columns.took && <span className="text-right tabular-nums md:w-12 @max-2xl:hidden">{took(card) !== undefined && <><span className="sr-only">took </span>{took(card)}</>}</span>}
                          {columns.cost && <span className="text-right tabular-nums md:w-14">{card.cost !== undefined && dollars(card.cost)}</span>}
                          <span className="whitespace-nowrap text-right tabular-nums md:w-16" title={formatDateTime(card.startedAt)}>
                            {clock(card.startedAt)}
                          </span>
                        </>
                      }
                    />
                  ))}
                </List>
              </Section>
            ))}
          </>
        )}
      </Slot>
    </Page>
  )
}

/** Whose run it is. A very old card names nobody: no mark, and the columns after it stay in line with the others. */
function RunPerson({ person, account }: { person: string | undefined; account: ModuleHostPerson | undefined }) {
  if (!person) return <span aria-hidden className="size-6 shrink-0" />
  return <PersonMark email={person} picture={account?.avatar} said={personSaid(person, account)} className="size-6" />
}

/** How many runs a day had and what they cost together. */
function runsSaid(runs: number, cost: number): string {
  return `${runs === 1 ? '1 run' : `${runs} runs`}${cost > 0 ? ` · ${dollars(cost)}` : ''}`
}
