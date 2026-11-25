import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { providedGitHost } from './git-host.js'
import { DISTRIBUTION_ENV } from '@openagt/hooks'
import { handDownTestDistribution } from '../test-distribution.js'

handDownTestDistribution()

// The git host contract (#1820): a project's package declares `"openagent": { "git-host": "<command>" }`
// and OpenAgent finds the project's page there by running that command. Real processes: a tiny provider script that logs each
// call it answers, in a throwaway project.

/** A provider command: answers each command line of the contract from JSON files, logging every call. */
const PROVIDER = `
const { readFileSync, appendFileSync } = require('node:fs')
const { join } = require('node:path')
const args = process.argv.slice(2)
appendFileSync(join(__dirname, 'calls.log'), args.join(' ') + '\\n')
const answer = name => process.stdout.write(readFileSync(join(__dirname, name), 'utf8'))
if (args[0] === 'home') answer('home.json')
`

/**
 * A throwaway project, and a distribution of `deps` handed down to this process: each installed
 * under the project's node_modules with its own package.json, every project's.
 */
async function project(deps: Record<string, Record<string, unknown>>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'openagent-git host-')))
  await writeFile(join(root, 'distribution.mjs'), `export default ${JSON.stringify(Object.keys(deps).map(name => ({ package: name })))}\n`)
  process.env[DISTRIBUTION_ENV] = join(root, 'distribution.mjs')
  for (const [name, manifest] of Object.entries(deps)) {
    const dir = join(root, 'node_modules', name)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name, ...manifest }))
    await writeFile(join(dir, 'provider.cjs'), PROVIDER)
    await writeFile(join(dir, 'home.json'), JSON.stringify({ ok: true, url: 'https://github.com/o/r', name: 'GitHub' }))
  }
  return root
}

const GIT_HOST = { github: { bin: { github: 'provider.cjs' }, openagent: { 'git-host': 'github' } } }

const calls = async (root: string, pkg: string): Promise<string[]> =>
  (await readFile(join(root, 'node_modules', pkg, 'calls.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean)

test("a project with no git host package has no git host; one with a provider is read through its command line", async () => {
  const none = await project({ plain: { bin: { plain: 'provider.cjs' } } })
  const noneHas = await providedGitHost()(none)
  const root = await project(GIT_HOST)
  try {
    assert.equal(noneHas, undefined)
    const gitHost = (await providedGitHost()(root))!
    assert.ok(gitHost)
    assert.deepEqual(await gitHost.home(), { url: 'https://github.com/o/r', name: 'GitHub' })
    assert.deepEqual(await calls(root, 'github'), [
      // Asked first for the project's page there: the git host is the project's only when it knows it.
      'home',
      'home',
    ])
  } finally {
    await rm(none, { recursive: true, force: true })
    await rm(root, { recursive: true, force: true })
  }
})

test('the provider is looked up again after the window, or when changed() says so', async () => {
  const root = await project(GIT_HOST)
  try {
    let clock = 1_000_000
    const reader = providedGitHost(() => clock)
    const first = await reader(root)
    assert.equal(await reader(root), first, 'the same source within the window')
    clock += 6_000
    assert.equal(await reader(root), first, 'the same command still provides: the same source')
    // The project's remote moved off the host: the provider no longer knows the project's page there.
    await writeFile(join(root, 'node_modules', 'github', 'home.json'), JSON.stringify({ ok: false }))
    assert.equal(await reader(root), first, 'within the window, the source known')
    reader.changed(root)
    assert.equal(await reader(root), undefined, 'looked up again: a git host that knows no page of the project is none of its')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
