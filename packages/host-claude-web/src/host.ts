import type { ProjectRef, RunFound, RunHost, RunReadiness } from '@openagt/hooks'
import { runEvents, summaryOf, type RecordDeps } from '@openagt/agent-driver'
import { bridgeQuestions } from './bridge-store.js'
import { hostname } from 'node:os'
import { NO_EXTENSION, endUnmade, giveUp, startWebRun, type HandOffDeps } from './hand-off.js'
import { repoOf } from './github.js'
import { WEB_HOST, findWebRun, projectWebRuns, type WebRun } from './web-runs.js'

/**
 * Claude Code on the web as a host for a project's runs (`run.host`, #2394): a run there is a
 * cloud session on claude.ai, made by the bridge extension (`hand-off.ts`). What a person says to
 * it is said in the session itself: the bridge types only the answer to a question the session
 * parked on, picked on the run's page, never words of the person's. Its session cannot be stopped
 * from here either: only a hand-off still under way can.
 */

/** What the host works with; the real one when absent. */
export interface WebHostDeps extends HandOffDeps {
  logs?: RecordDeps
}

/** Said to a message or a Stop for a run whose session is made. */
const IN_ITS_SESSION = 'It runs as a Claude Code cloud session: say it, or stop it, in its session on claude.ai.'

export function webHost(deps: WebHostDeps = {}): RunHost {
  const logs = deps.logs ?? {}
  const here = deps.host ?? hostname()

  /** The run, when it is one of this host's. */
  const runOf = async (run: { id: string; project?: ProjectRef }): Promise<WebRun | undefined> => (run.project ? findWebRun(run.project.dir, run.id, logs) : undefined)

  const refuseWords = async (run: { id: string; project?: ProjectRef }): Promise<never> => {
    if (!(await runOf(run))) throw new Error('This run did not run as a Claude Code cloud session.')
    throw new Error(IN_ITS_SESSION)
  }

  return {
    id: WEB_HOST,
    label: 'Claude Code on the web',

    async check({ project, options }): Promise<RunReadiness> {
      if (!project) return { problems: ['A Claude Code cloud session works on a project on GitHub: pick one.'], warnings: [] }
      const problems: string[] = []
      const driver = options['agent-driver']?.driver
      if (driver !== undefined && driver !== 'claude-code') problems.push('Claude Code on the web runs Claude Code: pick it to run there.')
      await (deps.repo ?? repoOf)(project.dir).catch((err: unknown) => problems.push(err instanceof Error ? err.message : String(err)))
      if (!(deps.extensionAlive ?? (() => bridgeQuestions().extensionAlive()))()) problems.push(NO_EXTENSION)
      return { problems, warnings: [] }
    },

    async start({ project, prompt, options, title }) {
      if (!project) throw new Error('A Claude Code cloud session works on a project on GitHub: pick one.')
      const model = options['agent-driver']?.model
      const account = options.github?.account
      return startWebRun(project, { prompt, ...(model !== undefined ? { model } : {}), ...(account !== undefined ? { account } : {}), ...(title !== undefined ? { title } : {}) }, deps)
    },

    resume: run => refuseWords(run),
    steer: run => refuseWords(run),

    async stop(run) {
      // A hand-off under way here is given up; a session already made is the person's to stop, over there.
      if (giveUp(run.id)) return
      const found = await runOf(run)
      if (!found || !run.project) throw new Error('This run did not run as a Claude Code cloud session.')
      if (found.card.status !== 'running') throw new Error('It had already ended.')
      if (found.session) throw new Error(IN_ITS_SESSION)
      if (found.card.caller?.['host'] !== here) throw new Error('Its hand-off runs on another computer: stop it there.')
      // A hand-off of this computer's that is under way nowhere ended with an earlier run of OpenAgent.
      await endUnmade(run.project.dir, run.id, 'stopped', logs, deps.now)
    },

    async list(project, wanted = {}) {
      if (!project) return []
      const ids = wanted.ids ? new Set(wanted.ids) : undefined
      const since = wanted.since !== undefined ? Date.parse(wanted.since) : undefined
      return (await projectWebRuns(project, since !== undefined ? { since } : {}, logs))
        .filter(run => !ids || ids.has(run.card.id))
        .map(run => summaryOf(run.card, { project: project.id, agents: [], deps: { host: WEB_HOST, here, isAlive: () => false } }))
    },

    // The session's events are the ones its hand-off records, in the project's records.
    async *events(run, signal) {
      if (run.project && (await runOf(run))) yield* runEvents(run.project.dir, run.id, signal)
    },

    async find(run): Promise<RunFound | undefined> {
      const found = await runOf(run)
      if (!found) return undefined
      const { card } = found
      const host = card.caller?.['host']
      return {
        record: {
          status: card.status,
          ...(typeof host === 'string' ? { host } : {}),
          ...(card.branch !== undefined ? { branch: card.branch } : {}),
          ...(card.pr ? { pr: { number: card.pr.number } } : {}),
        },
        // The run's work is on the branch its session pushed, on origin: never a checkout of this computer's.
        changedNothing: false,
      }
    },
  }
}

