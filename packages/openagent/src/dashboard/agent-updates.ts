import { execFile } from 'node:child_process'
import { DRIVERS, type DriverName } from '../driver-names.js'
import type { ModelsSource } from './models.js'

// Whether a coding agent on this computer is behind its newest version: the version its program
// says, against the one npm's `latest` names for its package. Each agent updates itself by its own
// `update` command, which takes the way it was installed (its own installer, npm, a package
// manager), so nothing here guesses that.

/** Each coding agent's program, and the npm package its versions come out under. */
const CLIS: Record<DriverName, { bin: string; pkg: string }> = {
  'claude-code': { bin: 'claude', pkg: '@anthropic-ai/claude-code' },
  codex: { bin: 'codex', pkg: '@openai/codex' },
}

/** How long a reading is kept: a new version comes out every few days, and each reading asks npm. */
export const KEEP_MS = 12 * 60 * 60_000

/** How long an agent's `update` may take: it downloads the new version. */
const UPDATE_TIMEOUT_MS = 5 * 60_000

/** A coding agent with a newer version out than the one on this computer. */
export interface AgentUpdate {
  agent: DriverName
  installed: string
  latest: string
}

/** What an update did: the version now on this computer, or what the agent said when it failed. */
export type AgentUpdateResult = { ok: true; version: string } | { ok: false; error: string }

/** How a program is run: its output, or the error with what it printed. */
export type RunProgram = (bin: string, args: string[], timeoutMs: number) => Promise<string>

export interface AgentUpdatesOptions {
  /** The models each agent offers, as kept: an agent updated is asked again, since a new version can offer others. */
  models: Pick<ModelsSource, 'forget'>
  run?: RunProgram
  /** The version npm's `latest` names for `pkg`. */
  latest?: (pkg: string) => Promise<string>
  now?: () => number
}

export interface AgentUpdates {
  /** The agents that are behind; one that is not on this computer, or whose versions could not be read, is not. */
  read(): Promise<AgentUpdate[]>
  update(agent: DriverName): Promise<AgentUpdateResult>
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

export function agentUpdates(opts: AgentUpdatesOptions): AgentUpdates {
  const run = opts.run ?? runProgram
  const latest = opts.latest ?? npmLatest
  const now = opts.now ?? Date.now
  let kept: { at: number; reading: Promise<AgentUpdate[]> } | undefined

  const readOne = async (agent: DriverName): Promise<AgentUpdate | undefined> => {
    const { bin, pkg } = CLIS[agent]
    const [installed, newest] = await Promise.all([run(bin, ['--version'], 15_000).then(versionIn, () => undefined), latest(pkg).then(versionIn, () => undefined)])
    return installed !== undefined && newest !== undefined && newer(newest, installed) ? { agent, installed, latest: newest } : undefined
  }

  return {
    read() {
      if (!kept || now() - kept.at >= KEEP_MS) kept = { at: now(), reading: Promise.all(DRIVERS.map(readOne)).then(found => found.filter(update => update !== undefined)) }
      return kept.reading
    },
    async update(agent) {
      const { bin } = CLIS[agent]
      try {
        await run(bin, ['update'], UPDATE_TIMEOUT_MS)
      } catch (err) {
        return { ok: false, error: lastLine(err) }
      } finally {
        kept = undefined
      }
      opts.models.forget(agent)
      const version = await run(bin, ['--version'], 15_000).then(versionIn, () => undefined)
      return version !== undefined ? { ok: true, version } : { ok: false, error: `${bin} --version said no version after the update` }
    },
  }
}
