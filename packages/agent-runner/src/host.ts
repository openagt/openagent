import { randomUUID } from 'node:crypto'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendInbox, logCardFile, promptLines, takeInbox, type InboxLine, type PromptLine } from '@openagt/agent-driver'
import { PRESET_ENV, PROJECT_SKILLS_ENV, SKILLS_OFF_ENV, SKILLS_ON_ENV, isSkillName, sessionFolder, sessionsHome, sessionsHomeOf } from '@openagt/agent-data'
import { LOCAL_HOST, isPresetId, type ProjectRef, type RunHost, type RunInput, type RunOptions, type RunReadiness, type RunRef, type RunRequest, type RunStatus, type RunSummary } from '@openagt/hooks'
import { worktreePath } from '@openagt/skill-branches'
import { findRun, listRuns, parseRunCard, type RunCard } from '@openagt/skill-logs'
import { handedDownSettings, runPreset } from './preset.js'
import { inboxPath, liveDir } from './live-card.js'
import { isPublish, NO_PUBLISH } from './records.js'
import { isPidAlive } from './run-lock.js'
import { presetLoginFor, detachResume, detachRun, DRIVER_NAMES, GIT_ACCOUNT_ENV, isDriverName, readyToRun, spawnResume, spawnRun, type DriverName } from './runner.js'
import type { RunRequest as AskedRun } from './run.js'
import { NAME_FILE_ENV } from './title.js'

/**
 * This computer's host (`run.host`, #2394): a run started here is a process of its own, detached,
 * answered with its id at once (`runner.ts`); what a person says to it goes through its inbox
 * while it works, and resumes it once it has ended; a Stop is a signal to the process its card
 * names. Nothing waits in memory: a run's state is its files, the live card in its checkout and
 * its record, so a host made again finds every run where it was.
 */

/** What this computer's host works with; the real one when absent. A demo scripts the runs' processes (`spawnRun`, `spawnResume`). */
export interface LocalHostDeps {
  spawnRun?: typeof spawnRun
  spawnResume?: typeof spawnResume
  /** Whether a run on `driver` can start here, working as `login` at the git host when one is named. */
  ready?: (dir: string, driver: DriverName, login?: string) => Promise<RunReadiness>
  /** The account at the git host a run on `preset` works as when it names none: its preset's. */
  loginFor?: (dir: string, preset: string | undefined) => Promise<string | undefined>
  isAlive?: (pid: number) => boolean
  /** This computer's name, as the cards of its runs say it. */
  host?: string
  /** How long a Stop waits for a run that is starting to name its process. */
  startingMs?: number
}

/** How long a Stop waits for a run just started to name its process: as long as a page shows a run as starting. */
const STARTING_MS = 30_000

/** How long a name handed to a run waits for it there: a run that never comes for it leaves no file behind. */
const HANDED_NAME_KEPT_MS = 2 * 60_000

