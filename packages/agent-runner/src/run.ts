import { sessionsHomeOf, errorMessage } from '@openagt/agent-data'
import { continuationPrompt } from '@openagt/agent-driver'
import { createHooks } from '@openagt/hooks'
import { findRun, readDiary, type RunStatus } from '@openagt/skill-logs'
import { runProcess, type Leg, type RunDeps } from './leg.js'
import { lasting, markerCard, runnerMark, writeMarker, type Publish, type RunnerMark, type SessionRepo } from './records.js'
import type { ProjectSkillsPick } from './agent.js'
import { withRunLock } from './run-lock.js'
import { askName, isBareCommand, type AskedName } from './title.js'
import { detailOf, modelOf } from './session.js'
import { runModules } from './steps/modules.js'

/**
 * One run (#1774): one pipeline of steps (`@openagt/hooks`' `run.step`), each the part of a module:
 * the checkout from the branches package, the run's skills linked into it, the agent's session from
 * agent-driver with the prompt once and the agent's own loop to the end (`session.ts`), then the
 * record, the checkout reclaimed and the person told (`steps/`). A step that prepares the run and
 * fails ends it failed, recorded with what went wrong; the steps that finish it run whatever its
 * end. This process records the run and reclaims the checkout when the agent stops; a run that
 * dies is caught by the sweep, which a scheduler runs on every tick.
 *
 * The session keeps the run's live record itself, the card and the diary under `.openagent/`
 * in the checkout, in the run record's shape; this process adds its mark, the pid and the host,
 * and copies the two files onto the branch unchanged when the run ends. When the last turn ended
 * on a question and nothing waited in its inbox, the run ends `waiting`, keeps its checkout, and
 * the answer resumes it (`resumeRun`): the same run, the same record, continued.
 *
 * SIGINT or SIGTERM to this process stops the run: before its agent starts, the steps still to
 * prepare it are skipped; once it has, the agent is asked to end its turn where it is, and its
 * conversation keeps everything up to there. The run is recorded `stopped`, and the checkout is
 * reclaimed when its branch holds all of it. A second signal ends the agent's process tree at once.
 * That is what a dashboard's Stop sends, the pid being on the live card. A message to a stopped run
 * continues it, as one to any ended run does.
 *
 * One-shot: `agent-runner run <prompt>` runs on its own. A scheduler's tick spawns the same thing
 * with the marker already written and the id chosen.
 *
 * The pull request a run's branch has is read back through the git host the project declares
 * (`git-host.ts`); a project with no git host package records none.
 *
 * A run may be started from a branch other than origin's default (`run --base <ref>`), and with
 * its pull request going into one (`run --pr-base <branch>`); both are on its record for its whole
 * life.
 *
 * A run started in the sessions home has no project: it works in a folder of its own there
 * (`session-folder.ts`), with no branch, no pull request and nothing to reclaim, and its record is
 * kept with the other sessions' (`@openagt/agent-data`'s sessions).
 */

/** Filesystem-safe, time-ordered id from an ISO start: the shape the dashboard sorts runs by. */
export function runIdFrom(startedAt: string): string {
  return startedAt.replace(/[:.]/g, '-')
}

/**
 * What a run is asked: its prompt, and how far and from where it takes its work. The same whether
 * the run goes on in this process, in a process spawned for it (`runner.ts`), or detached.
 */
export interface RunRequest {
  /** What the agent is told, usually a slash command. */
  prompt: string
  /** The model the session starts on (`run --model`); the coding agent's own default when absent. */
  model?: string
  /** How hard that model may think (`run --effort`); the coding agent's own default when absent. */
  effort?: string
  /** How far the agent publishes when it finishes (`run --publish`); absent, only what the prompt itself asks. */
  publish?: Publish
  /** A text handed to the agent with the prompt, after it (`run --attach`), such as what a scheduler's check found: the record keeps it apart from the prompt, which stays the run's name. */
  attached?: string
  /** The branch the run's fresh branch starts from (`run --base`); origin's default branch when absent. */
  base?: string
  /** The branch the run's pull request goes into (`run --pr-base`); the repository's default branch when absent. */
  prBase?: string
  /** The branch to work on (`run --branch`), one that exists, such as a person's pull request's; a fresh `agent-<id>` when absent. */
  branch?: string
  /** What the run is started for (`run --for`), kept on its mark: a thread on the git host, by its address. */
  for?: string
  /** The repos a session with no project has as context (`run --repos`), each copied into its folder; kept on its mark. */
  repos?: SessionRepo[]
}

