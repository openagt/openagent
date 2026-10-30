import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Mint } from '@openagt/agent-driver-claude'
import type { CodexLogin, CodexLoginOptions } from '@openagt/agent-driver-codex'
import { accountsWiring, onAgentAccounts, sendAddAgentAccount, sendAgentAccountCode, sendNameOwnAgentAccount, sendRemoveAgentAccount, sendUseAgentAccountFirst } from './accounts.js'
import { provideTestContext } from './test-context.js'
import type { QuotaView } from '../dashboard/quota.js'
import { addAccount, markLimited, noteWindows, OWN_NAME, readAccounts } from '@openagt/skill-account-rotation'

const HOUR = 60 * 60_000
const NOW = Date.parse('2026-10-22T12:00:00Z')
const LOGIN = `sk-ant-oat01-${'Zx9_-q'.repeat(16)}`

/** A file of accounts and a Claude Code that knows the person as `claude`, for one test. */
async function withAccounts(body: (path: string) => Promise<void>, claude: object = { oauthAccount: { displayName: 'Suleiman', emailAddress: 's@example.com' } }, live: QuotaView = { windows: [] }): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'oa-accounts-'))
  const path = join(dir, 'accounts.json')
  writeFileSync(join(dir, '.claude.json'), JSON.stringify(claude))
  const before = { ...accountsWiring }
  Object.assign(accountsWiring, { path: () => path, claudeJson: () => join(dir, '.claude.json'), now: () => NOW, codexWho: async () => ({}), codexUsage: async () => [], computer: () => 'Studio', headless: () => false })
  provideTestContext({ quota: { read: async () => live, stop: () => {} } })
  try {
    await body(path)
  } finally {
    Object.assign(accountsWiring, before)
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Until the add that was started has ended. */
async function settled(): Promise<void> {
  for (let i = 0; i < 50 && ((await onAgentAccounts('claude')).adding || (await onAgentAccounts('codex')).adding); i++) await new Promise(resolve => setTimeout(resolve, 10))
}

test('the page sees each account by name and how full it is, never a login: the person\'s own by Claude Code\'s name for them and read live, an added one as its last run said it', () =>
  withAccounts(
    async path => {
      addAccount('Dani', LOGIN, path, new Date(NOW - HOUR))
      noteWindows('Dani', [{ window: 'seven_day', percentUsed: 61, resetsAt: NOW + 48 * HOUR }, { window: 'five_hour', percentUsed: 40, resetsAt: NOW - 1 }], NOW - HOUR, path)
      const view = await onAgentAccounts('claude')
      assert.equal(JSON.stringify(view).includes(LOGIN), false)
      assert.deepEqual(view.accounts, [
        { id: OWN_NAME, name: 'Suleiman', own: true, windows: [{ label: '5 h', percent: 3 }, { label: 'week', percent: 22 }], state: 'in-use' },
        // A window past its reset is empty again.
        { id: 'Dani', name: 'Dani', own: false, added: new Date(NOW - HOUR).toISOString(), windows: [{ label: '5 h', percent: 0 }, { label: 'week', percent: 61 }], asOf: NOW - HOUR, state: 'next' },
      ])
      markLimited(OWN_NAME, NOW + 2 * HOUR, NOW, path)
      const limited = await onAgentAccounts('claude')
      assert.deepEqual(limited.accounts.map(a => [a.name, a.state, a.limitedUntil]), [['Suleiman', 'limited', NOW + 2 * HOUR], ['Dani', 'in-use', undefined]])
    },
    undefined,
    { windows: [{ label: 'Current week (all models)', kind: 'week', percentUsed: 22 }, { label: 'Current session', kind: 'session', percentUsed: 3 }] },
  ))

test('with one account there is no order to say; a Claude Code that does not say who the person is names the login by the computer it is on, never "this computer"', () =>
  withAccounts(
    async () => {
      assert.deepEqual((await onAgentAccounts('claude')).accounts, [{ id: OWN_NAME, name: 'Claude login on Studio', own: true, windows: [] }])
    },
    {},
  ))

test('adding an account refuses a taken name before the browser opens, then keeps the login the browser yes made under its name; one that is not made says why', () =>
  withAccounts(async path => {
    let asked = 0
    const made: Mint = async () => (asked++, { ok: true, login: LOGIN })
    accountsWiring.mint = made
    assert.deepEqual(await sendAddAgentAccount('claude', 'suleiman'), { ok: false, error: 'There is an account named suleiman already.' })
    assert.deepEqual(await sendAddAgentAccount('claude', ' '), { ok: false, error: 'An account needs a name.' })
    assert.equal(asked, 0)
    assert.deepEqual(await sendAddAgentAccount('claude', 'Dani'), { ok: true })
    await settled()
    assert.equal(asked, 1)
    assert.deepEqual(readAccounts(path).map(a => [a.name, a.login]), [[OWN_NAME, undefined], ['Dani', LOGIN]])

    accountsWiring.mint = async () => ({ ok: false, error: 'No yes came from the browser in 10 minutes.' })
    assert.deepEqual(await sendAddAgentAccount('claude', 'Rom'), { ok: true })
    await settled()
    assert.equal((await onAgentAccounts('claude')).failed, 'No yes came from the browser in 10 minutes.')
    assert.equal(readAccounts(path).length, 2)
  }))

test('one add at a time: a second waits for the browser yes of the first', () =>
  withAccounts(async () => {
    let release: () => void = () => {}
    accountsWiring.mint = () => new Promise(resolve => (release = () => resolve({ ok: false, error: 'stopped' })))
    assert.deepEqual(await sendAddAgentAccount('claude', 'Dani'), { ok: true })
    assert.deepEqual((await onAgentAccounts('claude')).adding, { name: 'Dani' })
    // Each agent adds its own: Codex's is not held up by Claude's.
    assert.equal((await onAgentAccounts('codex')).adding, undefined)
    assert.equal((await sendAddAgentAccount('claude', 'Rom')).ok, false)
    release()
    await settled()
  }))

test('on a server with no browser, adding a Claude account shows the page to sign in at, and the code the person pastes back goes to Claude Code', () =>
  withAccounts(async path => {
    const pasted: string[] = []
    let finish: (login: string) => void = () => {}
    const mint: Mint = ({ onLink } = {}) =>
      new Promise(resolve => {
        onLink?.('https://claude.example/sign-in', code => {
          pasted.push(code)
          return true
        })
        finish = login => resolve({ ok: true, login })
      })
    Object.assign(accountsWiring, { mint, headless: () => true })
    assert.deepEqual(await sendAgentAccountCode('claude', 'nothing-waits'), { ok: false, error: 'No login waits for a code: start it again.' })
    assert.deepEqual(await sendAddAgentAccount('claude', 'Dani'), { ok: true })
    assert.deepEqual((await onAgentAccounts('claude')).adding, { name: 'Dani', url: 'https://claude.example/sign-in', paste: true })
    assert.deepEqual(await sendAgentAccountCode('claude', 'the-code'), { ok: true })
    assert.deepEqual(pasted, ['the-code'])
    finish(LOGIN)
    await settled()
    assert.equal(readAccounts(path).find(a => a.name === 'Dani')?.login, LOGIN)
    assert.deepEqual(await sendAgentAccountCode('claude', 'too-late'), { ok: false, error: 'No login waits for a code: start it again.' })
  }))

test('an added account is removed, another put first, and the person\'s own named; never the person\'s own removed', () =>
  withAccounts(async path => {
    addAccount('Dani', LOGIN, path)
    assert.deepEqual(await sendUseAgentAccountFirst('claude', 'Dani'), { ok: true })
    assert.deepEqual(await sendNameOwnAgentAccount('claude', 'Rom'), { ok: true })
    assert.deepEqual(readAccounts(path).map(a => a.name), ['Dani', 'Rom'])
    assert.deepEqual(await sendNameOwnAgentAccount('claude', 'dani'), { ok: false, error: 'There is an account named dani already.' })
    await sendRemoveAgentAccount('claude', 'Rom')
    await sendRemoveAgentAccount('claude', 'Dani')
    assert.deepEqual(readAccounts(path).map(a => a.name), ['Rom'])
    assert.equal(readFileSync(path, 'utf8').includes(LOGIN), false)
  }))

/** A Codex account's folder and its own home, by the name the list gives its login, under `dir`. */
function codexWiring(dir: string, who: Record<string, { name?: string; key?: string }>, usage: Record<string, { window: string; percentUsed: number; resetsAt: number }[]>, reads: string[] = []) {
  const own = join(dir, 'own-codex')
  const folders = join(dir, 'codex-accounts')
  mkdirSync(folders, { recursive: true })
  Object.assign(accountsWiring, {
    codexDir: () => folders,
    codexOwnHome: () => own,
    codexFolder: (account: { login?: string }) => join(folders, account.login!),
    codexWho: async (home: string) => who[home === own ? 'own' : home.slice(folders.length + 1)] ?? {},
    codexUsage: async (home: string) => {
      reads.push(home)
      const said = usage[home === own ? 'own' : home.slice(folders.length + 1)]
      if (!said) throw new Error('Codex did not answer')
      return said
    },
  })
  return { own, folders }
}

test('Codex accounts: the person\'s own by the name its login says, every one read live, by Codex\'s month; a reading kept a minute; one Codex cannot read is as its last run said it', () =>
  withAccounts(async path => {
    const dir = join(path, '..')
    const reads: string[] = []
    codexWiring(dir, { own: { name: 'Suleiman S', key: 'u1/w' } }, { own: [{ window: 'thirty_day', percentUsed: 7, resetsAt: NOW + 20 * 24 * HOUR }], 'codex-rom': [{ window: 'five_hour', percentUsed: 40, resetsAt: NOW + HOUR }, { window: 'seven_day', percentUsed: 12, resetsAt: NOW + 48 * HOUR }] }, reads)
    addAccount('Rom', 'codex-rom', path, new Date(NOW - HOUR))
    addAccount('Dani', 'codex-dani', path, new Date(NOW - HOUR))
    noteWindows('Dani', [{ window: 'seven_day', percentUsed: 30, resetsAt: NOW + HOUR }], NOW - HOUR, path)
    const view = await onAgentAccounts('codex')
    assert.deepEqual(view.accounts, [
      { id: OWN_NAME, name: 'Suleiman S', own: true, windows: [{ label: 'month', percent: 7 }], state: 'in-use' },
      { id: 'Rom', name: 'Rom', own: false, added: new Date(NOW - HOUR).toISOString(), windows: [{ label: '5 h', percent: 40 }, { label: 'week', percent: 12 }], state: 'next' },
      { id: 'Dani', name: 'Dani', own: false, added: new Date(NOW - HOUR).toISOString(), windows: [{ label: 'week', percent: 30 }], asOf: NOW - HOUR },
    ])
    assert.equal(reads.length, 3)
    await onAgentAccounts('codex')
    assert.equal(reads.length, 3, 'read again within the minute: none started')
  }))

test('adding a Codex account asks its name first, then the sign-in, with the page to copy into a private window; the same account twice is refused and leaves nothing behind; a removed one takes its folder with it', () =>
  withAccounts(async path => {
    const dir = join(path, '..')
    const { folders } = codexWiring(dir, { own: { key: 'me/w' }, 'codex-new': { key: 'dani/w' }, 'codex-again': { key: 'me/w' } }, {})
    let finish: (signed: CodexLogin) => void = () => {}
    accountsWiring.loginCodex = (opts: CodexLoginOptions) =>
      new Promise(resolve => {
        opts.onUrl?.('https://auth.example/sign-in')
        finish = resolve
      })
    assert.deepEqual(await sendAddAgentAccount('codex', ' '), { ok: false, error: 'An account needs a name.' })
    assert.deepEqual(await sendAddAgentAccount('codex', 'Dani'), { ok: true })
    assert.deepEqual((await onAgentAccounts('codex')).adding, { name: 'Dani', url: 'https://auth.example/sign-in' })
    mkdirSync(join(folders, 'codex-new'))
    finish({ ok: true, login: 'codex-new', who: { key: 'dani/w' } })
    await settled()
    assert.deepEqual(readAccounts(path).map(a => [a.name, a.login]), [[OWN_NAME, undefined], ['Dani', 'codex-new']])

    assert.deepEqual(await sendAddAgentAccount('codex', 'Rom'), { ok: true })
    mkdirSync(join(folders, 'codex-again'))
    finish({ ok: true, login: 'codex-again', who: { key: 'me/w' } })
    await settled()
    assert.match((await onAgentAccounts('codex')).failed ?? '', /That account is on the list already/)
    assert.equal(existsSync(join(folders, 'codex-again')), false)
    assert.equal(readAccounts(path).length, 2)

    await sendRemoveAgentAccount('codex', 'Dani')
    assert.equal(existsSync(join(folders, 'codex-new')), false)
    assert.deepEqual(readAccounts(path).map(a => a.name), [OWN_NAME])
  }))
