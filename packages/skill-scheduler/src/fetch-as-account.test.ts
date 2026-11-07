import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GitRunner } from '@openagt/agent-data'
import { fetchingAsRunsAccount } from './scheduler.js'

/** git as a fake: origin is `url`; every call is written down. */
function fakeGit(url: string): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = []
  const git: GitRunner = async args => {
    calls.push(args)
    return args.join(' ') === 'remote get-url origin' ? `${url}\n` : ''
  }
  return { git, calls }
}

test("the start point's fetch goes as the account runs use, never the person's own login: with no account it is refused, and git never fetches", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scheduler-fetch-'))
  const previous = process.env.XDG_CONFIG_HOME
  // No account of OpenAgent's on this computer.
  process.env.XDG_CONFIG_HOME = dir
  try {
    // The git that would run as the account: never reached here.
    const asAccount = (): GitRunner => async () => assert.fail('fetched with no account to go as')
    const hosted = fakeGit('https://github.com/acme/shop.git')
    await assert.rejects(fetchingAsRunsAccount(dir, hosted.git, asAccount)(['fetch', '--quiet', 'origin', 'main'], dir), /account/)
    assert.ok(!hosted.calls.some(args => args[0] === 'fetch'))
    // A host no package answers for: no account to go as either, so no fetch with the person's own login.
    const elsewhere = fakeGit('https://gitlab.com/acme/shop.git')
    await assert.rejects(fetchingAsRunsAccount(dir, elsewhere.git, asAccount)(['fetch', '--quiet', 'origin', 'main'], dir), /no account of OpenAgent's to fetch as/)
    assert.ok(!elsewhere.calls.some(args => args[0] === 'fetch'))
    // A remote that is a folder on this disk asks no login; other commands are git's own.
    const folder = fakeGit('/srv/origin.git')
    await fetchingAsRunsAccount(dir, folder.git)(['fetch', '--quiet', 'origin', 'main'], dir)
    await fetchingAsRunsAccount(dir, folder.git)(['rev-parse', 'HEAD'], dir)
    assert.deepEqual(folder.calls.filter(args => args[0] !== 'remote'), [['fetch', '--quiet', 'origin', 'main'], ['rev-parse', 'HEAD']])
  } finally {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
})