export interface RunOptions extends RunRequest, RunDeps {
  /**
   * The run's name, already being asked for by whoever starts the run, from before it could make
   * this run's driver ({@link namedAtStart}); asked for here as the run begins when absent.
   */
  naming?: AskedName
  /** The run's id; minted from the start time when absent. */
  id?: string
  /**
   * When the run was asked for, ISO: the start its record holds. A scheduler asks, then marks and
   * spawns, and the seconds between belong to the run: its marker and its record name one start.
   * This process's clock when absent.
   */
  startedAt?: string
  /** Whether the run's marker is already on the branch: a scheduler's tick writes it before it spawns. A person's run marks itself. */
  marked?: boolean
  /** The account the run works as at the git host, kept on its record; none when the git host cannot say. */
  gitAccount?: string
  /** The agent the run is on, by its id (`OPENAGENT_AGENT`), kept on its mark; the default agent when absent. */
  agent?: string
  /** The session's picks of skills, kept on its mark (`agent.ts` SkillPicks): skills on top of its agent's, skills of its agent's left out, which of the project's own stay in its checkout. */
  skillsOn?: string[]
  skillsOff?: string[]
  projectSkills?: ProjectSkillsPick
}

export interface RunOutcome {
  id: string
  status: Exclude<RunStatus, 'running'>
  branch?: string
  pr?: { number: number; url: string }
  cost?: number
  /** Whether the checkout went once the remote had its branch, or stayed and why. */
  checkout: { reclaimed: true } | { reclaimed: false; reason: string }
  detail?: string
}

/**
 * Whether a run is named the moment it starts: not a run another tool marked, whose marker may
 * carry its name, nor a bare command, named from its report (`title.ts`); and not when the person
 * turned naming off (`OPENAGENT_NAME_RUN=0`).
 */
export function namedAtStart(opts: { prompt: string; marked?: boolean }): boolean {
  return process.env.OPENAGENT_NAME_RUN !== '0' && !opts.marked && !isBareCommand(opts.prompt)
}

export async function runCommand(repo: string, opts: RunOptions): Promise<RunOutcome> {
  const here = runProcess(opts)
  const startedAt = opts.startedAt ?? here.clock()
  const id = opts.id ?? runIdFrom(startedAt)
  const mark: RunnerMark = { host: here.host, pid: here.pid, ...lasting(opts) }

  return withRunLock(repo, id, here, async () => {
    // A person's run marks itself; a scheduler's run was marked before it was spawned. The marker
    // is pushed while the checkout is made and the agent starts: pushing takes seconds, and the
    // person watching the run waits on the agent. It never writes `.git/config`, so the agent's own
    // git is never locked out by it. The run's record waits on it, so it lands after.
    const card = markerCard({ id, startedAt, prompt: opts.prompt, driver: opts.driver.id, ...modelOf(opts.model), mark })
    const marking = opts.marked
      ? undefined
      : writeMarker(repo, card, here.logs).then(
          marked => {
            if (!marked.ok && !marked.committed) here.log(`[agent-runner] the run's record could not be written: ${marked.error}`)
          },
          err => here.log(`[agent-runner] the run's record could not be written: ${errorMessage(err)}`),
        )

    // The run's short name is asked for first of all, beside the checkout and the agent's start
    // rather than after them: the name is the first thing a person watching the run waits on, and
    // asking takes seconds of its own (`title.ts`). Earlier still when whoever starts the run asked
    // already (`runProject`, before the git host's account is read), and only for a run that is
    // named at start ({@link namedAtStart}).
    const named = opts.naming ?? (namedAtStart(opts) ? askName(opts.driver, opts.prompt) : undefined)

    return runLeg({
      repo,
      id,
      here,
      driver: opts.driver,
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.effort !== undefined ? { effort: opts.effort } : {}),
      sessions: await sessionsHomeOf(repo),
      prompt: opts.prompt,
      ...(opts.attached !== undefined ? { attached: opts.attached } : {}),
      ...(opts.branch !== undefined ? { branch: opts.branch } : {}),
      ...(opts.marked ? { marked: true } : {}),
      ...(marking ? { marking } : {}),
      ...(named ? { named } : {}),
      mark,
      card,
    })
  })
}

export interface ResumeOptions extends RunDeps {
  /** The run to continue: one that ended `waiting`, or any ended run whose session the driver can resume. */
  id: string
  /** The user's words to the agent; or, with `answer`, absent. */
  text?: string
  /** The chosen label or labels, answering the question the run's last turn asked. */
  answer?: string
  /** How far the run takes its work from here on: a level, or `null` for none; the level its record names when absent. */
  publish?: Publish | null
  /** The account this leg works as at the git host, on the record from here on; the record's own when absent. */
  gitAccount?: string
  /** Who resumes the run, kept on its mark with the time: a scheduler's row, which counts the run as its own from then on. */
  by?: string
  /** The model this leg starts on; the record's own when absent. */
  model?: string
  /** How hard the model may think on this leg; the record's own when absent. */
  effort?: string
}

