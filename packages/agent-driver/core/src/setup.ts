import { spawn } from 'node:child_process'
import type { DriverFix, DriverReadiness, PersonalSetup, RunAgent } from '@openagt/hooks'
import { codingAgents } from './agents.js'
import { hasAddedAccount } from './accounts/accounts.js'

// Whether each coding agent can run on this computer (`RunAgent.ready`): installed, logged in,
// and what a press does about what is missing. An agent whose program is missing is installed by
// the command its package declared, never one a page sent, run here to its end while the page
// follows it; an agent with no account gets one in the accounts' own window.

/** How a coding agent's CLI is on this computer, and what a press does about what is missing. */
export interface AgentState {
  /** The agent, by the id a run's options name it by. */
  agent: string
  /** Its name for a person: `Claude Code`. */
  label: string
  /** Its accounts' list, where it has one: what an account is added to. */
  list?: string
  /** Installed and logged in, or it could not say otherwise. */
  ready: boolean
  /** What is in the way, in words. */
  problem?: string
  /** What a press does about it, when the agent's package declared a command for it. */
  fix?: DriverFix
  /** The agent's own login is out, and runs use an added account: the own login is no account to show. */
  ownLoggedOut?: true
  /** The install a press started, going on. */
  fixing?: 'install'
  /** Why the last press's install failed. */
  failed?: string
}

/** What the states are read with, swapped in tests. */
export interface SetupDeps {
  agents: () => Promise<readonly RunAgent[]>
  /** Run an install's command to its end. Rejects with its last lines. */
  install: (command: string) => Promise<void>
  now: () => number
}

/** The person's own setup, whole: whether an agent can run says nothing of what a run keeps of it. */
const OWN_SETUP: PersonalSetup = { memory: true, connectors: true, skills: true }

/** How long a state is kept: each read starts the agent's CLI, and every place that shows one asks every few seconds. */
const KEPT_MS = 5_000

export const setupWiring: SetupDeps = {
  agents: () => codingAgents(),
  install: runInstall,
  now: Date.now,
}

/** The installs under way, and the last one that failed, by agent. */
const installs = new Map<string, { fixing?: 'install'; failed?: string }>()

/** The readiness each agent last said, and when. */
const kept = new Map<string, { at: number; ready: Promise<DriverReadiness> }>()

/** What `agent` says would stop a run on it here: asked now, or less than a few seconds ago. */
function readinessOf(agent: RunAgent): Promise<DriverReadiness> {
  const now = setupWiring.now()
  const was = kept.get(agent.id)
  if (was && now - was.at < KEPT_MS && now >= was.at) return was.ready
  const ready = agent.ready({ personal: OWN_SETUP, addedAccount: agent.accounts !== undefined && hasAddedAccount(agent.accounts.list) })
  kept.set(agent.id, { at: now, ready })
  ready.catch(() => kept.delete(agent.id))
  return ready
}

/** The state of one coding agent. */
export async function agentState(agent: RunAgent): Promise<AgentState> {
  const ready = await readinessOf(agent)
  const press = installs.get(agent.id)
  return {
    agent: agent.id,
    label: agent.label,
    ...(agent.accounts ? { list: agent.accounts.list } : {}),
    ready: ready.problems.length === 0,
    ...(ready.problems[0] !== undefined ? { problem: ready.problems[0] } : {}),
    ...(ready.fix ? { fix: ready.fix } : {}),
    ...(ready.ownLoggedOut ? { ownLoggedOut: true as const } : {}),
    ...(press?.fixing ? { fixing: press.fixing } : {}),
    ...(press?.failed !== undefined && ready.problems.length > 0 ? { failed: press.failed } : {}),
  }
}

/** The state of every coding agent of the distribution, in its order. */
export async function agentStates(): Promise<AgentState[]> {
  return Promise.all((await setupWiring.agents()).map(agentState))
}

/**
 * Install `id`'s program, with the command its package declared, run here to its end. Answers at
 * once; the page follows it in {@link agentState}. An agent that is installed and has no account
 * gets one in the accounts' window, not here.
 */
export async function installAgent(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const agent = (await setupWiring.agents()).find(one => one.id === id)
  if (!agent) return { ok: false, error: `No coding agent ${id}.` }
  if (installs.get(id)?.fixing) return { ok: false, error: 'It is being installed: wait for it to end.' }
  kept.delete(id)
  const fix = (await readinessOf(agent)).fix
  if (fix?.kind !== 'install') return { ok: false, error: 'Nothing to install: see the line it says.' }
  installs.set(id, { fixing: 'install' })
  void setupWiring.install(fix.command).then(
    () => void installs.delete(id),
    (err: unknown) => void installs.set(id, { failed: err instanceof Error ? err.message : String(err) }),
  ).finally(() => kept.delete(id))
  return { ok: true }
}

/** Forget every state and install: for tests. */
export function forgetSetup(): void {
  installs.clear()
  kept.clear()
}

/** How long an install may take. */
const INSTALL_MS = 10 * 60_000

/** The process groups of the installs running now. */
const installGroups = new Set<number>()

/** End the installs running now, as the dashboard stops: nothing else would, once it is gone. */
export function endInstalls(): void {
  for (const group of installGroups) endGroup(group, 'SIGTERM')
}

function endGroup(group: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-group, signal)
  } catch {
    // Gone already.
  }
}

/** An install's command in a shell, to its end, its own group ended with it on a timeout. An installer is a download piped to a shell: `pipefail`, so a failed download fails the install, in bash where it is on the PATH (an `sh` may lack the option), else in an `sh` that has it. */
function runInstall(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // `command` keeps an `sh` without `pipefail` running: a special built-in's error would end it.
    const script = `command -v bash >/dev/null && exec bash -o pipefail -c "$1"\ncommand set -o pipefail 2>/dev/null\neval "$1"`
    const child = spawn('sh', ['-c', script, 'sh', command], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const group = child.pid
    if (group !== undefined) installGroups.add(group)
    let said = ''
    const keep = (chunk: Buffer): void => {
      said = (said + chunk.toString('utf8')).slice(-4096)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const timer = setTimeout(() => endGroup(group!, 'SIGKILL'), INSTALL_MS)
    child.once('error', err => (clearTimeout(timer), reject(err)))
    child.once('close', code => {
      clearTimeout(timer)
      if (group !== undefined) installGroups.delete(group)
      if (code === 0) resolve()
      else reject(new Error(said.trim().split('\n').slice(-3).join('\n') || (code === null ? 'It took too long, and was stopped.' : `It ended with ${code}.`)))
    })
  })
}
