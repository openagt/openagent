import { basename } from 'node:path'
import { listProjects } from './registry.js'
import { startDaemonTick, DAEMON_TICK_MS } from './daemon-tick.js'
import { DATA_BRANCH, branchReach, pullFileBranch } from '@openagt/agent-data'
import type { ProjectErrors } from './project-errors.js'
import { startCloudScratchSweep } from './cloud-scratch-refs.js'
import { adoptCloudWork, startCloudWorkAdoption } from './cloud-work.js'
import type { ProjectSummary } from './dashboard/projects.js'
import { providerProblems } from './store/provided.js'
import { projectGitHost } from './store/git-host.js'

/**
 * Everything the daemon runs in the background beside serving the dashboard: the data sync (#1599),
 * the cloud-scratch sweep (#1547) and the cloud work adoption (#1601). None of them starts a run
 * (#1774).
 *
 * All of it used to sit inline in `runDaemon`, which meant its body was a lifecycle narrative with
 * ~200 lines of service wiring in the middle of it; the daemon body is left with the sequence it
 * actually owns.
 *
 * They share one clock (E4). Each used to own a `setInterval`, so six intervals ran side by side
 * with no single place to look when a sweep was not running; now each declares how many ticks it
 * wants between turns and `daemon-tick.ts` fires them.
 */

/** Ticks between cloud work adoption passes: a ten-minute job. */
const TEN_MINUTES_EVERY = Math.round((10 * 60 * 1000) / DAEMON_TICK_MS)

/**
 * Ticks between cloud-scratch sweeps (#1547): hourly. The refs it deletes have to sit for a day
 * first, so a finer cadence would only spend `ls-remote` round-trips asking the same question.
 */
const CLOUD_SCRATCH_EVERY = Math.round((60 * 60 * 1000) / DAEMON_TICK_MS)

/** What the daemon needs back. */
export interface BackgroundServices {
  /**
   * Stop every background job. Resolves once the tick in flight has finished: these jobs commit
   * and push, and stopping their clock does not stop their turn.
   */
  quiesce: () => Promise<void>
}

/** What {@link startBackgroundServices} needs from the daemon. */
export interface BackgroundServiceDeps {
  env: NodeJS.ProcessEnv
  /** Where a job records a project state the user must fix (#1500), for the dashboard to show. */
  projectErrors: ProjectErrors
  log: (message: string) => void
}

/**
 * One project's data-sync turn (#1599): converge the `agent-data` branch — the skills' branch,
 * which carries the tickets, the queue and the `logs` skill's runs — with
 * origin through the shared branch library, one pull, and set or clear the project's `data-sync`
 * error by the outcome. The clear is unconditional on success, so the error lives exactly as long
 * as the condition — the next tick after the user fixes the remote, it is gone. A branch that stays
 * on this machine (no remote, or the person does not share it) is no error: the project carries why,
 * for as long as that holds. The daemon knows
 * nothing of what is on the branch (#1774): a skill's own setup makes its files.
 */
export async function syncProjectData(path: string, errors: ProjectErrors, log: (message: string) => void): Promise<void> {
  const result = await pullFileBranch(path, DATA_BRANCH, { log })
  if (result.ok) {
    errors.setReach(path, result.reach)
    errors.clear(path, 'data-sync')
  } else {
    errors.setReach(path, await branchReach(path))
    log(`[openagent] data sync: ${result.error}`)
    errors.set(path, 'data-sync', result.error)
  }
}

/**
 * One project's provider check (#1820), on the data sync's clock: a kind of the project's data
 * that packages declare but none is settled to provide (several declare it and the project's
 * package.json names none, or names one that does not declare it) is the project's `provider`
 * error, every such kind on its own line; every kind settled clears it. OpenAgent never picks
 * the first declarer silently: the project says, or nothing provides and the banner says why.
 */
export async function checkProviders(path: string, errors: ProjectErrors): Promise<void> {
  const problems = await providerProblems(path)
  if (problems.length === 0) errors.clear(path, 'provider')
  else errors.set(path, 'provider', problems.join('\n'))
}

/** The registered projects as dashboard summaries. */
async function listSummaries(env: NodeJS.ProcessEnv): Promise<ProjectSummary[]> {
  const records = await listProjects(undefined, env).catch(() => [])
  return Promise.all(records.map(async p => ({ id: p.id, path: p.path, name: basename(p.path), activated: true, gitHost: (await projectGitHost(p.path).catch(() => undefined)) !== undefined })))
}

export function startBackgroundServices(deps: BackgroundServiceDeps): BackgroundServices {
  const { env, log } = deps
  const projects = () => listSummaries(env)

  // Delete the scratch refs a web hand-off leaves on origin (#1547): the pre-hand-off `cloud-*`
  // ref and the run branch, one dead pair per web run. Daemon-side rather than in the driver,
  // because session creation only signals "created", not "clone finished" — a driver deleting its
  // own ref races the provisioning and can strand the session. The sweep waits out that race
  // (~a day) and only deletes refs whose work is provably on the default branch.
  const cloudScratch = startCloudScratchSweep({ projects, log })

  // Adopt the branch a cloud session actually worked on (#1601): match each settled web run to
  // the `claude/*` head descending from its hand-off anchor, record the branch and PR on the
  // run's archive, and open the armed draft PR the session never did. Daemon-side by necessity:
  // the branch does not exist yet when the wrapper ends — the cloud VM is still provisioning.
  const cloudWork = startCloudWorkAdoption({ projects, log, adopt: cwd => adoptCloudWork(cwd) })

  // One clock for every background job (E4). Each says how many ticks it wants between turns
  // instead of owning an interval, so there is one place to look when the answer to "why is
  // nothing happening" is that a sweep is not running — and the ratios are exact rather than six
  // timers drifting apart.
  const clock = startDaemonTick({
    log,
    jobs: [
      // The eager data pull (#1582): converge every project's data checkout on what other
      // machines and cloud sessions pushed, and carry out anything a failed cycle left local.
      // Its start-up turn is also what creates the checkout on a fresh clone. A project that
      // cannot converge is recorded as such for the dashboard (#1599).
      {
        name: 'data sync',
        every: 2,
        run: async () => {
          for (const project of await projects().catch((): ProjectSummary[] => [])) {
            // Taken off the list since this turn began: a sync would make its records' checkout again,
            // right after a person asked for it to go.
            if (!(await listProjects(undefined, env).catch(() => [])).some(listed => listed.id === project.id)) continue
            await syncProjectData(project.path, deps.projectErrors, log)
            await checkProviders(project.path, deps.projectErrors)
          }
        },
      },
      // Hourly. Its start-up turn is what starts a `cloud-*` ref's one-day clock (#1547): the
      // sweep ages those refs from when it first saw them, so the sooner it looks, the sooner
      // a leftover can go.
      { name: 'cloud scratch sweep', every: CLOUD_SCRATCH_EVERY, run: () => cloudScratch.tick() },
      // Ten minutes: the cloud session it waits on lives minutes-to-hours itself, and the pass
      // costs an `ls-remote` per project only while a settled web run is actually waiting.
      { name: 'cloud work adoption', every: TEN_MINUTES_EVERY, run: () => cloudWork.tick() },
    ],
  })

  return {
    quiesce: async () => {
      await clock.stop()
      cloudScratch.stop()
      cloudWork.stop()
    },
  }
}

