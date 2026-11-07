import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HOSTED_MAX_AGE_MS, forgetHosted, hostedWiring, readHosted } from './hosted-repos.js'
import { onRepoSources, sendAddRepoOwner, sendRemoveRepoOwner } from './projects.js'

// The git hosts' repositories the picker lists: each OpenAgent account's own, as itself, and each
// owner the person named, as the account runs use; read behind the answer and kept.

const listing = (owner: string, names: string[]) => ({ ok: true as const, output: { ok: true, owner, repos: names.map(name => ({ address: `github.com/${owner}/${name}`, url: `https://github.com/${owner}/${name}`, private: name.startsWith('secret') })) } })

async function withHosts(body: (asked: string[][], clock: { now: number }) => Promise<void>): Promise<void> {
  const before = { ...hostedWiring }
  const asked: string[][] = []
  const clock = { now: 1_000_000 }
  Object.assign(hostedWiring, {
    hosts: async () => [{ host: 'github.com', logins: ['octo', 'octo-agent'], runs: 'octo' }],
    owners: async () => ['github.com/vikejs', 'gitlab.com/elsewhere'],
    now: () => clock.now,
    run: async (_host: string, args: string[]) => {
      asked.push(args)
      if (args[1] === '--user') return listing(args[2]!, args[2] === 'octo' ? ['shop', 'secret-notes'] : ['shop'])
      return listing(args[2]!, ['vike', 'bati'])
    },
  })
  forgetHosted()
  try {
    await body(asked, clock)
  } finally {
    Object.assign(hostedWiring, before)
    forgetHosted()
  }
}

test("each account's own repositories, as itself, then each named owner's at that host; one address listed once", () =>
  withHosts(async asked => {
    const read = await readHosted()
    assert.equal(read.loading, false)
    assert.deepEqual(
      read.repos.map(repo => [repo.address, repo.from, repo.private]),
      [
        ['github.com/octo/shop', '@octo', false],
        ['github.com/octo/secret-notes', '@octo', true],
        ['github.com/octo-agent/shop', '@octo-agent', false],
        ['github.com/vikejs/vike', 'vikejs', false],
        ['github.com/vikejs/bati', 'vikejs', false],
      ],
    )
    assert.deepEqual(asked, [['repos', '--user', 'octo'], ['repos', '--user', 'octo-agent'], ['repos', '--owner', 'vikejs']], 'an owner at a host with no account is not asked')
  }))

test('the lists are kept: a read answers them at once, and asks the hosts again behind the answer once they are old', () =>
  withHosts(async (asked, clock) => {
    await readHosted()
    asked.length = 0
    assert.equal((await readHosted()).repos.length, 5)
    assert.deepEqual(asked, [], 'fresh: nothing asked')
    clock.now += HOSTED_MAX_AGE_MS + 1
    const old = await readHosted()
    assert.equal(old.repos.length, 5, 'the kept lists, at once')
    assert.equal(old.loading, true)
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(asked.length, 3, 'asked again behind it')
  }))

test('a host that answers slowly: the first read says the lists are on their way, and a later read has them', () =>
  withHosts(async () => {
    let answer: () => void = () => {}
    const slow = new Promise<void>(resolve => (answer = resolve))
    const fast = hostedWiring.run
    hostedWiring.run = async (host, args) => (await slow, fast(host, args))
    assert.deepEqual(await readHosted(), { repos: [], loading: true })
    answer()
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal((await readHosted()).repos.length, 5)
  }))

test('Settings › Repos names an owner as a person types it, GitHub when no host is said, kept in their own folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-repo-owners-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true })
  const before = { ...hostedWiring }
  Object.assign(hostedWiring, { hosts: async () => [], owners: async () => [] })
  try {
    for (const typed of ['vikejs', '@brillout', 'https://github.com/Vikejs/', 'gitlab.example.com/team']) assert.deepEqual(await sendAddRepoOwner(typed), { ok: true })
    assert.deepEqual((await onRepoSources()).owners, ['github.com/vikejs', 'github.com/brillout', 'gitlab.example.com/team'], 'the same owner once')
    assert.equal((await sendAddRepoOwner('vikejs/vike')).ok, false, 'a repository is no owner')
    assert.deepEqual(await sendRemoveRepoOwner('github.com/brillout'), { ok: true })
    assert.deepEqual((await onRepoSources()).owners, ['github.com/vikejs', 'gitlab.example.com/team'])
  } finally {
    Object.assign(hostedWiring, before)
    forgetHosted()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
})