/**
 * Continue an ended run: the same id, the same record, the same branch. The checkout is the one
 * the run kept, or a new one attached to its branch; a branch that went with the checkout, for
 * holding nothing, starts again from the base the record names, or origin's default branch. The session resumes by the id the
 * record carries; the diary goes on from where it stopped. A conversation the coding agent no
 * longer has, or a record that names none, is not the end of the run: it goes on in a fresh one,
 * whose agent reads the run's record first (`afresh`). The prompt is the user's text, or the
 * continuation of the question the run ended on with the given answer. The sentence of the publish
 * level the record keeps, or of the one the resume gives the run from here on, is said after it. A run whose work was landed, its branch gone
 * with that, is no longer recorded as landed once it is on a branch made again: what it does from
 * here is not.
 */
export async function resumeRun(repo: string, opts: ResumeOptions): Promise<RunOutcome> {
  const here = runProcess(opts)
  // Another process of this run, the one that ended it and still records and reclaims, or a
  // resume started just before this one, goes first: this one waits, then reads the run as that
  // one left it.
  return withRunLock(repo, opts.id, here, async () => {
    const card = await findRun(repo, opts.id, here.logs)
    if (!card) throw new Error(`no run ${opts.id}`)
    // Every process of this run is gone by now, so a record still saying running is one whose
    // process died before it could end it: the sweep's to close first.
    if (card.status === 'running') throw new Error(`run ${opts.id} is still recorded running`)
    const previous = runnerMark(card)
    if (!previous) throw new Error(`run ${opts.id} is not this tool's`)
    const diary = (await readDiary(repo, opts.id, here.logs)) ?? []
    const sessionId = typeof card.caller?.['sessionId'] === 'string' ? (card.caller['sessionId'] as string) : undefined

    let prompt: string
    if (opts.answer !== undefined) {
      const question = [...diary].reverse().find(line => line.kind === 'question')
      const title = typeof question?.['title'] === 'string' ? (question['title'] as string) : 'your question'
      prompt = continuationPrompt(title, opts.answer)
    } else if (opts.text) {
      // A run stopped before its agent took its own prompt never had it: it goes first, the words after it.
      prompt = card.intent !== undefined && !diary.some(line => line.kind === 'start') ? `${card.intent}\n\n${opts.text}` : opts.text
    } else {
      throw new Error('a text or an answer is needed to resume a run')
    }

    // The level its record names, or the one this resume gives it from here on.
    const { publish: recorded, ...lasts } = lasting(previous)
    const publish = opts.publish === undefined ? recorded : (opts.publish ?? undefined)
    const mark: RunnerMark = { host: here.host, pid: here.pid, ...lasts, ...(publish !== undefined ? { publish } : {}), ...(opts.gitAccount !== undefined ? { gitAccount: opts.gitAccount } : {}), ...(opts.by !== undefined ? { resumed: { by: opts.by, at: here.clock() } } : {}) }
    const model = opts.model ?? card.model
    const effort = opts.effort ?? card.effort

    return runLeg({
      repo,
      id: opts.id,
      here,
      driver: opts.driver,
      ...(model !== undefined ? { model } : {}),
      ...(effort !== undefined ? { effort } : {}),
      sessions: await sessionsHomeOf(repo),
      prompt,
      earlier: { diary, ...(sessionId !== undefined ? { sessionId } : {}) },
      mark,
      card,
    })
  })
}

/**
 * A leg of the run, through the steps of the run's modules (`steps/`), in their order. A signal
 * stops the run: the first asks the agent to end its turn where it is, as Esc does in Claude Code,
 * and the driver ends its process tree only when it cannot ask or the agent does not stop; a second
 * one ends the tree at once. The handlers stay until this process is done, so a signal that comes
 * while the run records and reclaims never kills it halfway through a write. A finishing step that
 * fails is said on the log, and the others go on.
 */
async function runLeg(given: Omit<Leg, 'killed' | 'worked'>): Promise<RunOutcome> {
  const stop = new AbortController()
  const kill = new AbortController()
  const onSignal = (): void => (stop.signal.aborted ? kill : stop).abort()
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    const leg: Leg = { ...given, killed: kill.signal, worked: {} }
    const hooks = createHooks(runModules(leg))
    const { outcome, errors } = await hooks.run({ id: leg.id, prompt: leg.prompt, options: {}, context: [], env: {}, facts: {}, signal: stop.signal, store: hooks.store, settings: hooks.settings })
    for (const { module, step, error } of errors) leg.here.log(`[agent-runner] ${module} could not ${step}: ${errorMessage(error)}`)
    const { branch, pr } = leg.worked
    const cost = leg.recorded?.card.cost
    const detail = detailOf(outcome)
    return {
      id: leg.id,
      status: outcome.status,
      ...(branch !== undefined ? { branch } : {}),
      ...(pr ? { pr } : {}),
      ...(cost !== undefined ? { cost } : {}),
      checkout: leg.reclaimed ?? { reclaimed: false, reason: 'no checkout' },
      ...(detail !== undefined ? { detail } : {}),
    }
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}
