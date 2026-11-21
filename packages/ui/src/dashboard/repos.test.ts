import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CRAWL_BEHIND_LIMIT_MS, CRAWL_LIMIT_MS, crawlRepos, originUrlOf, repoIndex, type Crawl, type CrawlFs, type FoundRepo } from './repos.js'

// The repos on this computer: a crawl of folders, shallowest first, that stops at a repository and
// at a strict time limit, and a kept list read again once it is old.

/** A folder tree on disk: each path a folder, a path ending in `.git/config` a repository's config. */
async function tree(paths: Record<string, string | null>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-repos-')))
  for (const [path, contents] of Object.entries(paths)) {
    if (contents === null) await mkdir(join(root, path), { recursive: true })
    else {
      await mkdir(join(root, path, '..'), { recursive: true })
      await writeFile(join(root, path), contents)
    }
  }
  return root
}

const ORIGIN = '[core]\n\tbare = false\n[remote "upstream"]\n\turl = git@github.com:other/x.git\n[remote "origin"]\n\turl = https://github.com/vikejs/vike.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'

test('a repo\'s address is its origin\'s url, and none without an origin', () => {
  assert.equal(originUrlOf(ORIGIN), 'https://github.com/vikejs/vike.git')
  assert.equal(originUrlOf('[remote "upstream"]\n\turl = git@github.com:other/x.git\n'), undefined)
})

test('the crawl finds the repos under a folder, with their addresses, by name, and goes into none of them', async () => {
  const root = await tree({
    'Projects/vike/.git/config': ORIGIN,
    'Projects/vike/packages/inner/.git/config': '',
    'Projects/org/shop/.git': null,
    'z-first/Zeta/.git': null,
    'notes': null,
  })
  try {
    // By name, whatever order the reads landed in.
    assert.deepEqual(await crawlRepos([root]), {
      repos: [
        { path: join(root, 'Projects/org/shop'), name: 'shop' },
        { path: join(root, 'Projects/vike'), name: 'vike', url: 'https://github.com/vikejs/vike.git' },
        { path: join(root, 'z-first/Zeta'), name: 'Zeta' },
      ],
      whole: true,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the crawl skips hidden folders, package installs and the home\'s system folders, and stops at its depth', async () => {
  const root = await tree({
    '.cache/hidden/.git': null,
    'node_modules/pkg/.git': null,
    'Library/thing/.git': null,
    'a/b/c/d/deep/.git': null,
    'a/b/c/near/.git': null,
  })
  try {
    assert.deepEqual((await crawlRepos([root], { depth: 4 })).repos.map(repo => repo.name), ['near'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a root that is a repository is one, and is still looked through: a home folder can be one', async () => {
  const root = await tree({ '.git': null, 'Projects/app/.git': null })
  try {
    assert.deepEqual((await crawlRepos([root])).repos.map(repo => repo.path).sort(), [root, join(root, 'Projects/app')].sort())
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the crawl stops at its time limit, and answers what it found by then: the shallow repos first', async () => {
  let clock = 0
  // Every read takes 600ms of the clock: the first two levels fit in the second the crawl has, the third does not.
  const fs: CrawlFs = {
    async entries(path) {
      clock += 600
      const below: Record<string, { name: string; directory: boolean }[]> = {
        '/h': [{ name: 'near', directory: true }, { name: 'far', directory: true }],
        '/h/near': [{ name: '.git', directory: true }],
        '/h/far': [{ name: 'deeper', directory: true }],
        '/h/far/deeper': [{ name: '.git', directory: true }],
      }
      return below[path] ?? []
    },
    read: async () => undefined,
  }
  const found = await crawlRepos(['/h'], { fs, limitMs: 1000, now: () => clock })
  assert.deepEqual(found, { repos: [{ path: '/h/near', name: 'near' }], whole: false })
})

test('the kept list: the first read waits on a crawl, a fresh one is kept, an old one is answered and crawled again behind it', async () => {
  let clock = 0
  let crawls = 0
  let next: FoundRepo[] = [{ path: '/a', name: 'a' }]
  const index = repoIndex(async () => ['/h'], { now: () => clock, maxAgeMs: 1000, crawl: async () => (crawls++, { repos: next, whole: true }) })
  assert.deepEqual(await index.read(), { repos: [{ path: '/a', name: 'a' }], looking: false })
  next = [{ path: '/b', name: 'b' }]
  clock = 500
  assert.deepEqual(await index.read(), { repos: [{ path: '/a', name: 'a' }], looking: false })
  assert.equal(crawls, 1)
  clock = 2000
  // Old: the kept list now, and a crawl behind it whose answer the next read has.
  assert.deepEqual(await index.read(), { repos: [{ path: '/a', name: 'a' }], looking: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(crawls, 2)
  assert.deepEqual(await index.read(), { repos: [{ path: '/b', name: 'b' }], looking: false })
  // A refresh crawls now, and answers what it found.
  next = [{ path: '/c', name: 'c' }]
  assert.deepEqual(await index.refresh(), { repos: [{ path: '/c', name: 'c' }], looking: false })
})

test('a first crawl cut short is answered as still looking, and one with time enough follows it at once', async () => {
  const limits: number[] = []
  const answers: Crawl[] = [
    { repos: [{ path: '/h/near', name: 'near' }], whole: false },
    { repos: [{ path: '/h/Projects/app', name: 'app' }, { path: '/h/near', name: 'near' }], whole: true },
  ]
  let landed!: () => void
  const behind = new Promise<void>(resolve => (landed = resolve))
  const index = repoIndex(async () => ['/h'], {
    crawl: async (_roots, limitMs) => {
      limits.push(limitMs)
      const answer = answers[limits.length - 1]!
      if (limits.length === 2) await behind
      return answer
    },
  })
  assert.deepEqual(await index.read(), { repos: [{ path: '/h/near', name: 'near' }], looking: true })
  // The second crawl is on its way, with the time nobody waits on: a read meanwhile starts no third.
  assert.deepEqual(await index.read(), { repos: [{ path: '/h/near', name: 'near' }], looking: true })
  assert.deepEqual(limits, [CRAWL_LIMIT_MS, CRAWL_BEHIND_LIMIT_MS])
  landed()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(await index.read(), { repos: answers[1]!.repos, looking: false })
  assert.equal(limits.length, 2)
})

test('a crawl with time enough that is still cut short is the list: it is not looked for again until it is old', async () => {
  let crawls = 0
  const index = repoIndex(async () => ['/h'], {
    crawl: async () => (crawls++, { repos: [{ path: '/h/near', name: 'near' }], whole: false }),
  })
  await index.read()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(await index.read(), { repos: [{ path: '/h/near', name: 'near' }], looking: false })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(crawls, 2)
})
