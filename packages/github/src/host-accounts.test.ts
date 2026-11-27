import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readCallersWith } from '@openagt/hooks'
import { ACCOUNTS_FRESH_MS, accountsChanged, accountsWiring, githubAccounts, hostAccounts, sendAs } from './host-accounts.js'
import type { GithubAccounts } from './cli.js'

// OpenAgent's GitHub accounts as the server keeps them: a read asks GitHub once per account, so the
// asks that come every few seconds (each push, each "Send as") take the last answer.

test('the accounts are read again at most once a minute, and at once after a press changed them', async () => {
  const real = accountsWiring.read
  let reads = 0
  accountsWiring.read = async () => (reads++, { accounts: [{ login: 'octo', ok: true, runs: true }] } as unknown as GithubAccounts)
  try {
    accountsChanged()
    const now = Date.now()
    await githubAccounts(now)
    for (let n = 0; n < 5; n++) await githubAccounts(now + 1_000 * n)
    assert.equal(reads, 1, 'a fresh answer is the answer')
    await githubAccounts(now + ACCOUNTS_FRESH_MS + 1)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(reads, 2, 'a minute old, it is read again behind the answer')
    accountsChanged()
    await githubAccounts(now + ACCOUNTS_FRESH_MS + 2)
    assert.equal(reads, 3, 'a press changed them: read again')
  } finally {
    accountsWiring.read = real
    accountsChanged()
  }
})

test('on a machine shared by a team, “Send as” offers a person their accounts and the shared ones, and sends as no other', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'send-as-team-'))
  const env = process.env['XDG_CONFIG_HOME']
  process.env['XDG_CONFIG_HOME'] = dir
  const real = accountsWiring.read
  accountsWiring.read = async () => ({ accounts: [{ login: 'owner-bot', ok: true, runs: true }, { login: 'rom-bot', ok: true, runs: false }] }) as unknown as GithubAccounts
  accountsChanged()
  writeFileSync(join(dir, 'openagent-github.json'), JSON.stringify({ runs: {}, team: { owners: { 'rom-bot': 'brillout' }, shared: [], runsFor: {} } }))
  try {
    readCallersWith(() => ({ login: 'brillout', owner: false, teamOwner: 'suleimansh' }))
    assert.deepEqual((await hostAccounts())[0]?.logins, ['rom-bot'])
    assert.deepEqual(await sendAs('github.com', 'owner-bot'), { ok: false, error: '@owner-bot is not your GitHub account here, and nobody shared it with the team.' })
    readCallersWith(() => ({ login: 'suleimansh', owner: true, teamOwner: 'suleimansh' }))
    assert.deepEqual((await hostAccounts())[0]?.logins, ['owner-bot'])
  } finally {
    readCallersWith(() => undefined)
    accountsWiring.read = real
    accountsChanged()
    if (env === undefined) delete process.env['XDG_CONFIG_HOME']
    else process.env['XDG_CONFIG_HOME'] = env
    rmSync(dir, { recursive: true, force: true })
  }
})
