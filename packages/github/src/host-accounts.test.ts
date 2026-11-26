import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ACCOUNTS_FRESH_MS, accountsChanged, accountsWiring, githubAccounts } from './host-accounts.js'
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
