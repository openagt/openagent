// The world behind the backend E2E story tests (see README.md): the daemon's business logic wired
// exactly as `runDaemon` wires it, against throwaway state, on the scripted host (`fake-runs.ts`),
// so a Start goes the whole production way (the RPC, the host, a detached run writing the files
// the dashboard reads) offline.
import { mkdtempSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DISTRIBUTION_ENV, type RunEvent } from '@openagt/hooks'
import { setDashboardContext } from '../dashboard-rpc/context.js'
import { createProjectRuntime, type ProjectRuntime } from '../daemon-runtime.js'
import { projectId } from '../project-id.js'
import { registryPreferencesStore } from '../registry.js'
import type { AgentMeta, AgentStatus } from '../store/index.js'
import { findRun } from '@openagt/agent-driver'
import { worktreePath } from '@openagt/git-branches'
import { FIXTURE_PLUGINS, makeFixtureRepo } from './fixture.js'
import { fakeRunHost, STARTS_FILE_ENV, type HostCall } from './fake-runs.js'
import { streamAgentEvents } from '../dashboard-rpc/events.js'
import { callModule } from '../dashboard-rpc/module-calls.js'
import { sendSwitchPlugin } from '../dashboard-rpc/plugins.js'
import { sendStart, sendStop } from '../dashboard-rpc/control.js'
import { onAgents, onRunCheckout } from '../dashboard-rpc/reads.js'
import type { StartAgentOptions } from '../dashboard/types.js'

export { git } from './fixture.js'

// Re-home the process-global config home FIRST: the registry, preferences, and daemon state all
// resolve through $XDG_CONFIG_HOME at call time, and scripts/test-node.mjs gives the whole suite ONE
// shared throwaway home — so without this, story files running as sibling processes would see
// each other's registered projects in every cross-project rollup (onProjects, onOverview).
process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'openagent-e2e-config-'))

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
  events: RunEvent[]
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
  /**
   * Bind one dashboard RPC to this world's context. The real mount wires the context once, at
   * start-up; a story stands several worlds up in one process, so re-providing before every call
   * is what keeps each story's calls addressing its own world rather than the last one's.
   */
  rpc<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R
  /** What every start and resume of this world was handed, oldest first. */
  hostCalls(): Promise<HostCall[]>
  /**
   * Create a real git repo (initial commit included) and add it through the same function of the
   * projects module (`addProject`) the dashboard's Add-project dialog calls.
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

/** Let a run whose prompt said "hold" go on to its first turn. */
export async function release(project: StoryProject, agentId: string): Promise<void> {
  await writeFile(join(worktreePath(project.cwd, agentId), '.openagent', 'go'), '')
}

/**
 * Stand up one story world. The dashboard context mirrors `runDaemon`'s `startDashboard` wiring
 * piece for piece — same closures, same registry-backed stores.
 */
export async function makeWorld(): Promise<StoryWorld> {
  const home = mkdtempSync(join(tmpdir(), 'openagent-e2e-home-'))
  const startsFile = join(home, 'host-calls.jsonl')
  process.env[STARTS_FILE_ENV] = startsFile
  // The demo's distribution, as its openagent hands it down: the packages the dashboard reads.
  process.env[DISTRIBUTION_ENV] = fileURLToPath(new URL('./distribution.js', import.meta.url))

  const host = fakeRunHost()
  const runtime = createProjectRuntime({ cwd: home, env: process.env, host })

  const context = {
    host,
    // The demo's runs are all this computer's: no host beside it.
    otherHosts: async () => [],
    startAgent: runtime.onStart,
    startedIn: runtime.onStartedIn,
    preferences: registryPreferencesStore(),
    openAgentUpdate: { read: async () => undefined },
    projectState: async () => ({ errors: [], notes: [] }),
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
    rpc,

    async hostCalls() {
      const raw = await readFile(startsFile, 'utf8').catch(() => '')
      return raw
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line) as HostCall)
    },

    async addProject(files = {}) {
      const cwd = mkdtempSync(join(tmpdir(), 'openagent-e2e-repo-'))
      repos.push(cwd)
      await makeFixtureRepo(cwd, files)
      const adding = await rpc(callModule)(null, '@openagt/projects', 'addProject', { path: cwd })
      const added = adding.ok ? (adding.output as { ok: boolean; error?: string }) : adding
      if (!added.ok) throw new Error(`could not add the fixture repo: ${added.error}`)
      const id = projectId(resolve(cwd))
      // Its records go to its remote, as a team's do.
      const sharing = await rpc(callModule)(id, '@openagt/store-git-branch', 'share', { on: true })
      const shared = sharing.ok ? (sharing.output as { ok: boolean; error?: string }) : sharing
      if (!shared.ok) throw new Error(`could not share the fixture repo's records: ${shared.error}`)
      for (const plugin of FIXTURE_PLUGINS) {
        const switched = await rpc(sendSwitchPlugin)(plugin, true, id)
        if (!switched.ok) throw new Error(`could not switch ${plugin} on in the fixture repo: ${switched.error}`)
      }
      return { id, cwd }
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
      // Through the product's own read of the run's checkout, as its host finds it: what a story
      // asserts or acts on next reads the same, so "retired" means gone from there.
      await waitFor(
        async () => ((await onRunCheckout(project.id, agentId)) === null ? true : undefined),
        `run ${agentId}'s worktree to be retired`,
        timeoutMs,
      )
    },

    async waitRecorded(project, agentId, timeoutMs = 30_000) {
      await waitFor(
        async () => ((await findRun(project.cwd, agentId).catch(() => undefined)) ? true : undefined),
        `run ${agentId} to be recorded on the data branch`,
        timeoutMs,
      )
    },

    async tailAgent(project, agentId) {
      const events: RunEvent[] = []
      // The stream the dashboard's `GET /_rpc/events` relays, as the run's host says it: across the
      // run's records and the reclaim of its checkout, so the feed keeps the final lines even when
      // their fs.watch signal was lost.
      const stopping = streamAgentEvents(project.id, agentId, event => {
        if (event.kind !== 'stream-sync' && event.kind !== 'partial') events.push(event)
      })
      const tail = { events, stop: () => void stopping.then(stop => stop?.()) }
      tails.push(tail)
      return tail
    },

    async close() {
      for (const tail of tails) tail.stop()
      // A run is its own process and outlives the story: one still working is stopped the way
      // the Stop button stops it, and waited out, so no git of its own runs under the `rm` below.
      for (const { project, agentId } of started) {
        const working = async () => (await rpc(onAgents)(project.id)).find(agent => agent.id === agentId)?.status === 'running'
        if (!(await working())) continue
        await rpc(sendStop)(project.id, agentId)
        await waitFor(
          async () => ((await working()) ? undefined : true),
          `run ${agentId} to end`,
          10_000,
        ).catch(() => {})
      }
      delete process.env[STARTS_FILE_ENV]
      await rm(home, { recursive: true, force: true }).catch(() => {})
      for (const repo of repos) await rm(repo, { recursive: true, force: true }).catch(() => {})
    },
  }
  return world
}
