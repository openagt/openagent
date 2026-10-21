import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, readFile, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { nodeGitRunner } from '@openagt/agent-data'
import { runCli, worktreePath } from './index.js'

// `cleanup` through the command line, on a real repository with a real remote: the tool's own
// checkouts, directory and rules go; work, branches, the remote and other tools' files stay.

const git = nodeGitRunner()

/** A repository with one commit pushed to a bare `origin` beside it, and a person's own exclude line. */
async function project(): Promise<{ base: string; repo: string }> {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'branches-cleanup-')))
  const repo = join(base, 'repo')
  await mkdir(repo)
  await git(['init', '-q', '-b', 'main'], repo)
  await git(['config', 'user.email', 't@t'], repo)
  await git(['config', 'user.name', 't'], repo)
  await writeFile(join(repo, 'index.html'), '<h1>Hello</h1>\n')
  await git(['add', '-A'], repo)
  await git(['commit', '-q', '-m', 'init'], repo)
  await git(['init', '-q', '--bare', join(base, 'origin.git')], base)
  await git(['remote', 'add', 'origin', join(base, 'origin.git')], repo)
  await git(['push', '-q', '-u', 'origin', 'main'], repo)
  await writeFile(join(repo, '.git', 'info', 'exclude'), '# mine\n/notes.txt\n')
  return { base, repo }
}

async function run(cwd: string, ...argv: string[]): Promise<{ code: number; out: unknown }> {
  const lines: string[] = []
  const code = await runCli(argv, { cwd, stdout: line => lines.push(line), stderr: () => {} })
  return { code, out: lines.length ? JSON.parse(lines.join('\n')) : undefined }
}

async function commitWork(path: string): Promise<void> {
  await writeFile(join(path, 'index.html'), '<h1>Welcome</h1>\n')
  await git(['add', '-A'], path)
  await git(['commit', '-q', '-m', 'work'], path)
}

const exists = (path: string): Promise<boolean> => stat(path).then(() => true, () => false)
const excludeOf = (repo: string): Promise<string> => readFile(join(repo, '.git', 'info', 'exclude'), 'utf8')
const branches = async (repo: string): Promise<string[]> => (await git(['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads'], repo)).trim().split('\n')
/** What a clean-up must leave as it found it: the remote's branches, the person's branch and its files. */
const outside = async (repo: string): Promise<string> => [await git(['ls-remote', 'origin'], repo), await git(['rev-parse', 'main'], repo), await git(['status', '--porcelain'], repo)].join('---\n')

