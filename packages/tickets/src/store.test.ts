import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nodeGitRunner, personalFolder, writeSharing, BRANCHES_DIR, DATA_BRANCH } from '@openagt/agent-data'
import { syncTickets, ticketsDir } from './store.js'

const git = nodeGitRunner()
const RETRIED_RM = { recursive: true, force: true, maxRetries: 10 } as const

async function repo(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'tickets-store-')))
  await git(['init', '-b', 'main'], path)
  await git(['config', 'user.email', 't@t'], path)
  await git(['config', 'user.name', 't'], path)
  await writeFile(join(path, 'README.md'), '# t\n')
  await git(['add', '-A'], path)
  await git(['commit', '-m', 'init'], path)
  return path
}

test('a project kept on this machine: tickets/ at the root links into its directory in the personal folder, hidden from git, and its repository gets no branch', async () => {
  const root = await repo()
  try {
    assert.deepEqual(await syncTickets(root), { ok: true, reach: 'no-remote' })
    const dir = await ticketsDir(root)
    assert.equal(dir, join(personalFolder(), 'projects', 'local', ...root.split('/').filter(Boolean), 'tickets'))
    // The root link reaches into the folder, relatively.
    assert.equal(join(root, await readlink(join(root, 'tickets'))), dir)
    const status = await git(['status', '--porcelain'], root)
    assert.ok(!status.split('\n').some(line => line.trim() === '?? tickets'), status)
    assert.equal((await git(['branch', '--list', DATA_BRANCH], root)).trim(), '')
  } finally {
    await rm(root, RETRIED_RM)
  }
})

test('sync births the branch of a shared project, links tickets/ into its checkout hidden from git, and moves a link made for the personal folder', async () => {
  const root = await repo()
  try {
    await syncTickets(root)
    await writeSharing(root, true)
    assert.deepEqual(await syncTickets(root), { ok: true, reach: 'no-remote' })
    const wt = join(root, BRANCHES_DIR, DATA_BRANCH)
    assert.equal(await ticketsDir(root), join(wt, 'tickets'))
    assert.equal((await git(['rev-parse', '--abbrev-ref', 'HEAD'], wt)).trim(), DATA_BRANCH)
    // Born an orphan and left clean between cycles: nothing of the package's is written on it.
    assert.match(await git(['log', '--format=%s', `refs/heads/${DATA_BRANCH}`], root), /^create the agent-data branch\n?$/)
    assert.equal((await git(['status', '--porcelain'], wt)).trim(), '')
    // The root link now reaches into the checkout, relatively, so a moved repo keeps working.
    assert.equal(await readlink(join(root, 'tickets')), join(BRANCHES_DIR, DATA_BRANCH, 'tickets'))
    // Hidden from git, so no sweeping `git add -A` ever commits it onto a code branch…
    const status = await git(['status', '--porcelain'], root)
    assert.ok(!status.split('\n').some(line => line.trim() === '?? tickets'), status)
    // …while the checkout's real tickets/ stays committable: the exclude speaks for every
    // worktree, and it must never swallow the branch's own cargo.
    await mkdir(join(wt, 'tickets'), { recursive: true })
    await writeFile(join(wt, 'tickets', 't.md'), 'x\n')
    await git(['add', '-A'], wt)
    await git(['commit', '-m', 't'], wt)
    assert.equal((await git(['show', `${DATA_BRANCH}:tickets/t.md`], root)).trim(), 'x')
    // Idempotent: a second sync links nothing new and writes nothing.
    await syncTickets(root)
    assert.match(await git(['log', '-1', '--format=%s', `refs/heads/${DATA_BRANCH}`], root), /^t$/m)
  } finally {
    await rm(root, RETRIED_RM)
  }
})

test('sync leaves a pre-existing tickets path alone', async () => {
  const root = await repo()
  try {
    await writeFile(join(root, 'tickets'), 'mine\n')
    await syncTickets(root)
    assert.equal(await readFile(join(root, 'tickets'), 'utf8'), 'mine\n')
    // The user's own path stays theirs all the way: still visible to git, not excluded.
    const status = await git(['status', '--porcelain'], root)
    assert.ok(status.split('\n').some(line => line.trim() === '?? tickets'), status)
  } finally {
    await rm(root, RETRIED_RM)
  }
})

test('sync converges with origin: the branch origin has is adopted, and a pushed change is read on the next sync', async () => {
  const root = await repo()
  const bare = await realpath(await mkdtemp(join(tmpdir(), 'tickets-store-bare-')))
  const otherParent = await realpath(await mkdtemp(join(tmpdir(), 'tickets-store-other-')))
  try {
    await git(['init', '--bare', bare], bare)
    await git(['remote', 'add', 'origin', bare], root)
    await git(['push', 'origin', 'main'], root)
    await writeSharing(root, true)
    assert.deepEqual(await syncTickets(root), { ok: true, reach: 'origin' })
    // Another machine clones and pushes a ticket straight onto the branch.
    const other = join(otherParent, 'clone')
    await git(['clone', bare, other], otherParent)
    await git(['config', 'user.email', 'o@o'], other)
    await git(['config', 'user.name', 'o'], other)
    await git(['checkout', '-B', DATA_BRANCH, `origin/${DATA_BRANCH}`], other)
    await mkdir(join(other, 'tickets'))
    await writeFile(join(other, 'tickets', '2026-08-30_a.md'), '# A\n')
    await git(['add', '-A'], other)
    await git(['commit', '-m', 'put tickets/2026-08-30_a.md'], other)
    await git(['push', 'origin', DATA_BRANCH], other)
    assert.deepEqual(await syncTickets(root), { ok: true, reach: 'origin' })
    assert.equal(await readFile(join(await ticketsDir(root), '2026-08-30_a.md'), 'utf8'), '# A\n')
  } finally {
    for (const dir of [root, bare, otherParent]) await rm(dir, RETRIED_RM)
  }
})
