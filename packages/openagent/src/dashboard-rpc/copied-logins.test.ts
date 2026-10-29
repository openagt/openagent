import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addAccount, OWN_NAME, readAccounts } from '@openagt/agent-driver'
import { accountsWiring, onAgentAccounts } from './accounts.js'
import { copiedWiring, onCopiedLogins, sendCopiedLogin, sendCopiedUsage, sendForgetCopiedLogin, sendKeepCopiedLogin } from './copied-logins.js'
import { copiedPath, readCopied } from '../dashboard/copied-logins.js'
import { provideTestContext } from './test-context.js'

// A server takes the logins of the person's own computers: each goes where its tool reads it, and
// the server keeps what the computer said of it, never the login. Taking one off ends nothing.

const NOW = Date.parse('2026-10-24T12:00:00Z')
const LOGIN = `sk-ant-oat01-${'Zx9_-q'.repeat(16)}`
const OTHER = `sk-ant-oat01-${'Ab3_-w'.repeat(16)}`

/** A Codex sign-in as Codex keeps it, for one person in one workspace. */
function codexAuth(user: string, name: string): string {
  const claims = Buffer.from(JSON.stringify({ name, sub: user, 'https://api.openai.com/auth': { chatgpt_user_id: user, chatgpt_account_id: 'ws' } })).toString('base64url')
  return JSON.stringify({ tokens: { id_token: `h.${claims}.s`, access_token: 'a', refresh_token: 'r' } })
}

interface Server {
  dir: string
  path: (agent: 'claude' | 'codex') => string
  git: { args: string[]; input?: string }[]
}

/** A server's OpenAgent, its files in a folder of its own, its git host package scripted. */
async function onServer(body: (server: Server) => Promise<void>, server = true): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'oa-copied-'))
  const git: Server['git'] = []
  const accountsBefore = { ...accountsWiring }
  const copiedBefore = { ...copiedWiring }
  const xdg = process.env['XDG_CONFIG_HOME']
  process.env['XDG_CONFIG_HOME'] = dir
  const path = (agent: 'claude' | 'codex'): string => join(dir, `${agent}-accounts.json`)
  Object.assign(accountsWiring, { path, now: () => NOW, computer: () => 'droplet', claudeJson: () => join(dir, 'none.json'), codexUsage: async () => [], codexDir: () => join(dir, 'codex-accounts'), codexFolder: (account: { login?: string }) => join(dir, 'codex-accounts', account.login ?? 'none') })
  Object.assign(copiedWiring, {
    server: () => server,
    codexDir: () => join(dir, 'codex-accounts'),
    gitHost: async (_host: string, args: string[], input?: string) => {
      git.push({ args, ...(input !== undefined ? { input } : {}) })
      if (args[0] === 'take') return input === 'gho_token_of_octo_123456' ? { ok: true, output: { ok: true, login: 'octo' } } : { ok: false, error: 'GitHub did not take the login' }
      return { ok: true, output: { ok: true } }
    },
  })
  provideTestContext({ quota: { read: async () => ({ windows: [] }), stop: () => {} } })
  try {
    await body({ dir, path, git })
  } finally {
    Object.assign(accountsWiring, accountsBefore)
    Object.assign(copiedWiring, copiedBefore)
    if (xdg === undefined) delete process.env['XDG_CONFIG_HOME']
    else process.env['XDG_CONFIG_HOME'] = xdg
    rmSync(dir, { recursive: true, force: true })
  }
}

const laptop = { from: 'Suleimans-MacBook-Pro' }

