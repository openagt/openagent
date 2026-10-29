import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAccounts } from '@openagt/agent-driver'
import { accountsWiring } from '../dashboard-rpc/accounts.js'
import { copiedWiring } from '../dashboard-rpc/copied-logins.js'
import { RPC_HANDLERS } from '../dashboard-rpc/index.js'
import { allowLogins, localLogins, serverLogins, settleLeft, syncLogins, syncWiring, type LocalLogin } from './logins-sync.js'
import { readCopied } from './copied-logins.js'
import type { MachineRecord, Preferences } from '../registry.js'

// A computer keeps its servers up to its logins: what can go as it is goes with nothing to
// press, what cannot waits for the person's press and is made anew for the server, and what the
// server has that this computer no longer has waits for the person's word. The server here is this
// process's own RPCs, on files of their own.

const LOGIN = `sk-ant-oat01-${'Zx9_-q'.repeat(16)}`
const MINTED = `sk-ant-oat01-${'Mn7_-p'.repeat(16)}`

const machine = (logins: boolean): MachineRecord => ({ id: 'https://203.0.113.5', label: '203.0.113.5', url: 'https://203.0.113.5', key: 'k', door: 'https://203.0.113.5/_devices/enter', ...(logins ? { logins: true as const } : {}) })

interface Rig {
  local: LocalLogin[]
  prefs: Preferences
  patched: unknown[]
  saved: MachineRecord[]
  calls: string[]
  serverPath: (agent: 'claude' | 'codex') => string
}

async function withRig(body: (rig: Rig) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'oa-sync-'))
  const xdg = process.env['XDG_CONFIG_HOME']
  process.env['XDG_CONFIG_HOME'] = dir
  const syncBefore = { ...syncWiring }
  const accountsBefore = { ...accountsWiring }
  const copiedBefore = { ...copiedWiring }
  const serverPath = (agent: 'claude' | 'codex'): string => join(dir, `server-${agent}.json`)
  const rig: Rig = { local: [], prefs: {}, patched: [], saved: [machine(true)], calls: [], serverPath }
  Object.assign(accountsWiring, { path: serverPath, now: () => 0, codexDir: () => join(dir, 'codex') })
  Object.assign(copiedWiring, {
    server: () => true,
    codexDir: () => join(dir, 'codex'),
    gitHost: async (_host: string, args: string[]) => (args[0] === 'take' ? { ok: true, output: { ok: true, login: 'octo' } } : { ok: true, output: { ok: true } }),
  })
  Object.assign(syncWiring, {
    machines: async () => rig.saved,
    facts: async () => ({ server: true }),
    call: async (_machine: unknown, fn: string, args: unknown[]) => {
      rig.calls.push(fn)
      // The server's settings are its own page's: here, only what it was sent.
      if (fn === 'patchPreferences') return (rig.patched.push(args[0]), { ok: true, ret: { ok: true } })
      const handler = RPC_HANDLERS[fn] as ((...args: unknown[]) => Promise<unknown>) | undefined
      return handler ? { ok: true, ret: await handler(...args) } : { ok: false, error: `no ${fn}` }
    },
    local: async () => rig.local,
    usage: async () => [{ kind: 'claude', source: 'own', windows: [{ label: 'week', percent: 62 }], at: 5 }],
    computer: () => 'Suleimans-MacBook-Pro',
    preferences: async () => rig.prefs,
    mint: async () => ({ ok: true, login: MINTED }),
  })
  try {
    await body(rig)
  } finally {
    Object.assign(syncWiring, syncBefore)
    Object.assign(accountsWiring, accountsBefore)
    Object.assign(copiedWiring, copiedBefore)
    if (xdg === undefined) delete process.env['XDG_CONFIG_HOME']
    else process.env['XDG_CONFIG_HOME'] = xdg
    rmSync(dir, { recursive: true, force: true })
  }
}

const own: LocalLogin = { kind: 'claude', source: 'own', name: 'Suleiman', who: 'uuid-1' }
const dani: LocalLogin = { kind: 'claude', source: 'Dani', name: 'Dani', who: 'mark-1', secret: async () => LOGIN }
const octo: LocalLogin = { kind: 'git', host: 'github.com', source: 'octo', name: 'octo', who: 'octo', runs: true, secret: async () => 'gho_token' }

