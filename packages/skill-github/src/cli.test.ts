import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner, type GitRunner } from '@openagt/agent-data'
import type { GhRunner } from './gh.js'
import { runCli, USAGE, type CliDeps } from './cli.js'
import { ASSETS_URL, byline } from './comment.js'

// The command line OpenAgent, the scheduler and an agent run: JSON on stdout, a line for a
// person on stderr, an exit code that says refusal or usage error. gh is scripted throughout.

interface Ran {
  code: number
  out: unknown
  err: string
}

async function run(cwd: string, argv: string[], deps: CliDeps = {}): Promise<Ran> {
  const outLines: string[] = []
  const errLines: string[] = []
  const code = await runCli(argv, { cwd, stdout: line => outLines.push(line), stderr: line => errLines.push(line) }, deps)
  return { code, out: outLines.length ? JSON.parse(outLines.join('\n')) : undefined, err: errLines.join('\n') }
}

const row = (over: Record<string, unknown> = {}) => ({ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN', title: 'T', isDraft: false, headRefName: 'agent-x', headRefOid: 'abc', createdAt: '2026-09-20T10:00:00Z', ...over })

test('no command, an unknown command, a bad flag: the usage, exit 2', async () => {
  assert.equal((await run('/r', [])).code, 2)
  assert.match((await run('/r', ['frobnicate'])).err, /usage: github/)
  const bad = await run('/r', ['requests', '--nope'])
  assert.equal(bad.code, 2)
  assert.ok(bad.err.endsWith(USAGE))
  assert.equal((await run('/r', ['merge', 'seven'])).code, 2)
  assert.equal((await run('/r', ['open'])).code, 2, '--title is required')
  assert.equal((await run('/r', ['requests', '--state', 'draft'])).code, 2)
})

test('requests: the flags become one gh listing, the rows come back as requests, and a gh that cannot answer is a git-host-failed refusal', async () => {
  const asked: string[][] = []
  const gh: GhRunner = async args => {
    asked.push(args)
    return JSON.stringify([row({ number: 8, state: 'MERGED', mergedAt: '2026-09-22T00:00:00Z', createdAt: '2026-09-21T00:00:00Z' }), row()])
  }
  const all = await run('/r', ['requests'], { gh })
  assert.equal(all.code, 0)
  assert.deepEqual((all.out as { number: number; state: string }[]).map(r => [r.number, r.state]), [[8, 'merged'], [7, 'open']])
  assert.deepEqual(asked[0]!.slice(0, 4), ['pr', 'list', '--state', 'all'])

  const some = await run('/r', ['requests', '--branch', 'agent-x', '--state', 'merged', '--since', '2026-09-22T00:00:00Z'], { gh })
  assert.deepEqual(asked[1]!.slice(0, 6), ['pr', 'list', '--state', 'merged', '--head', 'agent-x'])
  assert.deepEqual((some.out as { number: number }[]).map(r => r.number), [8])

  const failed = await run('/r', ['requests'], { gh: async () => Promise.reject(new Error('gh: not logged in')) })
  assert.equal(failed.code, 1)
  assert.deepEqual(failed.out, { ok: false, reason: 'git-host-failed', detail: 'gh: not logged in' })
  assert.match(failed.err, /could not be read: gh: not logged in/)
})

test('open: on the current branch or --branch, with the words given; --merge arms; the open one is answered as it is; the refusals', async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'github-cli-')))
  const git = nodeGitRunner()
  try {
    await git(['init', '-q', '-b', 'agent-fix'], dir)
    await git(['config', 'user.email', 't@t'], dir)
    await git(['config', 'user.name', 't'], dir)
    await writeFile(join(dir, 'a'), 'a')
    await git(['add', '-A'], dir)
    await git(['commit', '-q', '-m', 'init'], dir)

    const calls: string[][] = []
    let opened = false
    const gh: GhRunner = async args => {
      calls.push(args)
      if (args[1] === 'list') return JSON.stringify(opened ? [row({ number: 42, url: 'https://github.com/o/r/pull/42' })] : [])
      if (args[1] === 'create') {
        opened = true
        return 'https://github.com/o/r/pull/42\n'
      }
      if (args[1] === 'merge') throw new Error('auto-merge is not allowed for this repository')
      throw new Error(`unexpected ${args.join(' ')}`)
    }
    const watched: number[] = []
    const first = await run(dir, ['open', '--title', 'Fix it', '--body', 'Fixed.', '--merge'], { gh, watch: async (_r, n) => void watched.push(n) })
    assert.equal(first.code, 0)
    assert.deepEqual(first.out, { ok: true, branch: 'agent-fix', request: { number: 42, url: 'https://github.com/o/r/pull/42' }, existing: false, merge: { outcome: 'watching' } })
    assert.deepEqual(calls[1], ['pr', 'create', '--head', 'agent-fix', '--title', 'Fix it', '--body', 'Fixed.'])
    assert.deepEqual(watched, [42])

    const again = await run(dir, ['open', '--title', 'x', '--draft'], { gh })
    assert.deepEqual(again.out, { ok: true, branch: 'agent-fix', request: { number: 42, url: 'https://github.com/o/r/pull/42' }, existing: true })

    const other = await run(dir, ['open', '--branch', 'agent-other', '--title', 'Other'], { gh: async args => (args[1] === 'list' ? '[]' : Promise.reject(new Error('no commits between main and agent-other'))) })
    assert.equal(other.code, 1)
    assert.deepEqual(other.out, { ok: false, reason: 'open-failed', branch: 'agent-other', detail: 'no commits between main and agent-other' })
    assert.match(other.err, /agent-other could not be opened/)

    await git(['checkout', '-q', '--detach'], dir)
    const detached = await run(dir, ['open', '--title', 'x'], { gh })
    assert.equal(detached.code, 1)
    assert.deepEqual(detached.out, { ok: false, reason: 'no-branch' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('merge: a number, a draft marked ready first, then armed; not-open and merge-failed are refusals with their detail', async () => {
  const calls: string[][] = []
  const gh = (view: unknown, merge: () => Promise<string> = async () => ''): GhRunner => async args => {
    calls.push(args)
    if (args[1] === 'view') return JSON.stringify(view)
    if (args[1] === 'merge') return merge()
    return ''
  }
  const landed = await run('/r', ['merge', '5'], { gh: gh({ state: 'OPEN', isDraft: true }) })
  assert.equal(landed.code, 0)
  assert.deepEqual(landed.out, { ok: true, number: 5, outcome: 'auto-armed' })
  assert.deepEqual(calls.map(c => c[1]), ['view', 'ready', 'merge'])

  const closed = await run('/r', ['merge', '5'], { gh: gh({ state: 'MERGED' }) })
  assert.equal(closed.code, 1)
  assert.deepEqual(closed.out, { ok: false, reason: 'not-open', number: 5, state: 'MERGED' })
  assert.equal(closed.err, 'pull request 5 is merged, not open')

  const stuck = await run('/r', ['merge', '5'], { gh: gh({ state: 'OPEN' }, async () => Promise.reject(new Error('Pull request is not mergeable'))) })
  assert.deepEqual(stuck.out, { ok: false, reason: 'merge-failed', number: 5, detail: 'Pull request is not mergeable' })
  assert.match(stuck.err, /could not be landed: Pull request is not mergeable/)
})

test('home: the project page from origin, with the git host named; no origin, or not GitHub, is no-remote', async () => {
  const home = await run('/r', ['home'], { git: async () => 'git@github.com:o/r.git\n' })
  assert.equal(home.code, 0)
  assert.deepEqual(home.out, { ok: true, url: 'https://github.com/o/r', name: 'GitHub' })
  const gitlab = await run('/r', ['home'], { git: async () => 'git@gitlab.com:o/r.git\n' })
  assert.equal(gitlab.code, 1)
  assert.deepEqual(gitlab.out, { ok: false, reason: 'no-remote' })
  const none = await run('/r', ['home'], { git: async () => Promise.reject(new Error('fatal: No such remote')) })
  assert.deepEqual(none.out, { ok: false, reason: 'no-remote' })
})

test('create: only for a project with no origin; --check names the repository; the real one creates it private, as origin, pushed; each refusal in words', async () => {
  const noOrigin: GitRunner = async () => ''
  const calls: string[][] = []
  const gh: GhRunner = async args => {
    calls.push(args)
    return args[0] === 'api' ? 'suleiman\n' : 'https://github.com/suleiman/shop\n'
  }
  const offer = await run('/work/shop', ['create', '--check'], { gh, git: noOrigin })
  assert.equal(offer.code, 0)
  assert.deepEqual(offer.out, { ok: true, repository: 'suleiman/shop', name: 'GitHub' })
  assert.deepEqual(calls, [['api', 'user', '--jq', '.login']], 'a check creates nothing')

  calls.length = 0
  const created = await run('/work/shop', ['create'], { gh, git: noOrigin })
  assert.equal(created.code, 0)
  assert.deepEqual(created.out, { ok: true, repository: 'suleiman/shop', url: 'https://github.com/suleiman/shop', name: 'GitHub' })
  assert.deepEqual(calls[1], ['repo', 'create', 'suleiman/shop', '--private', '--source', '.', '--remote', 'origin', '--push'], 'private, set as origin, pushed')

  calls.length = 0
  const has = await run('/work/shop', ['create'], { gh, git: async () => 'origin\n' })
  assert.equal(has.code, 1)
  assert.deepEqual(has.out, { ok: false, reason: 'has-remote' })
  assert.equal(has.err, 'this project already has an origin remote')
  assert.deepEqual(calls, [], 'GitHub is not asked for a project that is already somewhere')

  const loggedOut = await run('/work/shop', ['create', '--check'], { gh: async () => Promise.reject(new Error('gh: not logged in')), git: noOrigin })
  assert.deepEqual(loggedOut.out, { ok: false, reason: 'not-logged-in', detail: 'gh: not logged in' })
  const taken = await run('/work/shop', ['create'], { gh: async args => (args[0] === 'api' ? 'suleiman\n' : Promise.reject(new Error('Name already exists on this account'))), git: noOrigin })
  assert.deepEqual(taken.out, { ok: false, reason: 'create-failed', detail: 'Name already exists on this account' })
  assert.equal(taken.err, 'the repository could not be created: Name already exists on this account')
})

test('me: who is signed in to GitHub, with name and picture when GitHub has them; nobody signed in is a refusal', async () => {
  const asked: string[][] = []
  const me = await run('/r', ['me'], { gh: async args => (asked.push(args), '{"login":"octo","name":"Octo Cat","avatar":"https://avatars.githubusercontent.com/u/1?v=4"}\n') })
  assert.equal(me.code, 0)
  assert.deepEqual(me.out, { ok: true, login: 'octo', name: 'Octo Cat', avatar: 'https://avatars.githubusercontent.com/u/1?v=4' })
  assert.deepEqual(asked[0]?.slice(0, 2), ['api', 'user'])
  const plain = await run('/r', ['me'], { gh: async () => '{"login":"octo","name":null,"avatar":"javascript:alert(1)"}' })
  assert.deepEqual(plain.out, { ok: true, login: 'octo' }, 'no name, and a picture address that is no https one is dropped')
  const nobody = await run('/r', ['me'], { gh: async () => { throw new Error('You are not logged into any GitHub hosts') } })
  assert.equal(nobody.code, 1)
  assert.deepEqual(nobody.out, { ok: false, reason: 'not-logged-in', detail: 'You are not logged into any GitHub hosts' })
})

test('comment: a new one on a pull request; GitHub answers its id and url; the usage errors and the refusal', async () => {
  const asked: string[][] = []
  const gh: GhRunner = async args => {
    asked.push(args)
    return JSON.stringify({ id: 99, url: 'https://github.com/o/r/pull/7#issuecomment-99' })
  }
  const posted = await run('/r', ['comment', '7', '--body', 'Working on it'], { gh, env: {} })
  assert.equal(posted.code, 0)
  assert.deepEqual(posted.out, { ok: true, id: 99, url: 'https://github.com/o/r/pull/7#issuecomment-99' })
  assert.deepEqual(asked[0]!.slice(0, 4), ['api', 'repos/{owner}/{repo}/issues/7/comments', '-f', 'body=🤖 *automated*\n\nWorking on it\n\n<!-- openagent -->'], 'no run record: the 🤖 line first; the hidden mark after the text')

  // An agent a runner started: the run record beside its log says the coding agent, the model and the effort.
  const dir = await mkdtemp(join(tmpdir(), 'comment-byline-'))
  try {
    await writeFile(join(dir, 'r1.json'), JSON.stringify({ id: 'r1', driver: 'claude-code', model: 'claude-sonnet-5-5', effort: 'high' }))
    await run('/r', ['comment', '7', '--body', 'Done'], { gh, env: { AGENT_DIARY: join(dir, 'r1.jsonl') } })
    assert.equal(asked[1]![3], `body=<img src="${ASSETS_URL}/claude.svg" width="16" height="16" align="top" alt="Claude Code"> sonnet-5-5 · high effort\n\nDone\n\n<!-- openagent -->`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  asked.length = 1

  assert.equal((await run('/r', ['comment', '7'], { gh })).code, 2, '--body is required')
  assert.equal((await run('/r', ['comment', '--body', 'x'], { gh })).code, 2, 'no pull request number')
  assert.equal((await run('/r', ['comment', 'abc', '--body', 'x'], { gh })).code, 2)
  assert.equal(asked.length, 1, 'a usage error asks GitHub nothing')

  const failed = await run('/r', ['comment', '7', '--body', 'x'], { gh: async () => JSON.stringify({ message: 'Not Found' }) })
  assert.equal(failed.code, 1)
  assert.deepEqual(failed.out, { ok: false, reason: 'git-host-failed', detail: 'GitHub answered no comment' })
})

test("a comment's first line: Codex's logo, light and dark, with its model as Codex names it; the model alone with no effort on the record; the 🤖 line for a coding agent with no logo, a record that cannot be read, or no log at all", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'comment-byline-'))
  try {
    const record = async (id: string, card: Record<string, unknown>) => (await writeFile(join(dir, `${id}.json`), JSON.stringify({ id, ...card })), join(dir, `${id}.jsonl`))
    assert.equal(await byline(await record('c', { driver: 'codex', model: 'gpt-5.6-terra', effort: 'medium' })), `<picture><source media="(prefers-color-scheme: dark)" srcset="${ASSETS_URL}/codex-dark.svg"><img src="${ASSETS_URL}/codex-light.svg" width="16" height="16" align="top" alt="Codex"></picture> gpt-5.6-terra · medium effort`)
    assert.match(await byline(await record('n', { driver: 'claude-code', model: 'claude-opus-5-5' })), /alt="Claude Code"> opus-5-5$/)
    assert.equal(await byline(await record('o', { driver: 'other-agent', model: 'x' })), '🤖 *automated*')
    assert.equal(await byline(join(dir, 'missing.jsonl')), '🤖 *automated*')
    assert.equal(await byline(undefined), '🤖 *automated*')
    assert.match(ASSETS_URL, /^https:\/\/cdn\.jsdelivr\.net\/npm\/@openagt\/skill-github@\d+\.\d+\.\d+\/assets$/, "this package's own version")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