test('a Claude login handed over is an account runs take before the server\'s own login; another account under the same one of the computer\'s takes its place; the file keeps no login', () =>
  onServer(async ({ path }) => {
    assert.deepEqual(await sendCopiedLogin({ kind: 'claude', source: 'own', name: 'Suleiman', who: 'uuid-1', ...laptop }, LOGIN), { ok: true })
    assert.deepEqual(readAccounts(path('claude')).map(a => [a.name, a.login]), [['Suleiman', LOGIN], [OWN_NAME, undefined]])
    const view = await onAgentAccounts('claude')
    assert.deepEqual(view.accounts.map(a => [a.name, a.from]), [['Suleiman', 'Suleimans-MacBook-Pro'], ['Claude login on droplet', undefined]])
    assert.equal(view.from, 'Suleimans-MacBook-Pro')
    assert.equal(readFileSync(copiedPath(), 'utf8').includes(LOGIN), false)
    assert.equal(statSync(copiedPath()).mode & 0o777, 0o600)
    // The person switched accounts there and said yes for the new one: the old login goes, the new one takes its place.
    assert.deepEqual(await sendCopiedLogin({ kind: 'claude', source: 'own', name: 'Work', who: 'uuid-2', ...laptop }, OTHER), { ok: true })
    assert.deepEqual(readAccounts(path('claude')).map(a => [a.name, a.login]), [['Work', OTHER], [OWN_NAME, undefined]])
    const said = await onCopiedLogins()
    assert.ok(said.ok)
    assert.deepEqual(said.logins, [{ kind: 'claude', source: 'own', name: 'Work', who: 'uuid-2', from: 'Suleimans-MacBook-Pro' }])
  }))

test('the person\'s own Claude login keeps who it is at Claude, as the computer said it: Claude Code here is told it beside the login; an added account\'s mark is no such id', () =>
  onServer(async ({ path }) => {
    const id = '0f8e7d6c-5b4a-4392-8a1b-2c3d4e5f6a7b'
    assert.deepEqual(await sendCopiedLogin({ kind: 'claude', source: 'own', name: 'Suleiman', who: id, ...laptop }, LOGIN), { ok: true })
    assert.deepEqual(await sendCopiedLogin({ kind: 'claude', source: 'Dani', name: 'Dani', who: '0123456789abcdef', ...laptop }, OTHER), { ok: true })
    assert.deepEqual(readAccounts(path('claude')).map(a => [a.name, a.accountId]), [['Suleiman', id], ['Dani', undefined], [OWN_NAME, undefined]])
    // A page reads the accounts, never who they are.
    assert.equal(JSON.stringify(await onAgentAccounts('claude')).includes(id), false)
  }))

test('a name an account here has already gets the computer\'s name beside it', () =>
  onServer(async ({ path }) => {
    addAccount('Dani', LOGIN, path('claude'))
    assert.deepEqual(await sendCopiedLogin({ kind: 'claude', source: 'Dani', name: 'Dani', who: 'mark', ...laptop }, OTHER), { ok: true })
    assert.deepEqual(readAccounts(path('claude')).map(a => a.name), ['Dani', 'Dani (Suleimans-MacBook-Pro)', OWN_NAME])
    assert.equal(readCopied()[0]!.name, 'Dani (Suleimans-MacBook-Pro)')
  }))

test('a Codex sign-in handed over is a folder of its own, read by this user alone; taken off, the folder goes with it', () =>
  onServer(async ({ dir, path }) => {
    assert.deepEqual(await sendCopiedLogin({ kind: 'codex', source: 'own', name: 'Suleiman', who: 'u1/ws', ...laptop }, codexAuth('u1', 'Suleiman')), { ok: true })
    const [account] = readAccounts(path('codex')).filter(a => a.login !== undefined)
    assert.match(account!.login!, /^codex-[0-9a-f]{12}$/)
    const folder = join(dir, 'codex-accounts', account!.login!)
    assert.equal(statSync(folder).mode & 0o777, 0o700)
    assert.equal(statSync(join(folder, 'auth.json')).mode & 0o777, 0o600)
    assert.deepEqual(await sendCopiedLogin({ kind: 'codex', source: 'x', name: 'X', who: 'k', ...laptop }, 'not a sign-in'), { ok: false, error: 'What was handed over is no Codex sign-in.' })
    assert.deepEqual(await sendForgetCopiedLogin({ kind: 'codex', source: 'own' }), { ok: true })
    assert.deepEqual(readdirSync(join(dir, 'codex-accounts')), [])
    assert.deepEqual(readAccounts(path('codex')).map(a => a.name), [OWN_NAME])
  }))