/** Until the press under way has ended. */
async function pressed(): Promise<void> {
  for (let i = 0; i < 100 && (await serverLogins()).some(server => server.allowing); i++) await new Promise(resolve => setTimeout(resolve, 10))
}

test('what can go as it is reaches the server with nothing pressed; the person\'s own Claude login waits for the press, which makes the server one of its own', () =>
  withRig(async rig => {
    rig.local = [own, dani, octo]
    const [server] = await syncLogins()
    assert.deepEqual(server!.logins.map(l => [l.name, l.state]), [['Suleiman', 'allow'], ['Dani', 'there'], ['octo', 'there']])
    assert.deepEqual(readAccounts(rig.serverPath('claude')).map(a => [a.name, a.login]), [['Dani', LOGIN], ['This computer', undefined]])
    // What is there already is not handed over again.
    rig.calls.length = 0
    await syncLogins()
    assert.ok(!rig.calls.includes('sendCopiedLogin'))
    assert.deepEqual(await allowLogins(server!.machineId), { ok: true })
    await pressed()
    assert.deepEqual((await serverLogins())[0]!.logins.map(l => [l.state, l.anew]), [['there', true], ['there', undefined], ['there', undefined]])
    assert.deepEqual(readAccounts(rig.serverPath('claude')).map(a => [a.name, a.login]), [['Dani', LOGIN], ['Suleiman', MINTED], ['This computer', undefined]])
    // How full the person's own login is goes with it: the server's page shows it.
    assert.deepEqual(readCopied().find(l => l.source === 'own')?.usage, { windows: [{ label: 'week', percent: 62 }], at: 5 })
  }))

test('a login that cannot be read here says why, in the words of what was asked for it', () =>
  withRig(async rig => {
    rig.local = [{ ...octo, secret: async () => Promise.reject(new Error("the login gh keeps for octo is octo-agent's on GitHub")) }]
    const [server] = await syncLogins()
    assert.deepEqual(server!.logins, [{ kind: 'git', host: 'github.com', source: 'octo', name: 'octo', state: 'failed', error: "the login gh keeps for octo is octo-agent's on GitHub" }])
  }))

test('a server that is not told to use this computer\'s logins gets none, and a saved machine that is no server is not listed', () =>
  withRig(async rig => {
    rig.local = [dani]
    rig.saved = [machine(false)]
    const [server] = await syncLogins()
    assert.deepEqual([server!.on, server!.logins], [false, []])
    assert.deepEqual(rig.calls, [])
    syncWiring.facts = async () => ({})
    assert.deepEqual(await syncLogins(), [])
  }))

test('another account logged in here under the same one is a switch the person answers: the server keeps the old one meanwhile; one no longer here waits to be kept or taken off', () =>
  withRig(async rig => {
    rig.local = [own, dani]
    const [first] = await syncLogins()
    await allowLogins(first!.machineId)
    await pressed()
    rig.local = [{ ...own, name: 'Work', who: 'uuid-2' }]
    const [after] = await syncLogins()
    assert.deepEqual(after!.logins, [{ kind: 'claude', source: 'own', name: 'Work', anew: true, state: 'switched', was: 'Suleiman' }])
    assert.deepEqual(after!.left, [{ kind: 'claude', source: 'Dani', name: 'Dani' }])
    assert.deepEqual(readAccounts(rig.serverPath('claude')).map(a => a.name), ['Dani', 'Suleiman', 'This computer'])
    // Kept: it is no longer asked about, and stays.
    assert.deepEqual(await settleLeft(after!.machineId, { kind: 'claude', source: 'Dani' }, true), { ok: true })
    assert.deepEqual((await serverLogins())[0]!.left, [])
    // The switch answered with the press: the new account takes the old one's place.
    await allowLogins(after!.machineId)
    await pressed()
    assert.deepEqual(readAccounts(rig.serverPath('claude')).map(a => a.name), ['Dani', 'Work', 'This computer'])
  }))

