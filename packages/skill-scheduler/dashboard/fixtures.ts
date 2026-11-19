import { vi } from 'vitest'
import type { ModuleCommandResult } from '@openagt/ui/module'
import { fakeHost } from '@openagt/ui/module/testing'

// What the module's tests share: a fake dashboard host, and what the command and the server part answer.

/** The words a call is answered by: its name, then its input's words, as the command is asked (`show` with `{ name: 'x' }` is `show x`). */
export const callWords = (name: string, input: object): string[] => [name, ...Object.values(input).filter((value): value is string => typeof value === 'string')]

/** A host whose command and server part answer what `answer` says per project and words: a call by {@link callWords}. */
export function hostAnswering(answer: (projectId: string, args: string[]) => ModuleCommandResult) {
  const runCommand = vi.fn(async (projectId: string, args: string[]) => answer(projectId, args))
  const call = vi.fn(async (projectId: string, name: string, input: object) => answer(projectId, callWords(name, input)))
  const host = fakeHost('@openagt/skill-scheduler', { runCommand, act: runCommand, call })
  return { host, runCommand, call }
}

/** What `status` lists of a row beside what its file says, for a skill that is in Claude Code's folder alone: the coding agent it is made for, and the ones that can run it. */
export const ON_CLAUDE = { agent: 'claude-code', able: ['claude-code'] }

/** The same for an automation kept on this machine, which is no skill: made for Claude Code, and any agent can run it. */
export const ANY_AGENT = { agent: 'claude-code', able: ['claude-code', 'codex'] }

/** What `status` answers for a scheduler that ticked once in a project whose skills schedule two commands: one switched on here, one with a publish pick made here. */
export const STATUS = {
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