test('a git host\'s token goes to its package on standard input, and runs use it when the computer\'s did; one that is another account\'s is refused; taken off, the package forgets it and ends nothing', () =>
  onServer(async ({ git }) => {
    assert.deepEqual(await sendCopiedLogin({ kind: 'git', host: 'github.com', source: 'octo', name: 'octo', who: 'octo', runs: true, ...laptop }, 'gho_token_of_octo_123456'), { ok: true })
    assert.deepEqual(git, [{ args: ['take'], input: 'gho_token_of_octo_123456' }, { args: ['use', 'octo'] }])
    git.length = 0
    assert.deepEqual(await sendCopiedLogin({ kind: 'git', host: 'github.com', source: 'other', name: 'other', who: 'other', ...laptop }, 'gho_token_of_octo_123456'), { ok: false, error: "The token handed over for other is octo's at github.com." })
    assert.deepEqual(git.at(-1), { args: ['forget', 'octo'] })
    git.length = 0
    assert.deepEqual(await sendForgetCopiedLogin({ kind: 'git', host: 'github.com', source: 'octo' }), { ok: true })
    assert.deepEqual(git, [{ args: ['forget', 'octo'] }])
    assert.deepEqual(readCopied(), [])
  }))

test('a login the computer no longer has is kept when the person says so, and its place is free for the computer\'s next one; the computer\'s readings show on the row', () =>
  onServer(async () => {
    await sendCopiedLogin({ kind: 'claude', source: 'own', name: 'Suleiman', who: 'uuid-1', ...laptop }, LOGIN)
    assert.deepEqual(await sendCopiedUsage([{ kind: 'claude', source: 'own', windows: [{ label: 'week', percent: 62 }], at: NOW - 60_000 }]), { ok: true })
    assert.deepEqual((await onAgentAccounts('claude')).accounts[0]!.windows, [{ label: 'week', percent: 62 }])
    assert.equal((await onAgentAccounts('claude')).accounts[0]!.asOf, NOW - 60_000)
    assert.deepEqual(await sendKeepCopiedLogin({ kind: 'claude', source: 'own' }), { ok: true })
    assert.deepEqual(readCopied().map(l => [l.source, l.kept]), [['kept:uuid-1', true]])
    await sendCopiedLogin({ kind: 'claude', source: 'own', name: 'Work', who: 'uuid-2', ...laptop }, OTHER)
    assert.deepEqual(readCopied().map(l => l.name), ['Suleiman', 'Work'])
  }))

test('only a server takes logins, and what is handed over must read as one', () =>
  onServer(async () => {
    assert.deepEqual(await onCopiedLogins(), { ok: false, error: 'This OpenAgent takes no logins from another computer: it is no server.' })
    assert.equal((await sendCopiedLogin({ kind: 'claude', source: 'own', name: 'S', who: 'u', ...laptop }, LOGIN)).ok, false)
  }, false))

test('what is handed over must read as a login of a kind this server knows', () =>
  onServer(async () => {
    assert.deepEqual(await sendCopiedLogin({ kind: 'mail' as 'git', source: 'own', name: 'S', who: 'u', ...laptop }, LOGIN), { ok: false, error: 'That is no login.' })
    assert.deepEqual(await sendCopiedLogin({ kind: 'claude', source: 'own', name: 'S\nX', who: 'u', ...laptop }, LOGIN), { ok: false, error: 'That is no login.' })
    assert.deepEqual(await sendCopiedLogin({ kind: 'git', source: 'octo', name: 'octo', who: 'octo', ...laptop }, 'gho_x'), { ok: false, error: 'That is no login.' })
    assert.deepEqual(readCopied(), [])
  }))
