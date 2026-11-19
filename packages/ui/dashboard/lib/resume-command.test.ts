import { describe, expect, test } from 'vitest'
import { buildResumeCommand } from './resume-command.js'

describe('buildResumeCommand (#1195)', () => {
  test('recreates the directory before resuming, since the worktree is usually gone', () => {
    const cmd = buildResumeCommand({ sessionId: 'sess-1', workspace: '/repo/.openagent/worktrees/run-1' })
    // The mkdir is the load-bearing part: the CLI matches a session by the cwd it ran in, so
    // without the path existing again `--resume` cannot find it.
    expect(cmd).toBe(
      "mkdir -p '/repo/.openagent/worktrees/run-1' && cd '/repo/.openagent/worktrees/run-1' && claude --resume sess-1",
    )
  })

  test('quotes a workspace path containing spaces or quotes', () => {
    // The repo lives wherever the user keeps it — `/Users/John Doe/…` must survive the shell.
    expect(buildResumeCommand({ sessionId: 's', workspace: "/Users/John Doe/it's" })).toBe(
      `mkdir -p '/Users/John Doe/it'\\''s' && cd '/Users/John Doe/it'\\''s' && claude --resume s`,
    )
  })

  test('falls back to the bare id when no workspace was recorded', () => {
    // An older agent, or one that never opened a session: the id is still worth handing over.
    expect(buildResumeCommand({ sessionId: 'sess-1' })).toBe('sess-1')
  })

  test('has nothing to offer without a session id', () => {
    expect(buildResumeCommand({ workspace: '/repo' })).toBeNull()
    expect(buildResumeCommand(null)).toBeNull()
    expect(buildResumeCommand(undefined)).toBeNull()
  })
})