export function localHost(deps: LocalHostDeps = {}): RunHost {
  const ready = deps.ready ?? ((dir, driver, login) => readyToRun(dir, driver, login !== undefined ? { login } : {}))
  const loginFor = deps.loginFor ?? (async (dir, preset) => presetLoginFor(dir, await runPreset(preset, await handedDownSettings())))
  const isAlive = deps.isAlive ?? isPidAlive
  const here = deps.host ?? hostname()
  const startingMs = deps.startingMs ?? STARTING_MS

  /** Whether the run's live card says it is working, here, under a process that is alive. */
  const working = async (dir: string, id: string): Promise<boolean> => {
    const card = await liveCard(await checkoutOf(dir, id), id)
    const { pid, host } = processOf(card)
    return card?.status === 'running' && pid !== undefined && host === here && isAlive(pid)
  }

  /**
   * The run's card once it names the run's process, or says it ended. A run just started has
   * neither yet: a Stop then waits for it, as long as a run may take to start, rather than being
   * lost while the run goes on.
   */
  const cardOnceUp = async (dir: string, id: string): Promise<RunCard | undefined> => {
    const deadline = Date.now() + startingMs
    for (;;) {
      const card = await cardOf(dir, id)
      if ((card && (card.status !== 'running' || processOf(card).pid !== undefined)) || Date.now() >= deadline) return card
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }

  const resume = async (run: RunRef, input: RunInput): Promise<void> => {
    if (input.text === undefined && input.answer === undefined) throw new Error('A run goes on with a message or an answer.')
    await detachResume(
      placeOf(run.project),
      {
        id: run.id,
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.answer !== undefined ? { answer: input.answer } : {}),
        ...(input.publish !== undefined ? { publish: input.publish } : {}),
      },
      deps.spawnResume ? { spawn: deps.spawnResume } : {},
    )
  }

  return {
    id: LOCAL_HOST,
    label: 'This computer',

    async check({ project, options }) {
      return ready(placeOf(project), driverOf(options))
    },

    async start({ project, prompt, options, title }) {
      refuse(project, options)
      const dir = placeOf(project)
      const driver = driverOf(options)
      // A run is refused before it spends a checkout when its coding agent cannot start, or the account it works as cannot be used here.
      const login = options.github?.account ?? (await loginFor(dir, options.presets?.preset))
      const readiness = await ready(dir, driver, login)
      if (readiness.problems.length > 0) throw new Error(readiness.problems.join(' '))
      const name = nameHandOver(title)
      const { id } = await detachRun(dir, { prompt, driver, ...asked(options), env: { ...picks(options), ...name.env } }, deps.spawnRun ? { spawn: deps.spawnRun } : {})
      name.started()
      return { id }
    },

    resume,

    async steer(run, line) {
      const dir = placeOf(run.project)
      const lines: InboxLine[] = [line]
      if (await working(dir, run.id)) {
        const inbox = inboxPath(await checkoutOf(dir, run.id))
        await appendInbox(inbox, line)
        if (await working(dir, run.id)) return
        // The run ended while the line was on its way, into an inbox nobody reads: what is still there resumes it instead.
        lines.splice(0, 1, ...(await takeInbox(inbox)))
      }
      for (const stranded of promptLines(lines)) await resume(run, inputOf(stranded))
    },

    async stop(run, opts = {}) {
      const card = await cardOnceUp(placeOf(run.project), run.id)
      const { pid, host } = processOf(card)
      if (!card || (card.status === 'running' && pid === undefined)) throw new Error('It has not started yet.')
      if (card.status !== 'running') throw new Error('It had already ended.')
      if (host !== here) throw new Error(`This run is on ${host ?? 'another computer'}.`)
      if (pid === undefined || !isAlive(pid)) throw new Error('Its process had already ended.')
      try {
        // The run's process asks its agent to end the turn where it is, as Esc does in Claude Code.
        process.kill(pid, 'SIGINT')
        // A second signal ends the agent's process tree at once (`run.ts`): of another kind, so the two are never taken for one.
        if (opts.force) process.kill(pid, 'SIGTERM')
      } catch {
        // Gone between the look and the signal.
        throw new Error('Its process had already ended.')
      }
    },

    async list(project) {
      const cards = await listRuns(placeOf(project))
      return cards.map(card => summaryOf(card, project)).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    },
  }
}

/** Where a run of `project` is started and found: the project's folder, or the sessions home for a session with no project. */
function placeOf(project: ProjectRef | undefined): string {
  return project?.dir ?? sessionsHome()
}

/** The folder a run works in: its checkout of the project, or a session's folder of its own. */
async function checkoutOf(dir: string, id: string): Promise<string> {
  const home = await sessionsHomeOf(dir)
  return home !== undefined ? sessionFolder(home, id) : worktreePath(dir, id)
}

/** A run's live card, in its checkout while it works there; none when it has none, whatever tool wrote it. */
async function liveCard(checkout: string, id: string): Promise<RunCard | undefined> {
  const raw = await readFile(join(liveDir(checkout), logCardFile(id)), 'utf8').catch(() => undefined)
  return raw === undefined ? undefined : parseRunCard(raw)
}

/** A run's card as it stands: its live one while it has a checkout, its record's once it has none. */
async function cardOf(dir: string, id: string): Promise<RunCard | undefined> {
  return (await liveCard(await checkoutOf(dir, id), id)) ?? (await findRun(dir, id))
}

/** The process a card names, and the computer it is on: any tool's, as a reader of the card finds them. */
function processOf(card: RunCard | undefined): { pid?: number; host?: string } {
  const pid = card?.caller?.['pid']
  const host = card?.caller?.['host']
  return { ...(typeof pid === 'number' ? { pid } : {}), ...(typeof host === 'string' ? { host } : {}) }
}

/** The coding agent a run is on: the one picked, else Claude Code. */
function driverOf(options: RunOptions): DriverName {
  const driver = options['agent-driver']?.driver ?? 'claude-code'
  if (!isDriverName(driver)) throw new Error(`No coding agent is named ${driver}: the coding agents are ${DRIVER_NAMES.join(' and ')}.`)
  return driver
}

/**
 * Picks that cannot make a run, refused before anything is spent: what a session with no project
 * has no git for, repos for a run in a project, and names that are not names. The run's process
 * reads its picks off its command line and its environment: only what reads as the thing it names goes there.
 */
