import { useState } from 'react'
import { Button, Empty, FilterChips, MiddleCut, Page, PanelGroup, PanelGroups, PanelRow, PersonMark, RowShapes, RunMark, Slot, formatDateTime, formatDuration, needsWord, personSaid, runName, runLineTone, useCodingAgents, useGitHostPeople, useIsMobile, runsAgain, runWord, useModuleHost, usePolled, type CodingAgent, type ModuleAgent, type ModuleHostPerson, type ModulePageProps, type ModuleProject, type ReadState } from '@openagt/dashboard/module'
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
    /** Its pull request merged, as the git host last said, read where the sidebar reads it: the run reads as merged there and here. */
    merged?: boolean
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
    ...(run.pr ? { pr: { number: run.pr.number, url: run.pr.url }, ...(run.pr.state === 'merged' ? { merged: true } : {}) } : {}),
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

/** A status as its chip says it: the word every place says, and a computer that does not answer in one. */
const chipWord = (value: string): string => (value === 'unknown' ? 'unknown' : runWord(value))

/** What a run's work still needs before it leaves this machine, in the sidebar's words, as two facts of its line: "Needs commit", "2 files". */
export function leftParts(card: Pick<RunRow['card'], 'uncommitted' | 'unpublished'>, gitHost: boolean): string[] {
  if (card.uncommitted) return [needsWord('uncommitted'), `${card.uncommitted} file${card.uncommitted === 1 ? '' : 's'}`]
  if (card.unpublished) return [needsWord('unpushed', gitHost), `${card.unpublished} commit${card.unpublished === 1 ? '' : 's'}`]
  return []
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

/** Whether the run's question waits on the person. */
const asks = (card: RunRow['card']): boolean => card.status === 'waiting'

/** A run's press: Answer where its question waits, else Review. */
const pressOf = (card: RunRow['card']): string => (asks(card) ? 'Answer' : 'Review')

/** How a run is drawn and said: as its status, but a done run whose pull request merged as merged, the sidebar's word for it. */
function shownStatus(card: RunRow['card']): string {
  return card.status === 'done' && card.merged ? 'merged' : card.status
}

/** How a run stands, as its row's line opens: its state's word, with how long it took once it is over ("Done in 11m"). */
function standing(card: RunRow['card']): string {
  const word = runWord(shownStatus(card))
  const said = word[0]!.toUpperCase() + word.slice(1)
  const length = took(card)
  if (length === undefined || card.merged) return said
  return card.status === 'done' ? `${said} in ${length}` : `${said} after ${length}`
}

/** The coding agent that ran it and its model, by the names the agent gives them ("Claude Code · Opus 5.5"). */
function agentSaid(card: RunRow['card'], agents: CodingAgent[]): string | undefined {
  const agent = agents.find(option => option.value === card.driver)
  const model = card.model && (agent?.models.find(option => option.value === card.model)?.label ?? card.model)
  return [agent?.label ?? card.driver, model].filter(Boolean).join(' · ') || undefined
}

/** The query's name for the status the list shows. */
const STATUS_PARAM = 'status'

/** What cost a sum of runs: "$1.23", nothing for none. */
function dollars(cost: number): string {
  return `$${cost.toFixed(2)}`
}

/**
 * The Logs page: every project's recorded runs, newest first, from `logs --limit 50` in each
 * project, each as the dashboard says it stands right now ({@link withLiveRuns}). A chip shows one
 * status, kept in the query (`/logs?status=waiting`). A row opens the run's own page in the
 * dashboard. A project whose command fails is named with the command's own reason, and the other
 * projects still show.
 */
export function LogsPage({ projects }: ModulePageProps) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  const { value: live, state: liveState } = usePolled<LiveRuns[]>(
    () => Promise.all(projects.map(async project => ({ project, runs: await host.agents(project.id).catch((): ModuleAgent[] => []) }))),
    [],
    10_000,
    [key],
    { remember: `skill-logs:live:${key}`, stored: true },
    runsAgain(undefined),
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

  // Which status the list shows: every one, until a chip picks one, kept in the query (`?status=waiting`) as a list's view
  // is, not in the path, which names a page below this one: a reload or Back from a run shows the list the person left.
  // One no run has any more goes back to all.
  const [picked, setPicked] = useState(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(STATUS_PARAM)))
  const pick = (value: string | null) => {
    setPicked(value)
    const query = new URLSearchParams(window.location.search)
    if (value === null) query.delete(STATUS_PARAM)
    else query.set(STATUS_PARAM, value)
    host.adjustPage(undefined, query.toString())
  }
  const counts = STATUSES.map(value => ({ value, label: chipWord(value)[0]!.toUpperCase() + chipWord(value).slice(1), count: read.rows.filter(row => row.card.status === value).length })).filter(c => c.count > 0)
  const status = counts.some(c => c.value === picked) ? picked : null
  const shown = status === null ? read.rows : read.rows.filter(row => row.card.status === status)
  const days = byDay(shown)
  const many = projects.length > 1
  // The one project shown, by its name: with every project picked, the page may still have only one.
  const only = projects[0]?.name ?? 'this project'
  // Over every run, not the ones the chip shows, so picking a status moves no column.
  const columns = {
    who: new Set(read.rows.map(row => row.card.person).filter(Boolean)).size > 1,
    agent: read.rows.some(row => row.card.driver !== undefined || row.card.model !== undefined),
    pr: read.rows.some(row => row.card.pr !== undefined),
  }
  const agents = useCodingAgents()
  const phone = useIsMobile()
  // A project that gave a whole page may have older runs the page does not list.
  const capped = projects.some(project => recorded.rows.filter(row => row.project.id === project.id).length >= LIMIT)

  return (
    <Page
      title="Logs"
      description={capped ? `The last ${LIMIT} runs recorded in ${many ? 'each of these projects' : only}, newest first.` : `Every run recorded in ${many ? 'these projects' : only}, newest first.`}
      bar={state === 'unknown' ? undefined : <FilterChips chips={counts} total={read.rows.length} picked={status} onPick={pick} />}
    >
      <Slot of={{ state, value: read, failing }} shape={<RowShapes rows={3} />} className="space-y-8">
        {() => (
          <>
            {read.failed.map(({ project, error }) => (
              <p key={project.id} role="alert" className="text-sm text-danger">
                Could not read the runs of {project.name}: {error}
              </p>
            ))}
            {read.rows.length === 0 && read.failed.length === 0 && (
              <Empty title="No runs recorded yet.">A run is listed here from the moment an agent starts on this project.</Empty>
            )}
            {/* A day is a panel of its runs. A row: its mark, its name over how it stands, then on the name's line at
                its right whose it is, the agent that ran it and its pull request, each in a column that stands in one
                place down the page (a column no run has a value for is not drawn), and when it started. On a phone the
                time alone stays. */}
            {days.length > 0 && (
              <PanelGroups className="gap-y-8">
                {days.map(({ day, rows, cost }) => (
                  <PanelGroup key={day} title={day} {...(cost > 0 ? { count: dollars(cost) } : {})}>
                    {rows.map(({ project, card }) => (
                      <PanelRow
                        key={`${project.id}/${card.id}`}
                        state={<RunMark status={shownStatus(card)} />}
                        // As every list names a run; a run with none of its names goes by its id. What it was asked, whole, under the pointer.
                        title={runName(card) ?? card.id}
                        titleHint={card.intent?.trim() || undefined}
                        href={host.agentHref(project.id, card.id)}
                        onClick={() => host.openAgent(project.id, card.id)}
                        meta={[
                          <span className={runLineTone(shownStatus(card))} {...(card.offline ? { title: card.offline } : {})}>
                            {standing(card)}
                          </span>,
                          // What its work still needs before it leaves this machine, in the sidebar's words.
                          ...leftParts(card, project.gitHost),
                          many && project.name,
                          card.cost !== undefined && dollars(card.cost),
                          // Last, as the part that gives way, and cut in its middle: runs started the same minute differ only at
                          // their branch's end. A phone, where it has no room, leaves it with its dot to a screen reader.
                          card.branch && {
                            fact: (
                              <span className="flex min-w-0 font-mono" title={card.branch}>
                                <MiddleCut text={card.branch} />
                              </span>
                            ),
                            className: 'max-md:sr-only',
                          },
                        ]}
                        columns={
                          <>
                            {columns.who && <RunPerson person={card.person} account={accountOf(project.id, card.person)} />}
                            {columns.agent && <span className="w-36 truncate max-md:sr-only">{agentSaid(card, agents)}</span>}
                            {columns.pr && (
                              <span className="w-12 text-right max-md:sr-only">
                                {card.pr && (
                                  <a href={card.pr.url} target="_blank" rel="noreferrer" title={`Pull request #${card.pr.number}`} className="focus-ring relative rounded-sm text-primary hover:underline">
                                    #{card.pr.number}
                                  </a>
                                )}
                              </span>
                            )}
                          </>
                        }
                        fact={
                          <span className="tabular-nums whitespace-nowrap" title={formatDateTime(card.startedAt)}>
                            {clock(card.startedAt)}
                          </span>
                        }
                        // The run's press, in the time's place under the pointer and the keyboard: Answer where its question waits, else Review.
                        // It opens the run, as the row does, so a phone, where the row is the press, keeps the time.
                        {...(phone
                          ? {}
                          : {
                              actions: (
                                <Button variant={asks(card) ? 'default' : 'secondary'} size="sm" className="relative" aria-label={`${pressOf(card)}: ${runName(card) ?? card.id}`} onClick={() => host.openAgent(project.id, card.id)}>
                                  {pressOf(card)}
                                </Button>
                              ),
                            })}
                      />
                    ))}
                  </PanelGroup>
                ))}
              </PanelGroups>
            )}
          </>
        )}
      </Slot>
    </Page>
  )
}

/** Whose run it is. A very old card names nobody: no mark, and the columns after it stay in line with the others. */
function RunPerson({ person, account }: { person: string | undefined; account: ModuleHostPerson | undefined }) {
  if (!person) return <span aria-hidden className="size-5 shrink-0" />
  return <PersonMark email={person} picture={account?.avatar} said={personSaid(person, account)} className="size-5" />
}
