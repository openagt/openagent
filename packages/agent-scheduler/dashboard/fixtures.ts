import { vi } from 'vitest'
import type { ModuleCommandResult, ModuleHost } from '@openagt/dashboard/module'

// What the module's tests share: a fake dashboard host, and what the command prints.

/** A host whose command answers what `answer` says per project and arguments. */
export function hostAnswering(answer: (projectId: string, args: string[]) => ModuleCommandResult) {
  const runCommand = vi.fn(async (projectId: string, args: string[]) => answer(projectId, args))
  const host: ModuleHost = {
    package: '@openagt/agent-scheduler',
    runCommand,
    act: runCommand,
    runComputerCommand: vi.fn(async () => ({ ok: false as const, error: 'not the computer\'s' })),
    read: vi.fn(async () => ({ ok: false as const, error: 'no server part' })),
    openAgent: vi.fn(),
    openPage: vi.fn(),
    pageHref: (segment: string) => `/${segment}`,
    startRun: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    configureRun: vi.fn(),
    agents: vi.fn(async () => []),
    machines: vi.fn(async () => ({ version: '0.0.0', machines: [] })),
    addMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    removeMachine: vi.fn(async () => ({ ok: false as const, error: 'not here' })),
    watchScreen: vi.fn(async () => undefined),
    sendToScreen: vi.fn(async () => false),
  }
  return { host, runCommand }
}

/** What `status` lists of a row beside what its file says, for a skill that is in Claude Code's folder alone: the coding agent it is made for, and the ones that can run it. */
export const ON_CLAUDE = { agent: 'claude-code', able: ['claude-code'] }

/** The same for an automation kept on this machine, which is no skill: made for Claude Code, and any agent can run it. */
export const ANY_AGENT = { agent: 'claude-code', able: ['claude-code', 'codex'] }

/** What `agent-scheduler status` prints for a scheduler that ticked once in a project whose skills schedule two commands: one switched on here, one with a publish pick made here. */
export const STATUS = {
  ok: true,
  on: true,
  keepAlive: false,
  model: 'opus',
  spendOffset: 7,
  running: true,
  pid: 4242,
  switches: { 'post-merge-cleanup': '2026-10-03T08:00:00.000Z' },
  publishes: { 'work-queue': 'nothing' },
  lastTick: {
    at: '2026-10-03T10:00:00.000Z',
    decisions: [
      { command: 'post-merge-cleanup', outcome: 'started 2026-10-03T10-00-00-000Z', run: '2026-10-03T10-00-00-000Z' },
      { command: 'work-queue', outcome: 'switched off on this machine' },
    ],
  },
  // The schedule as the project's files say it at the moment of the answer, and what of it cannot be read: not the last tick's.
  schedule: [
    { command: 'post-merge-cleanup', every: '1d', description: 'Write up merged pull requests.', ...ON_CLAUDE },
    { command: 'work-queue', when: 'npx queue', waitsFor: 'when the queue holds a task', description: 'Work one queued task.', ...ON_CLAUDE },
  ],
  unreadable: [],
}
