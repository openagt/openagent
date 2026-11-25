import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findRun, isRunId, listRuns, promptLines, type RunCard, nameHandOver, runIdFrom, runnerMark, runStderrPath } from '@openagt/agent-driver'
import type { ProjectRef, RunFound, RunHost, RunInput, RunOptions, RunReadiness, RunRef, RunSummary, InboxLine, PromptLine } from '@openagt/hooks'
import { GitHubError, githubRequest, type FetchLike } from './actions.js'
import { ACTIONS_HOST, WORKFLOW, githubAccess, type GitHubAccess, type TurnRequest } from './turn.js'

/**
 * GitHub Actions as a host for a project's runs (`run.host`, #2394): a run there is a process of
 * its own on this computer, one per turn, which dispatches the turn to the project's workflow,
 * waits for it and records how it went (`turn.ts`); answered with the run's id at once. What a
 * person says to an ended run goes on with it in a new turn; a working run's turn cannot be told
 * anything until it ends, as a runner takes no word from outside. A Stop is a signal to the turn's
 * process, which cancels the Actions run.
 */

/** What the host works with; the real one when absent. */
export interface ActionsHostDeps {
  /** Start a turn's process for run `turn.id` of the project at `dir`, with `env` beside this process's. */
  spawnTurn?: (dir: string, turn: TurnRequest, env: Record<string, string>) => Promise<void>
  /** The project's repository on GitHub, and the account's token, as the check asks for them. */
  github?: (dir: string, account: string | undefined) => Promise<GitHubAccess>
  /** `fetch`, for a test. */
  fetch?: FetchLike
  isAlive?: (pid: number) => boolean
  /** This computer's name, as the runs it started say it. */
  host?: string
  now?: () => Date
}

/** The workflow a project's repository needs, in a few words, with what it holds. */
const WORKFLOW_MISSING = `Its repository has no workflow ${WORKFLOW} yet: copy the one @openagt/host-github-actions brings (workflow.yml) to .github/workflows/${WORKFLOW}, and add a CLAUDE_CODE_OAUTH_TOKEN secret from \`claude setup-token\`.`

