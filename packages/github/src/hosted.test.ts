import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HOSTED_MAX_AGE_MS, addOwner, forgetHosted, hostedWiring, readHosted, readOwners, removeOwner } from './hosted.js'
import { readRepoOwners } from '@openagt/projects'

// The GitHub repositories the picker lists: each OpenAgent account's own, as itself, and each
// owner the person named, as the account runs use; read behind the answer and kept.

const listing = (owner: string, names: string[]) => ({ ok: true as const, output: { ok: true, owner, repos: names.map(name => ({ address: `github.com/${owner}/${name}`, url: `https://github.com/${owner}/${name}`, private: name.startsWith('secret') })) } })

async function withHosts(body: (asked: string[][], clock: { now: number }) => Promise<void>): Promise<void> {
  const before = { ...hostedWiring }
  const asked: string[][] = []
  const clock = { now: 1_000_000 }
  Object.assign(hostedWiring, {
    hosts: async () => [{ host: 'github.com', logins: ['octo', 'octo-agent'], runs: 'octo' }],
    owners: async () => ['github.com/vikejs', 'gitlab.com/elsewhere'],
    teammatesOwners: async () => [],
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

test('a host that cannot be reached is said so, with what the others listed', () =>
  withHosts(async () => {
    const reached = hostedWiring.run
    hostedWiring.run = async (host, args) => (args[2] === 'vikejs' ? Promise.reject(new Error('getaddrinfo ENOTFOUND api.github.com')) : reached(host, args))
    const read = await readHosted()
    assert.equal(read.unreached, true)
    assert.equal(read.repos.length, 3)
    assert.equal((await readHosted()).unreached, true, 'kept with the lists')
  }))

test('Settings › GitHub names an owner as a person types it, kept in their own folder beside what other hosts keep there', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'oa-repo-owners-'))
  const previous = process.env.XDG_CONFIG_HOME
  process.env.XDG_CONFIG_HOME = join(dir, 'cfg')
  mkdirSync(process.env.XDG_CONFIG_HOME, { recursive: true })
  const before = { ...hostedWiring }
  Object.assign(hostedWiring, { hosts: async () => [] })
  try {
    for (const typed of ['vikejs', '@brillout', 'https://github.com/Vikejs/', 'github.com/team']) assert.deepEqual(await addOwner(typed), { ok: true })
    assert.deepEqual(await readOwners(), ['vikejs', 'brillout', 'team'], 'the same owner once')
    assert.equal((await addOwner('vikejs/vike')).ok, false, 'a repository is no owner')
    assert.deepEqual(await removeOwner('brillout'), { ok: true })
    assert.deepEqual(await readRepoOwners(), ['github.com/vikejs', 'github.com/team'])
  } finally {
    Object.assign(hostedWiring, before)
    forgetHosted()
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = previous
    rmSync(dir, { recursive: true, force: true })
  }
})

test('on a machine shared by a team, each person is shown what their accounts and the shared ones list, and the owners they named', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hosted-team-'))
  const before = process.env['XDG_CONFIG_HOME']
  process.env['XDG_CONFIG_HOME'] = dir
  try {
    await withHosts(async asked => {
      hostedWiring.teammatesOwners = async () => ['github.com/brillout']
      hostedWiring.run = async (_host: string, args: string[]) => {
        asked.push(args)
        if (args[1] === '--user') return listing(args[2]!, args[2] === 'octo' ? ['shop', 'secret-notes'] : ['shop'])
        return listing(args[2]!, args[2] === 'brillout' ? ['vike-plus', 'secret-plans'] : ['vike', 'bati'])
      }
      const owner = { login: 'suleimansh', owner: true, teamOwner: 'suleimansh' }
      const rom = { login: 'brillout', owner: false, teamOwner: 'suleimansh' }
      const shown = async (caller: typeof owner) => (await readHosted(caller)).repos.map(repo => repo.address)
      // The machine's accounts, from before Team mode, are its owner's, and so are the owners kept with the machine's person.
      assert.deepEqual(await shown(owner), ['github.com/octo/shop', 'github.com/octo/secret-notes', 'github.com/octo-agent/shop', 'github.com/vikejs/vike', 'github.com/vikejs/bati'])
      // Rom has no account here: none of the owner's repositories; the owner he named, its public repositories.
      assert.equal((await addOwner('brillout', rom)).ok, true)
      assert.deepEqual(await readOwners(rom), ['brillout'])
      assert.deepEqual(await readOwners(owner), ['vikejs'], 'his owners are his own, the machine’s untouched')
      assert.deepEqual(await shown(rom), ['github.com/brillout/vike-plus'])
      // An account its owner shares: listed for him too.
      writeFileSync(join(dir, 'openagent-github.json'), JSON.stringify({ runs: {}, team: { owners: {}, shared: ['octo-agent'], runsFor: {} } }))
      assert.deepEqual(await shown(rom), ['github.com/octo-agent/shop', 'github.com/brillout/vike-plus'])
      // With no team, every row, as before.
      assert.equal((await readHosted()).repos.length, 7)
    })
  } finally {
    if (before === undefined) delete process.env['XDG_CONFIG_HOME']
    else process.env['XDG_CONFIG_HOME'] = before
    rmSync(dir, { recursive: true, force: true })
  }
})
