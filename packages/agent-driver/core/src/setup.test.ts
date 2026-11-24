import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DriverReadiness, RunAgent, RunAgentReadyOptions } from '@openagt/hooks'
import { accountsPath, addAccount } from './accounts/accounts.js'
import { agentState, agentStates, endInstalls, forgetSetup, installAgent, setupWiring } from './setup.js'

/** The real way an install runs, before a test swaps it. */
const realInstall = setupWiring.install

/** A coding agent whose readiness is `ready`, each question it is asked written down. */
function agent(id: string, ready: () => DriverReadiness, asked: RunAgentReadyOptions[] = []): RunAgent {
  return {
    id,
    label: id === 'codex' ? 'Codex' : 'Claude Code',
    accounts: { list: id === 'codex' ? 'codex' : 'claude' } as NonNullable<RunAgent['accounts']>,
    ready: async opts => (asked.push(opts), ready()),
    driver: () => ({}) as never,
  }
}

/** Run `body` with the agents and the install swapped, every state forgotten before and after. */
async function withSetup(agents: RunAgent[], install: (command: string) => Promise<void>, body: () => Promise<void>): Promise<void> {
  const before = { ...setupWiring }
  let now = 0
  Object.assign(setupWiring, { agents: async () => agents, install, now: () => (now += 10_000) })
  forgetSetup()
  try {
    await body()
  } finally {
    Object.assign(setupWiring, before)
    forgetSetup()
  }
}

test('the agent: what is in the way and the fix its package declared; a press runs its install, never a command from the page, and says why it failed', async () => {
  const INSTALL = { kind: 'install' as const, command: 'curl -fsSL https://claude.ai/install.sh | bash', problem: '`claude` not found' }
  let ready = false
  const ran: string[] = []
  let finish: (err?: Error) => void = () => {}
  const claude = agent('claude-code', () => (ready ? { problems: [], warnings: [] } : { problems: ['`claude` not found'], warnings: [], fix: INSTALL }))
  const install = (command: string) => {
    ran.push(command)
    return new Promise<void>((resolve, reject) => {
      finish = err => (err ? reject(err) : resolve())
    })
  }
  await withSetup([claude], install, async () => {
    assert.deepEqual(await agentState(claude), { agent: 'claude-code', label: 'Claude Code', list: 'claude', ready: false, problem: '`claude` not found', fix: INSTALL })
    assert.equal((await installAgent('claude-code')).ok, true)
    assert.equal((await agentState(claude)).fixing, 'install')
    assert.equal((await installAgent('claude-code')).ok, false, 'one at a time')
    finish(new Error('curl: (6) Could not resolve host: claude.ai'))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal((await agentState(claude)).failed, 'curl: (6) Could not resolve host: claude.ai')
    assert.deepEqual(ran, [INSTALL.command])
    ready = true
    assert.deepEqual(await agentStates(), [{ agent: 'claude-code', label: 'Claude Code', list: 'claude', ready: true }])
    assert.deepEqual(await installAgent('claude-code'), { ok: false, error: 'Nothing to install: see the line it says.' })
    assert.equal((await installAgent('rm -rf')).ok, false)
  })
})

test('an agent that is installed and has no account is no press here: its log-in is said, and never run', async () => {
  const ran: string[] = []
  const fix = { kind: 'log-in' as const, command: 'codex login', problem: '`codex` is not logged in.' }
  const codex = agent('codex', () => ({ problems: ['`codex` is not logged in.'], warnings: [], fix }))
  await withSetup([codex], async command => void ran.push(command), async () => {
    assert.deepEqual(await agentState(codex), { agent: 'codex', label: 'Codex', list: 'codex', ready: false, problem: '`codex` is not logged in.', fix })
    assert.deepEqual(await installAgent('codex'), { ok: false, error: 'Nothing to install: see the line it says.' })
    assert.deepEqual(ran, [])
  })
})

test("an agent is asked whether an account was added to its own list: with the CLI logged out, that account is a login runs use", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-ready-'))
  const before = process.env['XDG_CONFIG_HOME']
  const asked: RunAgentReadyOptions[] = []
  const claude = agent('claude-code', () => ({ problems: [], warnings: [] }), asked)
  try {
    process.env['XDG_CONFIG_HOME'] = dir
    await withSetup([claude], async () => {}, async () => {
      await agentState(claude)
      addAccount('Dani', 'x', accountsPath('claude'))
      await agentState(claude)
      addAccount('Dani', 'codex-dani', accountsPath('codex'))
      assert.deepEqual(asked.map(one => one.addedAccount), [false, true])
    })
  } finally {
    if (before === undefined) delete process.env['XDG_CONFIG_HOME']
    else process.env['XDG_CONFIG_HOME'] = before
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an install started here ends as the app stops, with what it started: nothing of it outlives the dashboard', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-fix-'))
  const said = join(dir, 'pid')
  try {
    const fixing = realInstall(`sleep 60 & echo $! > ${said}; wait`)
    const pidOf = (): number => {
      try {
        return Number(readFileSync(said, 'utf8'))
      } catch {
        return 0
      }
    }
    let sleeper = pidOf()
    while (!sleeper) {
      await new Promise(resolve => setTimeout(resolve, 20))
      sleeper = pidOf()
    }
    endInstalls()
    await assert.rejects(fixing)
    const alive = (): boolean => {
      try {
        process.kill(sleeper, 0)
        return true
      } catch {
        return false
      }
    }
    for (let tries = 0; alive() && tries < 40; tries++) await new Promise(resolve => setTimeout(resolve, 50))
    assert.equal(alive(), false, 'the sleep the install started is gone')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an install whose download fails fails, with what the download said, though the shell it is piped to read nothing, and on an sh without pipefail', async () => {
  const download = `sh -c 'echo "curl: (6) Could not resolve host: chatgpt.com" >&2; exit 6' | sh`
  await assert.rejects(realInstall(download), { message: 'curl: (6) Could not resolve host: chatgpt.com' })
  // An `sh` without `pipefail`, as Debian 12's and Ubuntu 22.04's are: bash with its `set` turned off, first on the PATH.
  const dir = mkdtempSync(join(tmpdir(), 'oa-fix-'))
  const path = process.env.PATH
  try {
    writeFileSync(join(dir, 'no-set'), 'unset BASH_ENV\nenable -n set\n')
    writeFileSync(join(dir, 'sh'), `#!/bin/bash\nBASH_ENV=${join(dir, 'no-set')} exec "$BASH" "$@"\n`, { mode: 0o755 })
    process.env.PATH = `${dir}:${path}`
    assert.equal(execFileSync('sh', ['-c', 'command set -o pipefail 2>/dev/null || echo none'], { encoding: 'utf8' }), 'none\n')
    await assert.rejects(realInstall(download), { message: 'curl: (6) Could not resolve host: chatgpt.com' })
  } finally {
    process.env.PATH = path
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an install needs no bash: on a computer with only sh, its command runs there', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-fix-'))
  const path = process.env.PATH
  try {
    symlinkSync('/bin/sh', join(dir, 'sh'))
    writeFileSync(join(dir, 'codex'), '#!/bin/sh\necho logged-in\n', { mode: 0o755 })
    process.env.PATH = dir
    await realInstall('codex login')
  } finally {
    process.env.PATH = path
    rmSync(dir, { recursive: true, force: true })
  }
})
