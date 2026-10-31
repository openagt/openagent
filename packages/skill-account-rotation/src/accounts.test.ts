import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { accountRotation, addAccount, accountsPath, hasAddedAccount, freesIn, markLimited, nameOwnAccount, OWN_NAME, pickAccount, readAccounts, removeAccount, shownAccounts, useFirst } from './accounts.js'

const HOUR = 60 * 60_000
const NOW = Date.parse('2026-10-22T12:00:00Z')

function withFile(body: (path: string) => Promise<void> | void): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-accounts-'))
    try {
      await body(join(dir, 'accounts.json'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

test('the file is beside OpenAgent\'s own: under XDG_CONFIG_HOME when set, else dotted in the home', () => {
  assert.equal(accountsPath('claude', { XDG_CONFIG_HOME: '/x' }), '/x/openagent-claude-accounts.json')
  assert.equal(accountsPath('codex', { HOME: '/home/rom' }), '/home/rom/.openagent-codex-accounts.json')
})

test('with no file the person\'s own login is the one account; added ones go last, by a name of their own, in a file only this user reads', withFile(path => {
  assert.deepEqual(readAccounts(path), [{ name: OWN_NAME }])
  addAccount(' Dani ', 'sk-ant-oat01-dani', path, new Date(NOW))
  assert.deepEqual(readAccounts(path), [{ name: OWN_NAME }, { name: 'Dani', login: 'sk-ant-oat01-dani', added: '2026-10-22T12:00:00.000Z' }])
  assert.equal(statSync(path).mode & 0o777, 0o600)
  assert.throws(() => addAccount('dani', 'sk-ant-oat01-other', path), /named dani already/)
  assert.throws(() => addAccount('  ', 'sk-ant-oat01-other', path), /needs a name/)
  // A page is shown everything but the logins.
  assert.deepEqual(shownAccounts(readAccounts(path)).map(a => [a.name, a.own, 'login' in a]), [[OWN_NAME, true, false], ['Dani', false, false]])
}))

test('one entry is the person\'s own login: another with no login is no account, and is left out', withFile(path => {
  // Written by an OpenAgent that named the login otherwise: read as no login, it was a second own row.
  writeFileSync(path, JSON.stringify({ accounts: [{ name: 'Suleiman' }, { name: 'Second account', token: 'sk-ant-oat01-old' }, { name: 'Dani', login: 'sk-ant-oat01-dani' }] }))
  assert.deepEqual(readAccounts(path).map(a => a.name), ['Suleiman', 'Dani'])
}))

test('the person\'s own login takes a name and can be put after another, but is never removed: the agent has it', withFile(path => {
  addAccount('Dani', 'sk-ant-oat01-dani', path)
  nameOwnAccount('Rom', path)
  assert.throws(() => nameOwnAccount('dani', path), /named dani already/)
  useFirst('Dani', path)
  assert.deepEqual(readAccounts(path).map(a => a.name), ['Dani', 'Rom'])
  removeAccount('Rom', path)
  removeAccount('Dani', path)
  assert.deepEqual(readAccounts(path).map(a => a.name), ['Rom'])
}))

test('a run takes the first account not at a limit, or the one it was told to when that one is free; a limit that says no time keeps the account out five hours', withFile(path => {
  addAccount('Dani', 'sk-ant-oat01-dani', path)
  let accounts = readAccounts(path)
  assert.equal(pickAccount(accounts, NOW)?.name, OWN_NAME)
  assert.equal(pickAccount(accounts, NOW, 'Dani')?.name, 'Dani')
  accounts = markLimited(OWN_NAME, NOW + 2 * HOUR, NOW, path)
  assert.equal(pickAccount(accounts, NOW)?.name, 'Dani')
  assert.equal(pickAccount(accounts, NOW + 2 * HOUR + 1)?.name, OWN_NAME)
  accounts = markLimited('Dani', undefined, NOW, path)
  assert.equal(pickAccount(accounts, NOW), undefined)
  assert.equal(accounts.find(a => a.name === 'Dani')?.limitedUntil, NOW + 5 * HOUR)
  assert.equal(freesIn(NOW + 3 * HOUR + 20 * 60_000, NOW), '3 h 20 min')
  assert.equal(freesIn(NOW + 2 * HOUR, NOW), '2 h')
  assert.equal(freesIn(NOW + 12 * 60_000, NOW), '12 min')
  assert.equal(freesIn(NOW, NOW), 'less than a minute')
  assert.equal(freesIn(NOW + 20 * 24 * HOUR, NOW), '20 days')
}))

test('whether an account is added is asked of the agent\'s own list: the person\'s own login alone is none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'accounts-added-'))
  try {
    const env = { XDG_CONFIG_HOME: dir }
    assert.equal(hasAddedAccount('claude', env), false)
    addAccount('Dani', 'x', accountsPath('claude', env))
    assert.equal(hasAddedAccount('claude', env), true)
    assert.equal(hasAddedAccount('codex', env), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a rotation reads the list of the environment it is asked in, or the file it was given, and takes the one it was told to first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'accounts-first-'))
  try {
    // The person's own login is there, in the environment: without one, a run takes the added accounts.
    const env = { XDG_CONFIG_HOME: dir, CLAUDE_CODE_OAUTH_TOKEN: 'own', CODEX_API_KEY: 'own' }
    addAccount('Dani', 'x', accountsPath('codex', env))
    addAccount('Rom', 'y', accountsPath('codex', env))
    assert.equal(accountRotation('codex').first(env)?.name, 'This computer')
    assert.equal(accountRotation('claude').first(env)?.name, 'This computer')
    assert.equal(accountRotation('codex', { prefer: 'Rom' }).first(env)?.name, 'Rom')
    assert.equal(accountRotation('claude', { path: accountsPath('codex', env), prefer: 'Rom' }).first({})?.name, 'Rom')
    markLimited('This computer', NOW + HOUR, NOW, accountsPath('codex', env))
    assert.equal(accountRotation('codex', { now: () => NOW }).first(env)?.name, 'Dani')
    assert.equal(accountRotation('claude', { path: accountsPath('codex', env), now: () => NOW, ownLoginThere: () => false }).first(env)?.name, 'Dani')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
