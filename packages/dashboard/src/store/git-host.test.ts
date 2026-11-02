import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseRequests, providedGitHost } from './git-host.js'

// The git host contract (#1820): a project's package declares `"openagent": { "git-host": "<command>" }`
// and OpenAgent reads the project's pull requests, opens one, lands one and finds the
// project's page by running that command. Real processes: a tiny provider script that logs each
// call it answers, in a throwaway project.

/** A provider command: answers each command line of the contract from JSON files, logging every call. */
const PROVIDER = `
const { readFileSync, appendFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
appendFileSync(join(__dirname, 'calls.log'), args.join(' ') + '\\n')
const answer = name => process.stdout.write(readFileSync(join(__dirname, name), 'utf8'))
if (args[0] === 'requests') { if (args.includes('--branch') && args[args.indexOf('--branch') + 1] === 'unreachable') { process.stderr.write('gh: could not resolve to a Repository\\n'); process.exit(1) } answer('requests.json') }
else if (args[0] === 'open') answer(args.includes('--draft') ? 'open-existing.json' : 'open.json')
else if (args[0] === 'merge') { if (args[1] === '8') { process.stderr.write('pull request 8 is merged, not open\\n'); process.exit(1) } answer('merge.json') }
else if (args[0] === 'home') answer('home.json')
`

const REQUEST = { number: 7, url: 'https://x/pull/7', state: 'open', title: 'T', draft: false, branch: 'agent-run-1', head: 'abc', createdAt: '2026-09-01T00:00:00Z' }

/** A project whose package.json lists `deps`, each installed under node_modules with its own package.json. */
async function project(deps: Record<string, Record<string, unknown>>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-git host-')))
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: Object.fromEntries(Object.keys(deps).map(name => [name, '*'])) }))
  for (const [name, manifest] of Object.entries(deps)) {
    const dir = join(root, 'node_modules', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, ...manifest }))
    await writeFile(join(dir, 'provider.cjs'), PROVIDER)
    await writeFile(join(dir, 'requests.json'), JSON.stringify([REQUEST, { ...REQUEST, number: 6, state: 'merged', mergedAt: '2026-09-02T00:00:00Z', mergeCommit: 'm6' }, { number: 'x' }]))
    await writeFile(join(dir, 'open.json'), JSON.stringify({ ok: true, request: { number: 9, url: 'https://x/pull/9' }, existing: false }))
    await writeFile(join(dir, 'open-existing.json'), JSON.stringify({ ok: true, request: { number: 7, url: 'https://x/pull/7' }, existing: true }))
    await writeFile(join(dir, 'merge.json'), JSON.stringify({ ok: true, number: 7, outcome: 'auto-armed' }))
    await writeFile(join(dir, 'home.json'), JSON.stringify({ ok: true, url: 'https://github.com/o/r', name: 'GitHub' }))
  }
  return root
}

const GIT_HOST = { github: { bin: { github: 'provider.cjs' }, openagent: { 'git-host': 'github' } } }

const calls = async (root: string, pkg: string): Promise<string[]> =>
  (await readFile(join(root, 'node_modules', pkg, 'calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean)

test('a project with no git host package has no git host; one with a provider is read and moved through its command line', async () => {
  const none = await project({ plain: { bin: { plain: 'provider.cjs' } } })
  const root = await project(GIT_HOST)
  try {
    assert.equal(await providedGitHost()(none), undefined)
    const gitHost = (await providedGitHost()(root))!
    assert.ok(gitHost)
    assert.deepEqual(await gitHost.requests(), { ok: true, requests: [REQUEST, { ...REQUEST, number: 6, state: 'merged', mergedAt: '2026-09-02T00:00:00Z', mergeCommit: 'm6' }] }, 'a row without the facts a request needs is no request')
    assert.deepEqual(await gitHost.requests({ branch: 'agent-run-1', state: 'open', since: '2026-09-01T00:00:00Z' }), { ok: true, requests: [REQUEST, { ...REQUEST, number: 6, state: 'merged', mergedAt: '2026-09-02T00:00:00Z', mergeCommit: 'm6' }] })
    assert.deepEqual(await gitHost.requests({ branch: 'unreachable' }), { ok: false, error: 'gh: could not resolve to a Repository' }, '"could not tell" is not "none"')
    assert.deepEqual(await gitHost.open('agent-run-1', { title: 'T', body: 'B' }), { ok: true, request: { number: 9, url: 'https://x/pull/9' }, existing: false })
    assert.deepEqual(await gitHost.open('agent-run-1', { title: 'T', draft: true }), { ok: true, request: { number: 7, url: 'https://x/pull/7' }, existing: true })
    assert.deepEqual(await gitHost.merge(7), { ok: true, outcome: 'auto-armed' })
    assert.deepEqual(await gitHost.merge(8), { ok: false, error: 'pull request 8 is merged, not open' }, "a refusal is the provider's own line")
    assert.deepEqual(await gitHost.home(), { url: 'https://github.com/o/r', name: 'GitHub' })
    assert.deepEqual(await calls(root, 'github'), [
      'requests',
      'requests --branch agent-run-1 --state open --since 2026-09-01T00:00:00Z',
      'requests --branch unreachable',
      'open --branch agent-run-1 --title T --body B',
      'open --branch agent-run-1 --title T --draft',
      'merge 7',
      'merge 8',
      'home',
    ])
  } finally {
    await rm(none, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
})

test('the provider is looked up again after the window, or when changed() says so; parseRequests keeps the rows with a number, a url and a known state', async () => {
  const root = await project(GIT_HOST)
  try {
    let clock = 1_000_000
    const reader = providedGitHost(() => clock)
    const first = await reader(root)
    assert.equal(await reader(root), first, 'the same source within the window')
    clock += 6_000
    assert.equal(await reader(root), first, 'the same command still provides: the same source')
    await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: {} }))
    reader.changed(root)
    assert.equal(await reader(root), undefined, 'the package dropped: no git host')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
  assert.deepEqual(parseRequests([{ number: 1, url: 'u', state: 'closed' }, { number: 2, url: 'u', state: 'OPEN' }, { number: 3, state: 'open' }, null, 'x']), [
    { number: 1, url: 'u', state: 'closed', title: '', draft: false, branch: '', head: '', createdAt: '' },
  ])
  assert.deepEqual(parseRequests({ not: 'a list' }), [])
})
