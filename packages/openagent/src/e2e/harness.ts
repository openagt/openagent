// The world behind the backend E2E story tests (see README.md): the daemon's business logic wired
// exactly as `runDaemon` wires it, against throwaway state. Every fixture project's hooks file
// names `fake-run-bin.js` as its start and resume lines, so a Start goes the whole production
// way (the RPC, the hook, a detached run writing the files the dashboard reads) offline.
import { mkdtempSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { PROJECT_HOOKS_FILE } from '../project-hooks.js'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { setDashboardContext } from '../dashboard-rpc/context.js'
import { createProjectRuntime, type ProjectRuntime } from '../daemon-runtime.js'
import { registryPreferencesStore, projectId } from '../registry.js'
import { fromDiaryLine, projectBranches, projectRuns, resolveAgentDiary, type AgentMeta, type AgentStatus, type AnyDiaryLine } from '../store/index.js'
import { withFileBranch, DATA_BRANCH } from '@openagt/agent-data'
import { worktreePath } from '@openagt/skill-branches'
import { TICKETS_DIR } from '@openagt/skill-tickets'
import { QUEUE_FILE } from '@openagt/skill-queue'
import { tailAgentEvents } from '../dashboard-rpc/events-tail.js'
import { sendAddProject } from '../dashboard-rpc/projects.js'
import { sendStart, sendStop } from '../dashboard-rpc/control.js'
import { onAgents } from '../dashboard-rpc/reads.js'
import type { OpenAgentEvent } from '../events.js'
import type { StartAgentOptions } from '../dashboard/types.js'
import type { QuotaView } from '../dashboard/quota.js'

/**
 * The two skills every fixture project holds, by the name of each one's folder, with the package
 * whose text it is, read from this workspace's own install: the tickets and the queue. Holding a
 * skill's text is what gives a project that skill's package in the dashboard.
 */
const packageDir = (name: string): string => resolve(dirname(fileURLToPath(import.meta.resolve(name))), '..')
const SKILL_PACKAGES: Record<string, string> = {
  tickets: packageDir('@openagt/skill-tickets'),
  queue: packageDir('@openagt/skill-queue'),
}

// Re-home the process-global config home FIRST: the registry, preferences, and daemon state all
// resolve through $XDG_CONFIG_HOME at call time, and run-tests.mjs gives the whole suite ONE
// shared throwaway home — so without this, story files running as sibling processes would see
// each other's registered projects in every cross-project rollup (onProjects, onQueue, onOverview).
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'openagent-e2e-config-'))

const exec = promisify(execFile)

/** Run `git <args>` in `cwd`, failing the story loudly on error (a broken fixture is a test bug). */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd })
  return stdout
}

/** One registered project inside a {@link StoryWorld}: a real git repo the stories act on. */
export interface StoryProject {
  /** The registry id every dashboard RPC keys by. */
  id: string
  /** The repo's checkout path on disk. */
  cwd: string
}

/** A live tail of one agent's event log — the same source `onEvents` streams to the browser. */
export interface AgentTail {
  /** Every event seen so far, in arrival order. Poll with {@link waitFor}. */
  events: OpenAgentEvent[]
  stop(): void
}

/**
 * Everything one story test stands up: the daemon runtime on a temp home, the dashboard context
 * the daemon would wire, and factories for registered projects. `close()` is the
 * whole teardown — it stops the runs still working, then removes the state.
 */
export interface StoryWorld {
  /** The daemon's home workspace (a plain temp dir, not a registered project). */
  home: string
  runtime: ProjectRuntime
  /** The usage panel's reading (mutable): what `onQuota` serves. */
  quota: { view: QuotaView }
  /**
   * Bind one dashboard RPC to this world's context. The real mount wires the context once, at
   * start-up; a story stands several worlds up in one process, so re-providing before every call
   * is what keeps each story's calls addressing its own world rather than the last one's.
   */
  rpc<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R
  /** What every start and resume hook line of this world was handed in its environment, oldest first. */
  hookCalls(): Promise<HookCall[]>
  /**
   * Create a real git repo (initial commit included) and register it through the same
   * `sendAddProject` RPC the dashboard's Add-project dialog calls.
   */
  addProject(files?: Record<string, string>): Promise<StoryProject>
  /** Start an agent through the same `sendStart` RPC the launcher calls; returns the agent id. */
  startAgent(project: StoryProject, prompt: string, options?: StartAgentOptions): Promise<string>
  /** Poll `onAgents` until the agent reports one of `until`, failing after `timeoutMs`. */
  waitAgent(project: StoryProject, agentId: string, until: AgentStatus | AgentStatus[], timeoutMs?: number): Promise<AgentMeta>
  /**
   * Wait until the run's tool has reclaimed the run's checkout. A run's card says `done` before
   * its tool records it and reclaims the checkout, and acting on the run in that window races
   * the tool's own git commits. The stories that act on a finished run wait here first, which is
   * also the honest reading of "finished".
   */
  waitRetired(project: StoryProject, agentId: string, timeoutMs?: number): Promise<void>
  /**
   * Wait until the run's tool has recorded the run on the data branch. A run's card says how it
   * ended a moment before its record lands there, and for a run that keeps its checkout (one
   * waiting on a question) that moment is the only window in which neither copy is readable — so
   * a story that acts on such a run waits here rather than on the card alone.
   */
  waitRecorded(project: StoryProject, agentId: string, timeoutMs?: number): Promise<void>
  /** Follow an agent's event log live (replays what is already on disk first). */
  tailAgent(project: StoryProject, agentId: string): Promise<AgentTail>
  close(): Promise<void>
}

