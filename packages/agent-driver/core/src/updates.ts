import { execFile } from 'node:child_process'
import type { RunAgent } from '@openagt/hooks'
import { codingAgents } from './agents.js'

// Whether a coding agent on this computer is behind its newest version: the version its program
// says, against the one npm's `latest` names for its package (`RunAgent.program`). Each agent
// updates itself by its own `update` command, which takes the way it was installed (its own
// installer, npm, a package manager), so nothing here guesses that.

/** How long a reading is kept: a new version comes out every few days, and each reading asks npm. */
export const KEEP_MS = 12 * 60 * 60_000

/** How long an agent's `update` may take: it downloads the new version. */
const UPDATE_TIMEOUT_MS = 5 * 60_000

/** A coding agent with a newer version out than the one on this computer. */
export interface AgentUpdate {
  /** The agent, by its id. */
  agent: string
  /** Its name for a person: `Claude Code`. */
  label: string
  installed: string
  latest: string
  /** The command it updates itself with, for a person to run in a terminal where the press could not. */
  command: string
  /** Its update is running now, pressed in any tab or on any computer: each says "Updating…". */
  updating?: true
}

/** What an update did: the version now on this computer, or what the agent said when it failed. */
export type AgentUpdateResult = { ok: true; version: string } | { ok: false; error: string }

/** How a program is run: its output, or the error with what it printed. */
export type RunProgram = (bin: string, args: string[], timeoutMs: number) => Promise<string>

export interface AgentUpdatesOptions {
  /** The coding agents of the distribution; an agent updated is asked for its models again, since a new version can offer others. */
  agents?: () => Promise<readonly RunAgent[]>
  run?: RunProgram
  /** The version npm's `latest` names for `pkg`. */
  latest?: (pkg: string) => Promise<string>
  now?: () => number
}

export interface AgentUpdates {
  /** The agents that are behind; one that is not on this computer, or whose versions could not be read, is not. */
  read(): Promise<AgentUpdate[]>
  update(agent: string): Promise<AgentUpdateResult>
}

/** The first version number in what a program said: `2.1.314 (Claude Code)`, `codex-cli 0.166.0`. */
export function versionIn(said: string): string | undefined {
  return /\d+\.\d+\.\d+/.exec(said)?.[0]
}

/** Whether version `a` is newer than `b`, part by part. */
export function newer(a: string, b: string): boolean {
  const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)]
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

const runProgram: RunProgram = (bin, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { said: `${stdout}\n${stderr}`.trim() }))
      else resolve(`${stdout}\n${stderr}`.trim())
    })
    // Nobody types into it: a program that would ask goes on with its default, or says why not.
    child.stdin?.end()
  })

const npmLatest = async (pkg: string): Promise<string> => {
  const answer = await fetch(`https://registry.npmjs.org/${pkg.replace('/', '%2F')}/latest`, { signal: AbortSignal.timeout(15_000) })
  if (!answer.ok) throw new Error(`npm answered ${answer.status}`)
  const version = ((await answer.json()) as { version?: unknown }).version
  if (typeof version !== 'string') throw new Error('npm named no version')
  return version
}

/** The last line a program printed, as what it said of a failure. */
function lastLine(err: unknown): string {
  const said = (err as { said?: unknown }).said
  const line = typeof said === 'string' ? said.split('\n').map(l => l.trim()).filter(Boolean).pop() : undefined
  return line ?? (err instanceof Error ? err.message : String(err))
}

export function agentUpdates(opts: AgentUpdatesOptions = {}): AgentUpdates {
  const agents = opts.agents ?? (() => codingAgents())
  const run = opts.run ?? runProgram
  const latest = opts.latest ?? npmLatest
  const now = opts.now ?? Date.now
  let kept: { at: number; reading: Promise<AgentUpdate[]> } | undefined
  const updating = new Set<string>()

  const readOne = async (agent: RunAgent): Promise<AgentUpdate | undefined> => {
    if (!agent.program) return undefined
    const { bin, npm } = agent.program
    const [installed, newest] = await Promise.all([run(bin, ['--version'], 15_000).then(versionIn, () => undefined), latest(npm).then(versionIn, () => undefined)])
    return installed !== undefined && newest !== undefined && newer(newest, installed) ? { agent: agent.id, label: agent.label, installed, latest: newest, command: `${bin} update` } : undefined
  }

  return {
    read() {
      if (!kept || now() - kept.at >= KEEP_MS) kept = { at: now(), reading: agents().then(all => Promise.all(all.map(readOne))).then(found => found.filter(update => update !== undefined)) }
      return kept.reading.then(found => found.map(update => (updating.has(update.agent) ? { ...update, updating: true as const } : update)))
    },
    async update(id) {
      const agent = (await agents()).find(one => one.id === id)
      if (!agent?.program) return { ok: false, error: 'unknown coding agent' }
      const { bin } = agent.program
      updating.add(id)
      try {
        await run(bin, ['update'], UPDATE_TIMEOUT_MS)
      } catch (err) {
        return { ok: false, error: lastLine(err) }
      } finally {
        updating.delete(id)
        kept = undefined
      }
      await agent.models?.({ fresh: true }).catch(() => undefined)
      const version = await run(bin, ['--version'], 15_000).then(versionIn, () => undefined)
      return version !== undefined ? { ok: true, version } : { ok: false, error: `${bin} --version said no version after the update` }
    },
  }
}

/** This computer's updates, made at their first read and kept for the process's life. */
let here: AgentUpdates | undefined

export function updatesHere(): AgentUpdates {
  return (here ??= agentUpdates())
}