test('a login made anew for the server, taken off there while this computer still has it, waits for the press again: it is not made by itself', () =>
  withRig(async rig => {
    rig.local = [own, dani]
    const [server] = await syncLogins()
    await allowLogins(server!.machineId)
    await pressed()
    assert.deepEqual(await settleLeft(server!.machineId, { kind: 'claude', source: 'own' }, false), { ok: true })
    assert.deepEqual(readAccounts(rig.serverPath('claude')).map(a => a.name), ['Dani', 'This computer'])
    assert.deepEqual((await serverLogins())[0]!.logins.map(l => [l.name, l.state]), [['Suleiman', 'allow'], ['Dani', 'there']])
    rig.calls.length = 0
    await syncLogins()
    assert.deepEqual(readAccounts(rig.serverPath('claude')).map(a => a.name), ['Dani', 'This computer'])
  }))

test('one taken off there is deleted there', () =>
  withRig(async rig => {
    rig.local = [dani]
    const [server] = await syncLogins()
    rig.local = []
    await syncLogins()
    assert.deepEqual(await settleLeft(server!.machineId, { kind: 'claude', source: 'Dani' }, false), { ok: true })
    assert.deepEqual(readAccounts(rig.serverPath('claude')).map(a => a.name), ['This computer'])
    assert.deepEqual(readCopied(), [])
  }))

test('a Codex account signed in for the server must be the one asked for: one the browser signed in to instead is refused', () =>
  withRig(async rig => {
    rig.local = [{ kind: 'codex', source: 'own', name: 'Suleiman', who: 'u1/ws' }]
    syncWiring.loginCodex = async opts => {
      const folder = join(opts.dir!, 'codex-abc')
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'auth.json'), '{}')
      return { ok: true, login: 'codex-abc', who: { name: 'Dani', key: 'u2/ws' } }
    }
    const [server] = await syncLogins()
    await allowLogins(server!.machineId)
    await pressed()
    const [after] = await serverLogins()
    assert.match(after!.failed ?? '', /^Suleiman: The browser signed in to Dani, not Suleiman/)
    assert.deepEqual(after!.logins.map(l => l.state), ['allow'])
  }))

test('this computer\'s logins: its own Claude login by who Claude Code says it is, an added one by a mark of its login, and none for a Claude Code logged in to nobody', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-local-'))
  try {
    const env = { HOME: dir, XDG_CONFIG_HOME: join(dir, 'config') }
    mkdirSync(env.XDG_CONFIG_HOME)
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'uuid-1', displayName: 'Suleiman', emailAddress: 's@example.com' } }))
    writeFileSync(join(env.XDG_CONFIG_HOME, 'openagent-claude-accounts.json'), JSON.stringify({ accounts: [{ name: 'This computer' }, { name: 'Dani', login: LOGIN }] }))
    const logins = await localLogins(env)
    const claude = logins.filter(l => l.kind === 'claude')
    assert.deepEqual(claude.map(l => [l.source, l.name, l.who.length > 0, l.secret !== undefined]), [['own', 'Suleiman', true, false], ['Dani', 'Dani', true, true]])
    assert.equal(claude[0]!.who, 'uuid-1')
    assert.notEqual(claude[1]!.who, LOGIN)
    writeFileSync(join(dir, '.claude.json'), JSON.stringify({}))
    assert.deepEqual((await localLogins(env)).filter(l => l.kind === 'claude').map(l => l.source), ['Dani'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the person\'s settings follow to the server: all at first, then only what changed here, so one changed on the server\'s own page stays; this computer\'s own are never sent', () =>
  withRig(async rig => {
    rig.prefs = { theme: 'dark', onboardingDismissed: true, model: 'opus', editor: 'cursor', bridge: true }
    await syncLogins()
    assert.deepEqual(rig.patched, [{ theme: 'dark', model: 'opus', onboardingDismissed: true }])
    await syncLogins()
    assert.equal(rig.patched.length, 1)
    rig.prefs = { theme: 'light', onboardingDismissed: true, editor: 'zed' }
    await syncLogins()
    // The model no longer picked here is emptied there; the editor is this computer's.
    assert.deepEqual(rig.patched[1], { theme: 'light', model: '' })
    // A server not told to use this computer's logins gets no settings either.
    rig.saved = [machine(false)]
    rig.prefs = { theme: 'system' }
    await syncLogins()
    assert.equal(rig.patched.length, 2)
  }))
