// The run host of the E2E stories and the demo (see README.md): this computer's own host,
// agent-driver's, with its checks, its steering and its Stop, whose runs' processes are
// `fake-run-bin.js` in place of `agent-runner run`. So a Start goes the whole production way (the
// dashboard's call, the host, a detached run writing the files the dashboard reads) offline, and
// only the coding agent is scripted.
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { sessionsHomeOf } from '@openagt/agent-data'
import { localHost, type SpawnedResume, type SpawnedRun } from '@openagt/agent-driver'
import type { ModuleDefinition, RunHost } from '@openagt/hooks'
import { FAKE_RUN } from './fixture.js'

/**
 * Where every start and resume of a world appends what it was handed, one JSON line each, when it
 * is set: the only place a story can see it, the run being detached.
 */
export const STARTS_FILE_ENV = 'OPENAGENT_E2E_STARTS_FILE'

/** What a start or a resume was handed, as {@link STARTS_FILE_ENV} has it. */
export interface HostCall {
  call: 'start' | 'resume'
  id: string
  prompt?: string
  driver?: string
  model?: string
  publish?: string
  base?: string
  text?: string
  answer?: string
  /** The images the prompt or the text went with, by their names. */
  images?: string[]
}

function record(call: HostCall): void {
  const file = process.env[STARTS_FILE_ENV]
  if (file) appendFileSync(file, JSON.stringify(call) + '\n')
}

/** The run's own process, detached, as agent-runner's is: what it does is in its environment. */
function detach(repo: string, args: string[], env: Record<string, string | undefined>): void {
  const defined = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined))
  spawn(process.execPath, [FAKE_RUN, ...args], { cwd: repo, env: { ...process.env, ...defined }, detached: true, stdio: 'ignore' }).unref()
}

async function spawnRun(repo: string, run: SpawnedRun): Promise<void> {
  record({ call: 'start', id: run.id, prompt: run.prompt, ...pick(run, ['driver', 'model', 'publish', 'base']), ...(run.images ? { images: run.images } : {}) })
  // A run its process cannot make: refused before it begins, as a run whose checkout cannot be made is.
  if (run.prompt.includes('refuse')) throw new Error('the project has no such command')
  if ((await sessionsHomeOf(repo)) !== undefined) throw new Error('The scripted runs are runs of a project: start this one in a project.')
  detach(repo, ['run', run.id], { ...run.env, PROMPT: run.prompt, DRIVER: run.driver, MODEL: run.model, PUBLISH: run.publish, IMAGES: run.images?.join(',') })
}

async function spawnResume(repo: string, run: SpawnedResume): Promise<void> {
  record({ call: 'resume', id: run.id, ...pick(run, ['text', 'answer', 'publish']), ...(run.images ? { images: run.images } : {}) })
  detach(repo, ['continue', run.id], { TEXT: run.text, ANSWER: run.answer, PUBLISH: run.publish, IMAGES: run.images?.join(',') })
}

/** The fields of `from` named, those it has. */
function pick<T extends object, K extends keyof T>(from: T, keys: readonly K[]): Partial<Record<K, string>> {
  return Object.fromEntries(keys.filter(key => from[key] !== undefined).map(key => [key, String(from[key])])) as Partial<Record<K, string>>
}

/** This computer's host with the runs scripted: nothing stands in the way of a run, which needs no coding agent's CLI and no login. */
export function fakeRunHost(): RunHost {
  return localHost({ spawnRun, spawnResume, ready: async () => ({ problems: [], warnings: [] }), loginFor: async () => undefined })
}

/** A coding agent's module with its agents scripted as the host's runs are: each can run here, with no CLI and no login to ask. */
export function readyAgents(module: ModuleDefinition): ModuleDefinition {
  const agents = module.hooks['run.agent'] ?? []
  return { ...module, hooks: { ...module.hooks, 'run.agent': agents.map(agent => ({ ...agent, ready: async () => ({ problems: [], warnings: [] }) })) } }
}
