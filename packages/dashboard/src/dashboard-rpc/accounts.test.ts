import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accountsWiring, onAgentAccounts, sendRemoveAgentAccount, sendUseAgentAccountFirst } from './accounts.js'
import { provideTestContext } from './test-context.js'
import type { QuotaView } from '../dashboard/quota.js'
import { addAccount, markLimited, noteWindows, OWN_NAME, readAccounts, type AccountsAgent } from '@openagt/skill-account-rotation'

const HOUR = 60 * 60_000
const NOW = Date.parse('2026-10-22T12:00:00Z')
const LOGIN = `sk-ant-oat01-${'Zx9_-q'.repeat(16)}`

/** A file of accounts and a Claude Code that knows the person as `claude`, for one test. */
async function withAccounts(body: (path: string) => Promise<void>, claude: object = { oauthAccount: { displayName: 'Suleiman', emailAddress: 's@example.com' } }, live: QuotaView = { windows: [] }): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'oa-accounts-'))
  const path = join(dir, 'accounts.json')
  writeFileSync(join(dir, '.claude.json'), JSON.stringify(claude))
  const before = { ...accountsWiring }
  Object.assign(accountsWiring, { path: () => path, claudeJson: () => join(dir, '.claude.json'), now: () => NOW, codexWho: async () => ({}), codexUsage: async () => [], computer: () => 'Studio' })
  provideTestContext({ quota: { read: async () => live, stop: () => {} } })
  try {
    await body(path)
  } finally {
    Object.assign(accountsWiring, before)
    rmSync(dir, { recursive: true, force: true })
  }
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
      assert.deepEqual((await onAgentAccounts('claude')).accounts, [{ id: OWN_NAME, name: 'Claude login on Studio', own: true, loggedOut: true, windows: [] }])
    },
    {},
  ))

test('the person\'s own login not there: it says so, and the first account with a login is the one in use, though the own is first on the list', () =>
  withAccounts(
    async path => {
      addAccount('Dani', LOGIN, path, new Date(NOW))
      addAccount('Rom', LOGIN, path, new Date(NOW))
      const { accounts } = await onAgentAccounts('claude')
      assert.deepEqual(accounts.map(a => [a.name, a.loggedOut, a.state]), [['Claude login on Studio', true, undefined], ['Dani', undefined, 'in-use'], ['Rom', undefined, 'next']])
    },
    {},
  ))

test('an added account is removed and another put first; never the person\'s own removed', () =>
  withAccounts(async path => {
    addAccount('Dani', LOGIN, path)
    assert.deepEqual(await sendUseAgentAccountFirst('claude', 'Dani'), { ok: true })
    assert.deepEqual(readAccounts(path).map(a => a.name), ['Dani', OWN_NAME])
    await sendRemoveAgentAccount('claude', OWN_NAME)
    await sendRemoveAgentAccount('claude', 'Dani')
    assert.deepEqual(readAccounts(path).map(a => a.name), [OWN_NAME])
    assert.equal(readFileSync(path, 'utf8').includes(LOGIN), false)
  }))

/** A Codex account's folder and its own home, by the name the list gives its login, under `dir`. */
function codexWiring(dir: string, who: Record<string, { name?: string; key?: string }>, usage: Record<string, { window: string; percentUsed: number; resetsAt: number }[]>, reads: string[] = []) {
  const own = join(dir, 'own-codex')
  const folders = join(dir, 'codex-accounts')
  mkdirSync(folders, { recursive: true })
  mkdirSync(own, { recursive: true })
  writeFileSync(join(own, 'auth.json'), '{}')
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

