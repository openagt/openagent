import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, screen, within } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { connectFix, installFix } from './setup.js'

// The presses that fix what agent-driver's attention items say: an agent's install, and the
// window an account is added in.

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
})

const CLAUDE_MISSING = { agent: 'claude-code', label: 'Claude Code', list: 'claude', ready: false, problem: '`claude` not found', fix: { kind: 'install', command: 'curl -fsSL https://claude.ai/install.sh | bash', problem: '`claude` not found' } }
const CODEX_OUT = { agent: 'codex', label: 'Codex', list: 'codex', ready: false, problem: '`codex` is not logged in.', fix: { kind: 'log-in', command: 'codex login', problem: '`codex` is not logged in.' } }

function hostAnswering(answers: Record<string, unknown>) {
  const callComputer = vi.fn(async (name: string, _input: object): Promise<ModuleCallResult> => (name in answers ? { ok: true, output: answers[name] } : { ok: false, error: `no ${name}` }))
  return { host: fakeHost('@openagt/agent-driver', { callComputer }), callComputer }
}

describe('the fixes of the coding agents’ items', () => {
  test('an item about the run to start installs the agent it names, with the command its package declared', async () => {
    const { host, callComputer } = hostAnswering({ install: { ok: true } })
    expect(await installFix.run!(host, { item: 'agent:claude-code' })).toEqual({ ok: true })
    expect(callComputer).toHaveBeenCalledWith('install', { agent: 'claude-code' })
    expect((await installFix.run!(host, { item: 'connect' })).ok).toBe(false)
  })

  test('the item about this computer opens a window with each agent’s press, the first the primary: an agent not installed installs, one installed adds an account', async () => {
    const { host } = hostAnswering({ states: [CLAUDE_MISSING, CODEX_OUT], adding: {} })
    const Dialog = connectFix.Dialog!
    renderWithHost(<Dialog on={{ item: 'connect' }} onDone={() => {}} />, host)
    const window = await screen.findByRole('dialog', { name: 'Connect a coding agent' })
    expect(await within(window).findByRole('button', { name: 'Install Claude Code' })).toBeTruthy()
    expect(within(window).getByText('curl -fsSL https://claude.ai/install.sh | bash')).toBeTruthy()
    const connect = within(window).getByRole('button', { name: 'Connect Codex' })
    expect(connect.getAttribute('data-variant') ?? connect.className).toMatch(/secondary/)
  })

  test('an item about one agent’s login opens the window its account is added in, at once', async () => {
    const { host } = hostAnswering({ states: [{ ...CLAUDE_MISSING, ready: true }, CODEX_OUT], adding: {} })
    const Dialog = connectFix.Dialog!
    renderWithHost(<Dialog on={{ item: 'agent:codex' }} onDone={() => {}} />, host)
    expect(await screen.findByRole('dialog', { name: 'Add a Codex account' })).toBeTruthy()
  })
})
