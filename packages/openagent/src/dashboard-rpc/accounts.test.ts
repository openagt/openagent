import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Mint } from '@openagt/agent-driver-claude'
import { addAccount, markLimited, noteWindows, OWN_NAME, readAccounts } from '@openagt/agent-driver'
import { accountsWiring, onClaudeAccounts, sendAddClaudeAccount, sendNameOwnClaudeAccount, sendRemoveClaudeAccount, sendUseClaudeAccountFirst } from './accounts.js'
import { provideTestContext } from './test-context.js'
import type { QuotaView } from '../dashboard/quota.js'

const HOUR = 60 * 60_000
const NOW = Date.parse('2026-10-22T12:00:00Z')
const LOGIN = `sk-ant-oat01-${'Zx9_-q'.repeat(16)}`

/** A file of accounts and a Claude Code that knows the person as `claude`, for one test. */
async function withAccounts(body: (path: string) => Promise<void>, claude: object = { oauthAccount: { displayName: 'Suleiman', emailAddress: 's@example.com' } }, live: QuotaView = { windows: [] }): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'oa-accounts-'))
  const path = join(dir, 'accounts.json')
  writeFileSync(join(dir, '.claude.json'), JSON.stringify(claude))
  const before = { ...accountsWiring }
  Object.assign(accountsWiring, { path: () => path, claudeJson: () => join(dir, '.claude.json'), now: () => NOW })
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
  for (let i = 0; i < 50 && (await onClaudeAccounts()).adding; i++) await new Promise(resolve => setTimeout(resolve, 10))
}

test('the page sees each account by name and how full it is, never a login: the person\'s own by Claude Code\'s name for them and read live, an added one as its last run said it', () =>
  withAccounts(
    async path => {
      addAccount('Dani', LOGIN, path, new Date(NOW - HOUR))
      noteWindows('Dani', [{ window: 'seven_day', percentUsed: 61, resetsAt: NOW + 48 * HOUR }, { window: 'five_hour', percentUsed: 40, resetsAt: NOW - 1 }], NOW - HOUR, path)
      const view = await onClaudeAccounts()
      assert.equal(JSON.stringify(view).includes(LOGIN), false)
      assert.deepEqual(view.accounts, [
        { id: OWN_NAME, name: 'Suleiman', own: true, weekPercent: 22, sessionPercent: 3, state: 'in-use' },
        // A window past its reset is empty again.
        { id: 'Dani', name: 'Dani', own: false, added: new Date(NOW - HOUR).toISOString(), weekPercent: 61, sessionPercent: 0, asOf: NOW - HOUR, state: 'next' },
      ])
      markLimited(OWN_NAME, NOW + 2 * HOUR, NOW, path)
      const limited = await onClaudeAccounts()
      assert.deepEqual(limited.accounts.map(a => [a.name, a.state, a.limitedUntil]), [['Suleiman', 'limited', NOW + 2 * HOUR], ['Dani', 'in-use', undefined]])
    },
    undefined,
    { windows: [{ label: 'Current week (all models)', kind: 'week', percentUsed: 22 }, { label: 'Current session', kind: 'session', percentUsed: 3 }] },
  ))

test('with one account there is no order to say; a Claude Code that does not say who the person is leaves its own name', () =>
  withAccounts(
    async () => {
      assert.deepEqual((await onClaudeAccounts()).accounts, [{ id: OWN_NAME, name: OWN_NAME, own: true }])
    },
    {},
  ))

test('adding an account refuses a taken name before the browser opens, then keeps the login the browser yes made under its name; one that is not made says why', () =>
  withAccounts(async path => {
    let asked = 0
    const made: Mint = async () => (asked++, { ok: true, login: LOGIN })
    accountsWiring.mint = made
    assert.deepEqual(await sendAddClaudeAccount('suleiman'), { ok: false, error: 'There is an account named suleiman already.' })
    assert.deepEqual(await sendAddClaudeAccount(' '), { ok: false, error: 'An account needs a name.' })
    assert.equal(asked, 0)
    assert.deepEqual(await sendAddClaudeAccount('Dani'), { ok: true })
    await settled()
    assert.equal(asked, 1)
    assert.deepEqual(readAccounts(path).map(a => [a.name, a.login]), [[OWN_NAME, undefined], ['Dani', LOGIN]])

    accountsWiring.mint = async () => ({ ok: false, error: 'No yes came from the browser in 10 minutes.' })
    assert.deepEqual(await sendAddClaudeAccount('Rom'), { ok: true })
    await settled()
    assert.equal((await onClaudeAccounts()).failed, 'No yes came from the browser in 10 minutes.')
    assert.equal(readAccounts(path).length, 2)
  }))

test('one add at a time: a second waits for the browser yes of the first', () =>
  withAccounts(async () => {
    let release: () => void = () => {}
    accountsWiring.mint = () => new Promise(resolve => (release = () => resolve({ ok: false, error: 'stopped' })))
    assert.deepEqual(await sendAddClaudeAccount('Dani'), { ok: true })
    assert.deepEqual((await onClaudeAccounts()).adding, { name: 'Dani' })
    assert.equal((await sendAddClaudeAccount('Rom')).ok, false)
    release()
    await settled()
  }))

test('an added account is removed, another put first, and the person\'s own named; never the person\'s own removed', () =>
  withAccounts(async path => {
    addAccount('Dani', LOGIN, path)
    assert.deepEqual(await sendUseClaudeAccountFirst('Dani'), { ok: true })
    assert.deepEqual(await sendNameOwnClaudeAccount('Rom'), { ok: true })
    assert.deepEqual(readAccounts(path).map(a => a.name), ['Dani', 'Rom'])
    assert.deepEqual(await sendNameOwnClaudeAccount('dani'), { ok: false, error: 'There is an account named dani already.' })
    await sendRemoveClaudeAccount('Rom')
    await sendRemoveClaudeAccount('Dani')
    assert.deepEqual(readAccounts(path).map(a => a.name), ['Rom'])
    assert.equal(readFileSync(path, 'utf8').includes(LOGIN), false)
  }))