function refuse(project: ProjectRef | undefined, options: RunOptions): void {
  const branches = options['git-branches'] ?? {}
  if (!project && (branches.base !== undefined || branches.branch !== undefined || options.publish !== undefined || options.github?.prBase !== undefined || options.skills?.project !== undefined)) {
    throw new Error('A session with no project has no git: no branch to start from or work on, nothing to publish, and no project skills.')
  }
  if (project && branches.repos !== undefined) throw new Error('The repos are for a session with no project: a run in a project works in its own checkout.')
  if (branches.branch !== undefined && branches.base !== undefined) throw new Error('A run given a branch to work on starts from no other.')
  if (options.github?.account !== undefined && !/^\S+$/.test(options.github.account)) throw new Error('An account is named by its login.')
  const preset = options.presets?.preset
  if (preset !== undefined && !isPresetId(preset)) throw new Error('A preset is named by its id.')
  const { on, off, project: kept } = options.skills ?? {}
  for (const list of [on, off, kept === 'all' || kept === 'none' ? undefined : kept]) {
    if (list !== undefined && !list.every(isSkillName)) throw new Error('Skills are named by their names.')
  }
}

/** What the run's own process is asked on its command line (`runArgs`). */
function asked(options: RunOptions): Omit<AskedRun, 'prompt'> {
  const agent = options['agent-driver'] ?? {}
  const branches = options['git-branches'] ?? {}
  return {
    ...(agent.model !== undefined ? { model: agent.model } : {}),
    ...(agent.effort !== undefined ? { effort: agent.effort } : {}),
    ...(options.publish !== undefined ? { publish: options.publish } : {}),
    ...(branches.base !== undefined ? { base: branches.base } : {}),
    ...(branches.branch !== undefined ? { branch: branches.branch } : {}),
    ...(branches.repos !== undefined && branches.repos.length > 0 ? { repos: branches.repos } : {}),
    ...(options.github?.prBase !== undefined ? { prBase: options.github.prBase } : {}),
  }
}

/** The picks the run's own process reads off its environment: the account it works as, its preset, and the session's skills. */
function picks(options: RunOptions): Record<string, string> {
  const preset = options.presets?.preset
  const { on, off, project } = options.skills ?? {}
  return {
    ...(options.github?.account !== undefined ? { [GIT_ACCOUNT_ENV]: options.github.account } : {}),
    ...(preset !== undefined ? { [PRESET_ENV]: preset } : {}),
    ...(on !== undefined ? { [SKILLS_ON_ENV]: on.join(',') } : {}),
    ...(off !== undefined ? { [SKILLS_OFF_ENV]: off.join(',') } : {}),
    ...(project !== undefined ? { [PROJECT_SKILLS_ENV]: project === 'all' || project === 'none' ? project : project.join(',') } : {}),
  }
}

/**
 * How the run gets its name: not at all, where runs are not named; from the ask of whoever starts
 * it, handed over in a file its process waits on (`title.ts`); or by asking itself.
 */
function nameHandOver(title: RunRequest['title']): { env: Record<string, string>; started: () => void } {
  if (title === false) return { env: { OPENAGENT_NAME_RUN: '0' }, started: () => {} }
  if (title === undefined) return { env: {}, started: () => {} }
  const file = join(tmpdir(), `openagent-name-${randomUUID()}.json`)
  return { env: { [NAME_FILE_ENV]: file }, started: () => void title.then(name => handName(file, name), () => handName(file, undefined)) }
}

/**
 * Hand the run the name asked for it: written whole, then renamed into place, so the run never
 * reads half of one. `{}` when none came: the run asks on its own then.
 */
async function handName(file: string, title: string | undefined): Promise<void> {
  await writeFile(`${file}.part`, JSON.stringify(title !== undefined ? { title } : {}))
    .then(() => rename(`${file}.part`, file))
    .catch(() => {})
  setTimeout(() => void rm(file, { force: true }).catch(() => {}), HANDED_NAME_KEPT_MS).unref()
}

/** What a line left in the inbox resumes the run with: the message, with how far it takes the work from there, or the answer. */
function inputOf(line: PromptLine): RunInput {
  if (line.kind === 'answer') return { answer: line.answer }
  const publish = line.publish
  return { text: line.text, ...(publish !== undefined && (isPublish(publish) || publish === NO_PUBLISH) ? { publish } : {}) }
}

/** A run's record, as a host lists it. */
function summaryOf(card: RunCard, project: ProjectRef | undefined): RunSummary {
  const status: RunStatus = card.status === 'running' ? 'working' : card.status
  return {
    id: card.id,
    ...(project ? { project: project.id } : {}),
    status,
    startedAt: card.startedAt,
    ...(card.endedAt !== undefined ? { endedAt: card.endedAt } : {}),
    ...(card.title !== undefined ? { title: card.title } : {}),
    prompt: card.intent ?? '',
  }
}
