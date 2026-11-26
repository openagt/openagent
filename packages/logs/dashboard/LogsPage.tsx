import { useState, type ReactNode } from 'react'
import { Button, Empty, isUnreachable, Facts, FilterChips, MiddleCut, NO_PROJECT, Page, PanelGroup, PanelGroups, PanelRow, PanelShape, PersonMark, RunMark, Skeleton, Slot, WordsShape, formatDateTime, formatDay, formatDuration, personSaid, rpcClient, runName, runLineTone, runState, waitingTone, useCodingAgents, usePeople, useIsMobile, runsAgain, runWord, useModuleHost, usePolled, useWaiting, type CodingAgent, type ModuleAgent, type ModuleHostPerson, type UiPageProps, type UiProject, type ReadState, type WaitingItem } from '@openagt/ui/module'
import type { RunCard } from '@openagt/agent-driver'

/** How many runs each project lists: the command's own default page is 20; the page shows more. */
const LIMIT = 50

/** One run, with the project it was recorded in. */
export interface RunRow {
  project: UiProject
  /** The project the run is in, by id, when it is not the row's: a session with no project listed under a project it has a copy of. Opened as that one's. */
  in?: string
  /** A session with no project: the projects it has copies of, by name, which its row names. One row says it, whichever of them listed it. */
  copies?: string[]
  card: Omit<RunCard, 'caller'> & {
    /** Whose run it is, by the email its record is kept under; a very old card has none. */
    person?: string
    /** A session with no project, recorded in the row's project because it had a copy of it. */
    noProject?: true
    /** Such a session's copies of repos, by name: every one, the projects this page does not read too. */
    copies?: string[]
    /** Its pull request merged, as the git host last said, read where the sidebar reads it: the run reads as merged there and here. */
    merged?: boolean
  }
}

/** A project's runs as the dashboard lists them right now. */
export interface LiveRuns {
  project: UiProject
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
    for (const run of runs) if (!recorded.has(`${project.id}/${run.id}`) && run.startedAt >= from) shown.push({ project, ...(run.in !== undefined ? { in: run.in } : {}), card: { id: run.id, startedAt: run.startedAt, ...cardOf(run) } })
  }
  return shown.sort((a, b) => b.card.startedAt.localeCompare(a.card.startedAt))
}

/**
 * One row per run: a session with no project is recorded in each project it has a copy of, and the
 * dashboard lists it under each of them, so the projects' reads give it once each. It stays once,
 * the first row of it (the newest word on it), naming every one of them.
 */
export function oneRowPerRun(rows: readonly RunRow[]): RunRow[] {
  const kept = new Map<string, RunRow>()
  for (const row of rows) {
    const session = row.in !== undefined || row.card.noProject === true
    const key = session ? `${NO_PROJECT}/${row.card.id}` : `${row.project.id}/${row.card.id}`
    const first = kept.get(key)
    if (!session) {
      if (!first) kept.set(key, row)
      continue
    }
    // What its record says it copied, else the projects that listed it.
    const named = [...(first?.copies ?? []), ...(row.card.copies ?? [row.project.name])]
    kept.set(key, { ...(first ?? row), in: NO_PROJECT, copies: [...new Set(named)] })
  }
  return [...kept.values()]
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
  }
}

/** What one read of every project gave: the runs, and the projects whose read failed, with why. */
interface Read {
  rows: RunRow[]
  failed: { project: UiProject; error: string }[]
}

const NOTHING_READ: Read = { rows: [], failed: [] }

/** The states a chip picks, in this order: what waits on the person, what is going, then how runs ended. */
const STATES = ['waiting', 'running', 'done', 'merged', 'stopped', 'failed']

/** A chip's word for a state: what waits on the person is "Waiting", as the sidebar's "Waiting on you"; any other the state's own word. */
function chipWord(state: string): string {
  const word = state === 'waiting' ? 'waiting' : runWord(state)
  return word[0]!.toUpperCase() + word.slice(1)
}

/**
 * How much of a run's work still waits before it leaves this machine, as a fact of its line after
 * what it needs, which its item of "Waiting on you" says ("Needs commit"): "2 files", "1 commit".
 */
export function leftParts(need: WaitingItem | undefined): string[] {
  return (need?.mark === 'changes' || need?.mark === 'branch') && need.detail !== undefined ? [need.detail] : []
}