test('cleanup: checkouts go under the reclaim rule; uncommitted work, branches with work and another tool\'s checkout stay, each named', async () => {
  const { base, repo } = await project()
  try {
    const before = await outside(repo)
    await run(repo, 'create', 'done')
    await run(repo, 'create', 'dirty')
    await commitWork(worktreePath(repo, 'done'))
    await writeFile(join(worktreePath(repo, 'dirty'), 'index.html'), '<h1>Edited</h1>\n')
    // The agent named its work: a link named as the branch sits beside the checkout.
    await run(worktreePath(repo, 'dirty'), 'name', 'fix-title')
    assert.equal(await readlink(join(repo, '.branches', 'agent-fix-title')), 'agent-dirty')
    // Another tool's checkout in the same directory.
    await mkdir(join(repo, '.branches', 'agent-data'))
    await writeFile(join(repo, '.branches', 'agent-data', 'card.json'), '{}\n')
    const work = (await branches(repo)).find(line => line.startsWith('agent-done '))

    const first = await run(repo, 'cleanup')
    assert.equal(first.code, 0)
    assert.deepEqual(first.out, {
      ok: true,
      removed: ['.branches/agent-done'],
      kept: [
        { path: '.branches/agent-dirty', reason: 'agent-fix-title has uncommitted work; the checkout was kept' },
        { path: '.branches/agent-data', reason: 'not made by branches' },
      ],
    })
    assert.equal(await exists(worktreePath(repo, 'done')), false)
    assert.equal(await readFile(join(worktreePath(repo, 'dirty'), 'index.html'), 'utf8'), '<h1>Edited</h1>\n', 'uncommitted work is untouched')
    assert.equal(await readFile(join(repo, '.branches', 'agent-data', 'card.json'), 'utf8'), '{}\n')
    assert.equal(await readlink(join(repo, '.branches', 'agent-fix-title')), 'agent-dirty', 'the kept checkout keeps its link')
    assert.ok((await branches(repo)).includes(work!), 'the branch with work on it stays, at the same commit')
    const hidden = await excludeOf(repo)
    // The skill's own links are hidden in each checkout itself (`skill-links.ts`): no rule.
    for (const rule of ['/.branches', '/node_modules/@openagt/skill-branches', '/node_modules/.bin/branches']) {
      assert.ok(hidden.split('\n').includes(rule), `${rule} still hides what a kept checkout holds`)
    }
    assert.equal(await outside(repo), before)

    // The person commits the work and the other tool takes its checkout away.
    await git(['add', '-A'], worktreePath(repo, 'dirty'))
    await git(['commit', '-q', '-m', 'edited'], worktreePath(repo, 'dirty'))
    await rm(join(repo, '.branches', 'agent-data'), { recursive: true })
    const kept = (await branches(repo)).filter(line => line.startsWith('agent-'))
    assert.equal(kept.length, 2)

    const second = await run(repo, 'cleanup')
    assert.deepEqual(second.out, { ok: true, removed: ['.branches/agent-dirty', '.branches'], kept: [] })
    assert.equal(await exists(join(repo, '.branches')), false)
    assert.equal(await excludeOf(repo), '# mine\n/notes.txt\n', 'only this tool\'s rules went')
    assert.deepEqual((await branches(repo)).filter(line => line.startsWith('agent-')), kept, 'both branches hold work and stay')
    assert.equal(await git(['worktree', 'list', '--porcelain'], repo).then(list => list.match(/^worktree /gm)?.length), 1, 'no checkout is left registered')
    assert.equal(await outside(repo), before)

    assert.deepEqual((await run(repo, 'cleanup')).out, { ok: true, removed: [], kept: [] }, 'a second pass finds nothing')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('cleanup: a project this tool never worked in is left exactly as it is', async () => {
  const { base, repo } = await project()
  try {
    const before = await outside(repo)
    assert.deepEqual((await run(repo, 'cleanup')).out, { ok: true, removed: [], kept: [] })
    assert.equal(await excludeOf(repo), '# mine\n/notes.txt\n')
    assert.equal(await outside(repo), before)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('cleanup: the rules are the repository\'s: they stay while another checkout of it holds what they hide, and a rule this pass removed nothing for stays', async () => {
  const { base, repo } = await project()
  try {
    // The same rules written by hand, in a project the tool never worked in.
    const byHand = '/.branches\n/node_modules/@openagt/skill-branches\n/node_modules/.bin/branches\n/.claude/skills/branches\n/.agents/skills/branches\n'
    await writeFile(join(repo, '.git', 'info', 'exclude'), byHand)
    assert.deepEqual((await run(repo, 'cleanup')).out, { ok: true, removed: [], kept: [] })
    assert.equal(await excludeOf(repo), byHand)

    // A second checkout of the same repository, a project of its own, with an agent at work in each.
    const other = join(base, 'other')
    await git(['worktree', 'add', '-q', '-b', 'other', other], repo)
    await run(repo, 'create', 'here')
    await run(other, 'create', 'there')
    await writeFile(join(worktreePath(other, 'there'), 'index.html'), '<h1>Edited</h1>\n')

    assert.deepEqual((await run(repo, 'cleanup')).out, { ok: true, removed: ['.branches/agent-here', '.branches'], kept: [] })
    assert.equal(await excludeOf(repo), byHand, 'the other project\'s checkout and its links are still hidden')
    assert.equal((await git(['status', '--porcelain'], other)).trim(), '')
    assert.equal((await git(['status', '--porcelain'], worktreePath(other, 'there'))).trim(), 'M index.html', 'only the agent\'s own edit shows there')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