export function actionsHost(deps: ActionsHostDeps = {}): RunHost {
  const spawnTurn = deps.spawnTurn ?? spawnTurnProcess
  const github = deps.github ?? githubAccess
  const isAlive = deps.isAlive ?? alive
  const here = deps.host ?? hostname()
  const now = deps.now ?? (() => new Date())

  /** What stops a run of the project at `dir` here: it is not on GitHub, its account cannot be used, its repository has no workflow, or it is no Claude Code run. */
  const ready = async (dir: string, options: RunOptions): Promise<RunReadiness> => {
    const driver = options['agent-driver']?.driver
    if (driver !== undefined && driver !== 'claude-code') return { problems: ['GitHub Actions runs Claude Code: pick it to run there.'], warnings: [] }
    let access: GitHubAccess
    try {
      access = await github(dir, options.github?.account)
    } catch (err) {
      return { problems: [err instanceof Error ? err.message : String(err)], warnings: [] }
    }
    try {
      await githubRequest({ token: access.token, ...(deps.fetch ? { fetch: deps.fetch } : {}) }, `/repos/${access.owner}/${access.repo}/actions/workflows/${WORKFLOW}`)
      return { problems: [], warnings: [] }
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return { problems: [WORKFLOW_MISSING], warnings: [] }
      return { problems: [], warnings: [`GitHub did not say whether the repository has its workflow: ${err instanceof Error ? err.message : String(err)}`] }
    }
  }

  /** The run's record, when it is a run of this host's. */
  const recordOf = async (run: RunRef): Promise<RunCard | undefined> => {
    if (!run.project || !isRunId(run.id)) return undefined
    const card = await findRun(run.project.dir, run.id).catch(() => undefined)
    return card?.caller?.['target'] === ACTIONS_HOST ? card : undefined
  }

  const resume = async (run: RunRef, input: RunInput): Promise<void> => {
    const card = await recordOf(run)
    if (!card || !run.project) throw new Error('This run did not run on GitHub Actions.')
    if (card.status === 'running') throw new Error('It is still working on GitHub Actions: say it once its turn has ended.')
    // A run there asks no question of its own (`turn.ts`): an answer is what the person replied, as a message is.
    const said = input.text ?? input.answer
    if (said === undefined || !said.trim()) throw new Error('A run goes on with a message.')
    await spawnTurn(run.project.dir, { id: run.id, prompt: said, resume: true }, {})
  }

  return {
    id: ACTIONS_HOST,
    label: 'GitHub Actions',

    async check({ project, options }) {
      if (!project) return { problems: ['GitHub Actions runs a project on GitHub: pick one.'], warnings: [] }
      return ready(project.dir, options)
    },

    async start({ project, prompt, options, title }) {
      if (!project) throw new Error('GitHub Actions runs a project on GitHub: pick one.')
      const readiness = await ready(project.dir, options)
      if (readiness.problems.length > 0) throw new Error(readiness.problems.join(' '))
      const id = runIdFrom(now().toISOString())
      const model = options['agent-driver']?.model
      const account = options.github?.account
      // The run's name, as whoever starts it is asking for it, goes to the turn's process as it comes, as a run's of this computer does.
      const name = nameHandOver(title)
      await spawnTurn(project.dir, { id, prompt, ...(model !== undefined ? { model } : {}), ...(account !== undefined ? { account } : {}) }, name.env)
      name.started()
      return { id }
    },

    resume,

    async steer(run, line: InboxLine) {
      // A runner takes no word from outside while its turn runs: what is said goes on with the run once it has ended.
      for (const said of promptLines([line])) await resume(run, inputOf(said))
    },

    async stop(run, opts = {}) {
      const card = await recordOf(run)
      if (!card) throw new Error('This run did not run on GitHub Actions.')
      if (card.status !== 'running') throw new Error('It had already ended.')
      const mark = runnerMark(card)
      if (mark?.host !== here) throw new Error(`This run is on ${mark?.host ?? 'another computer'}.`)
      if (mark.pid === undefined || !isAlive(mark.pid)) throw new Error('Its process had already ended.')
      try {
        // The turn's process cancels the Actions run, and records the run stopped.
        process.kill(mark.pid, 'SIGINT')
        if (opts.force) process.kill(mark.pid, 'SIGTERM')
      } catch {
        throw new Error('Its process had already ended.')
      }
    },

    async list(project) {
      if (!project) return []
      const cards = await listRuns(project.dir).catch(() => [])
      return cards
        .filter(card => card.caller?.['target'] === ACTIONS_HOST)
        .map(card => summaryOf(card, project))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    },

    async find(run): Promise<RunFound | undefined> {
      const card = await recordOf(run)
      if (!card) return undefined
      const host = card.caller?.['host']
      return {
        record: {
          status: card.status,
          ...(typeof host === 'string' ? { host } : {}),
          ...(card.branch !== undefined ? { branch: card.branch } : {}),
          ...(card.pr ? { pr: { number: card.pr.number, url: card.pr.url } } : {}),
        },
        // The run's work is on the branch its turns pushed, on origin: never a checkout of this computer's to reclaim.
        changedNothing: false,
      }
    },
  }
}

/** What one line said to an ended run goes on with. */
function inputOf(line: PromptLine): RunInput {
  return line.kind === 'answer' ? { answer: line.answer } : { text: line.text }
}

/** A run's record, as the host lists it. */
function summaryOf(card: RunCard, project: ProjectRef): RunSummary {
  return {
    id: card.id,
    project: project.id,
    status: card.status === 'running' ? 'working' : card.status,
    startedAt: card.startedAt,
    ...(card.endedAt !== undefined ? { endedAt: card.endedAt } : {}),
    ...(card.title !== undefined ? { title: card.title } : {}),
    prompt: card.intent ?? '',
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as { code?: string }).code === 'EPERM'
  }
}

/** This package's command, which runs a turn in a process of its own (`cli.ts`). */
const BIN = fileURLToPath(new URL('../bin/host-github-actions', import.meta.url))

/**
 * A turn's process, detached: `host-github-actions turn <dir>`, handed the turn on its stdin, its
 * stderr kept where a run's is (agent-driver's), so one that dies before it records says why.
 */
async function spawnTurnProcess(dir: string, turn: TurnRequest, env: Record<string, string>): Promise<void> {
  const stderrPath = runStderrPath(dir, turn.id)
  mkdirSync(dirname(stderrPath), { recursive: true })
  const fd = openSync(stderrPath, 'a')
  const child = spawn(process.execPath, [BIN, 'turn', dir], { cwd: dir, detached: true, stdio: ['pipe', 'ignore', fd], env: { ...process.env, ...env } })
  closeSync(fd)
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.stdin!.end(JSON.stringify(turn))
  child.unref()
}