/** How a row stands: by the sidebar's rule ({@link runState}), given what waits on the person for its run, the sidebar's "Waiting on you". */
type Standing = ReturnType<typeof runState>

/** The runs in order, cut into their days, each day with what its runs cost together. */
export function byDay(rows: RunRow[], now: Date = new Date()): { day: string; rows: RunRow[]; cost: number }[] {
  const days: { day: string; rows: RunRow[]; cost: number }[] = []
  for (const row of rows) {
    const day = formatDay(row.card.startedAt, now)
    const last = days[days.length - 1]
    if (last?.day === day) last.rows.push(row)
    else days.push({ day, rows: [row], cost: 0 })
    days[days.length - 1]!.cost += row.card.cost ?? 0
  }
  return days
}

/** The statuses of a run that is over: a waiting run's end is only its last turn's. */
const ENDED = ['done', 'stopped', 'failed']

/** How long a run took, from its start to its end; nothing for one not over, nor for one that waits on the person. */
function took(card: RunRow['card'], { state }: Standing): string | undefined {
  return card.endedAt && ENDED.includes(state) ? formatDuration(Date.parse(card.endedAt) - Date.parse(card.startedAt)) : undefined
}

/** The time of day a run started, its day being the heading's. */
function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/** Whether the run's question waits on the person. */
const asks = (card: RunRow['card']): boolean => card.status === 'waiting'

/** A run's press: Answer where its question waits, else Review. */
const pressOf = (card: RunRow['card']): string => (asks(card) ? 'Answer' : 'Review')

/** How a run stands, as its row's line opens: its state's word, with how long it took once it is over ("Done in 11m"). */
function standingSaid(card: RunRow['card'], standing: Standing): string {
  const said = standing.word[0]!.toUpperCase() + standing.word.slice(1)
  const length = took(card, standing)
  if (length === undefined) return said
  return standing.state === 'done' ? `${said} in ${length}` : `${said} after ${length}`
}

/** The coding agent that ran it and its model, by the names the agent gives them ("Claude Code · Opus 5.5"). */
function agentSaid(card: RunRow['card'], agents: CodingAgent[]): ReactNode {
  const agent = agents.find(option => option.value === card.driver)
  const model = card.model && (agent?.models.find(option => option.value === card.model)?.label ?? card.model)
  return <Facts facts={[agent?.label ?? card.driver, model]} />
}

/** The query's name for the status the list shows. */
const STATUS_PARAM = 'status'

/** What cost a sum of runs: "$1.23", nothing for none. */
function dollars(cost: number): string {
  return `$${cost.toFixed(2)}`
}

/**
 * The Logs page: every project's recorded runs, newest first, the newest 50 of each project as
 * the package's server part reads them (what `logs --limit 50` prints), each as the dashboard says
 * it stands right now ({@link withLiveRuns}). A chip shows one status, kept in the query
 * (`/logs?status=waiting`). A row opens the run's own page in the dashboard. A project whose read
 * fails is named with its reason, and the other projects still show.
 */