/** Poll `read` until it yields a non-undefined value; the failure names `what` went unmet. */
export async function waitFor<T>(
  read: () => T | undefined | Promise<T | undefined>,
  what: string,
  timeoutMs = 30_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise(r => setTimeout(r, 100))
  }
}

/** One start or resume hook line's environment, as `fake-run-bin.js` recorded it. */
export interface HookCall {
  hook: 'start' | 'resume'
  id: string
  prompt?: string
  driver?: string
  model?: string
  publish?: string
  base?: string
  text?: string
  answer?: string
}

/** Let a run whose prompt said "hold" go on to its first turn. */
export async function release(project: StoryProject, agentId: string): Promise<void> {
  await writeFile(join(worktreePath(project.cwd, agentId), '.openagent', 'go'), '')
}

/**
 * Stand up one story world. The dashboard context mirrors `runDaemon`'s `startDashboard` wiring
 * piece for piece — same closures, same registry-backed stores — except where the daemon holds a
 * live poller (quota), which a story controls through a mutable stub instead.
 */
export async function makeWorld(): Promise<StoryWorld> {
  const home = mkdtempSync(join(tmpdir(), 'openagent-e2e-home-'))
  const startsFile = join(home, 'hook-calls.jsonl')
  process.env.OPENAGENT_E2E_STARTS_FILE = startsFile
  const fakeRun = fileURLToPath(new URL('./fake-run-bin.js', import.meta.url))

  const runtime = createProjectRuntime({ cwd: home, env: process.env })

  const quota = { view: { windows: [] } as QuotaView }
  const context = {
    startAgent: runtime.onStart,
    addProject: runtime.onAddProject,
    startedIn: runtime.onStartedIn,
    removeProject: runtime.onRemoveProject,
    eventsSource: runtime.remoteEventsSource,
    remote: runtime.remoteAgents,
    preferences: registryPreferencesStore(),
    // The story sets one view; both questions are answered off it, since a story that cares about
    // the model's own week states that window in the view it sets (#1619).
    quota: { read: async () => quota.view, stop: () => {} },
    // No story reads the menu, and none may start a coding agent's CLI to ask.
    models: { read: async () => ({ 'claude-code': { models: [] as [] }, codex: { models: [] as [] } }) },
    projectErrors: () => ({ errors: [] }),
    bridgeBrowser: { status: async () => ({ state: 'off' as const }), start: async () => {}, stop: async () => {}, act: async () => {} },
  }

  const repos: string[] = []
  const tails: AgentTail[] = []
  const started: Array<{ project: StoryProject; agentId: string }> = []

  const rpc: StoryWorld['rpc'] = fn => {
    return (...args) => {
      // Re-wired per call so a story's own overrides win over whatever ran before it.
      setDashboardContext(context)
      return fn(...args)
    }
  }

  const world: StoryWorld = {
    home,
    runtime,
    quota,
    rpc,

    async hookCalls() {
      const raw = await readFile(startsFile, 'utf8').catch(() => '')
      return raw
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as HookCall)
    },

    async addProject(files = {}) {
      const cwd = mkdtempSync(join(tmpdir(), 'openagent-e2e-repo-'))
      repos.push(cwd)
      await git(cwd, 'init', '-q', '-b', 'main')
      await git(cwd, 'config', 'user.email', 'e2e@test')
      await git(cwd, 'config', 'user.name', 'e2e')
      const seeded = Object.keys(files).length ? files : { 'README.md': '# story fixture\n' }
      // The tickets and the queue live on the `agent-data` branch (#1748), never in the working
      // tree: a story that seeds them names the same paths, and they land where the product reads.
      const onBranch = Object.entries(seeded).filter(([file]) => file.startsWith(`${TICKETS_DIR}/`) || file === QUEUE_FILE)
      for (const [file, text] of Object.entries(seeded)) {
        if (onBranch.some(([f]) => f === file)) continue
        await mkdir(dirname(join(cwd, file)), { recursive: true })
        await writeFile(join(cwd, file), text)
      }
      // The project keeps its tickets and queue the way a real one does: it holds the two skills'
      // texts, so the dashboard brings their packages to it; its runs and checkouts come from the
      // packages every project has.
      for (const [skill, pkg] of Object.entries(SKILL_PACKAGES)) {
        await mkdir(join(cwd, '.claude', 'skills', skill), { recursive: true })
        await copyFile(join(pkg, 'SKILL.md'), join(cwd, '.claude', 'skills', skill, 'SKILL.md'))
      }
      await git(cwd, 'add', '-A')
      await git(cwd, 'commit', '-q', '-m', 'seed')
      if (onBranch.length) {
        const result = await withFileBranch(cwd, DATA_BRANCH, 'seed', async dir => {
          for (const [file, text] of onBranch) {
            await mkdir(dirname(join(dir, file)), { recursive: true })
            await writeFile(join(dir, file), text)
          }
        })
        if (!result.ok) throw new Error(`could not seed the ${DATA_BRANCH} branch: ${result.error}`)
      }
      // A bare repo standing in for `origin`, because a real project has one: an agent's branch
      // starts from its default branch, and whether a run's work reached it is what a story reads.
      const origin = join(cwd, 'origin.git')
      await git(cwd, 'init', '-q', '--bare', origin)
      await git(cwd, 'remote', 'add', 'origin', origin)
      const added = await rpc(sendAddProject)(cwd, true)
      if (!added.ok) throw new Error(`could not register the fixture repo: ${added.error}`)
      // The project's own start and resume lines: this machine's file, under the ignored directory.
      await writeFile(join(cwd, PROJECT_HOOKS_FILE), `start: node ${JSON.stringify(fakeRun)} start\nresume: node ${JSON.stringify(fakeRun)} resume\n`)
      return { id: projectId(resolve(cwd)), cwd }
    },

    async startAgent(project, prompt, options = {}) {
      const result = await rpc(sendStart)(project.id, prompt, options)
      if (!result.ok) throw new Error(`sendStart refused: ${result.error}`)
      started.push({ project, agentId: result.agentId })
      return result.agentId
    },

    async waitAgent(project, agentId, until, timeoutMs = 30_000) {
      const wanted = Array.isArray(until) ? until : [until]
      let last: AgentMeta | undefined
      return waitFor(
        async () => {
          const agents = await rpc(onAgents)(project.id)
          last = agents.find(agent => agent.id === agentId)
          return last && wanted.includes(last.status) ? last : undefined
        },
        `run ${agentId} to be ${wanted.join('/')} (last seen: ${JSON.stringify(last?.status)})`,
        timeoutMs,
      )
    },

    async waitRetired(project, agentId, timeoutMs = 30_000) {
      // Through the product's own read of the checkouts, the branches provider's list shared for a
      // few seconds (#1774): what a story asserts or acts on next reads the same list, so "retired"
      // means gone from there, not merely gone from disk.
      await waitFor(
        async () => ((await (await projectBranches(project.cwd))?.list().catch(() => []))?.some(checkout => checkout.id === agentId) ? undefined : true),
        `run ${agentId}'s worktree to be retired`,
        timeoutMs,
      )
    },

    async waitRecorded(project, agentId, timeoutMs = 30_000) {
      await waitFor(
        async () => ((await (await projectRuns(project.cwd))?.show(agentId)) ? true : undefined),
        `run ${agentId} to be recorded on the data branch`,
        timeoutMs,
      )
    },

    async tailAgent(project, agentId) {
      const events: OpenAgentEvent[] = []
      // The relocating tail — the same seam the dashboard's onEvents rides: when the run's tool
      // records the run and reclaims the checkout, the tail asks again and sends the finished run's
      // lines it had not sent, so the feed keeps the final lines even when their fs.watch signal was lost.
      const stop = tailAgentEvents<AnyDiaryLine>(
        () => resolveAgentDiary(project.cwd, agentId),
        line => {
          const event = fromDiaryLine(line)
          if (event) events.push(event)
        },
      )
      const tail = { events, stop }
      tails.push(tail)
      return tail
    },

    async close() {
      for (const tail of tails) tail.stop()
      // A run is its own process and outlives the story: one still working is stopped the way
      // the Stop button stops it, and waited out, so no git of its own runs under the `rm` below.
      for (const { project, agentId } of started) {
        await rpc(sendStop)(project.id, agentId)
        await waitFor(
          async () => ((await rpc(onAgents)(project.id)).find(agent => agent.id === agentId)?.status === 'running' ? undefined : true),
          `run ${agentId} to end`,
          10_000,
        ).catch(() => {})
      }
      await runtime.dispose().catch(() => {})
      delete process.env.OPENAGENT_E2E_STARTS_FILE
      await rm(home, { recursive: true, force: true }).catch(() => {})
      for (const repo of repos) await rm(repo, { recursive: true, force: true }).catch(() => {})
    },
  }
  return world
}