export function LogsPage({ projects }: UiPageProps) {
  const host = useModuleHost()
  const key = projects.map(p => p.id).join(',')
  const { value: live, state: liveState } = usePolled<LiveRuns[]>(
    () => Promise.all(projects.map(async project => ({ project, runs: await host.agents(project.id).catch((): ModuleAgent[] => []) }))),
    [],
    10_000,
    [key],
    { remember: `logs:live:${key}`, stored: true },
    runsAgain(undefined),
  )
  const { value: recorded, state: recordedState, failing } = usePolled<Read>(
    async () => {
      const server = rpcClient<typeof import('../src/server.js')>(host)
      const results = await Promise.all(
        projects.map(project =>
          server.runs(project.id, { limit: LIMIT }).then(
            cards => ({ project, cards }),
            (err: unknown) => {
              // OpenAgent did not answer: the page keeps what it showed and asks again, rather than say it.
              if (isUnreachable(err)) throw err
              return { project, error: err instanceof Error ? err.message : String(err) }
            },
          ),
        ),
      )
      const rows: RunRow[] = []
      const failed: Read['failed'] = []
      for (const result of results) {
        if ('error' in result) failed.push(result)
        else for (const card of result.cards) rows.push({ project: result.project, card })
      }
      rows.sort((a, b) => b.card.startedAt.localeCompare(a.card.startedAt))
      return { rows, failed }
    },
    NOTHING_READ,
    // Each read fetches origin's copy of the records branch, and a run lands only when it ends.
    60_000,
    [key],
    // Kept for the next visit: the page opens with the last list, faded until it is read again.
    { remember: `logs:runs:${key}`, stored: true },
  )
  const read = { ...recorded, rows: oneRowPerRun(withLiveRuns(recorded.rows, live)) }
  // The runs the dashboard lists show while the records are read; with none of those, the list waits for the records.
  const state: ReadState = recordedState === 'unknown' ? (read.rows.length > 0 ? liveState : 'unknown') : liveState === 'kept' ? 'kept' : recordedState
  // What waits on the person, every project's, as the shell read it for the sidebar's "Waiting on you": a run there waits here too, in its words.
  // Newest last, so a run that waits on two things is said by its newest.
  const needs = new Map([...useWaiting().all.items].reverse().flatMap(item => (item.scope === 'run' && item.run !== undefined ? [[`${item.projectId}/${item.run}`, item] as const] : [])))
  const needOf = (row: RunRow): WaitingItem | undefined => needs.get(`${row.in ?? row.project.id}/${row.card.id}`)
  const standingOf = (row: RunRow): Standing => runState(row.card, needOf(row))
  const accountOf = usePeople(read.rows.map(({ project, card }) => ({ projectId: project.id, person: card.person })), host.people, 'logs:people')

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
  const counts = STATES.map(value => ({ value, label: chipWord(value), count: read.rows.filter(row => standingOf(row).state === value).length })).filter(c => c.count > 0)
  const status = counts.some(c => c.value === picked) ? picked : null
  const shown = status === null ? read.rows : read.rows.filter(row => standingOf(row).state === status)
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
      // While the runs are read, the chips' track holds its place, and the list waits as a day of runs.
      bar={state === 'unknown' ? <Skeleton className="h-8 w-72 rounded-lg max-md:h-11" /> : <FilterChips chips={counts} total={read.rows.length} picked={status} onPick={pick} />}
    >
      <Slot
        of={{ state, value: read, failing }}
        shape={
          <PanelGroup title={<WordsShape words="Today" />} bare>
            <PanelShape rows={3} />
          </PanelGroup>
        }
        className="space-y-8"
      >
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
                    {rows.map(row => ({ ...row, standing: standingOf(row), need: needOf(row) })).map(({ project, in: home, copies, card, standing, need }) => {
                      // A run waiting on the person is in the colour of what it needs, as "Waiting on you" and the Overview say it.
                      const tone = standing.state === 'waiting' && need !== undefined ? waitingTone(need) : undefined
                      return (
                      <PanelRow
                        key={`${project.id}/${card.id}`}
                        state={<RunMark status={standing.state} className={tone} />}
                        // As every list names a run; a run with none of its names goes by its id. What it was asked, whole, under the pointer.
                        title={runName(card) ?? card.id}
                        titleHint={card.intent?.trim() || undefined}
                        href={host.agentHref(home ?? project.id, card.id)}
                        onClick={() => host.openAgent(home ?? project.id, card.id)}
                        meta={[
                          <span className={tone ?? runLineTone(standing.state)}>{standingSaid(card, standing)}</span>,
                          // On a phone the time stands in the line, so the name has the row's width and the row keeps its two lines.
                          phone && <span title={formatDateTime(card.startedAt)}>{clock(card.startedAt)}</span>,
                          // What its work still needs before it leaves this machine, in the sidebar's words.
                          ...leftParts(need),
                          // A session with no project is listed once, naming the projects it had copies of.
                          copies ? `No project · ${copies.join(', ')}` : many && project.name,
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
                          phone ? undefined : (
                            <span className="tabular-nums whitespace-nowrap" title={formatDateTime(card.startedAt)}>
                              {clock(card.startedAt)}
                            </span>
                          )
                        }
                        // The run's press, in the time's place under the pointer and the keyboard: Answer where its question waits, else Review.
                        // It opens the run, as the row does, so a phone, where the row is the press, has none: its time is in its line.
                        {...(phone
                          ? {}
                          : {
                              actions: (
                                <Button variant={asks(card) ? 'default' : 'secondary'} size="sm" className="relative" aria-label={`${pressOf(card)}: ${runName(card) ?? card.id}`} onClick={() => host.openAgent(home ?? project.id, card.id)}>
                                  {pressOf(card)}
                                </Button>
                              ),
                            })}
                      />
                      )
                    })}
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
