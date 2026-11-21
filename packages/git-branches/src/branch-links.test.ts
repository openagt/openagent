import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { nodeGitRunner, BRANCHES_DIR } from '@openagt/agent-data'
import { reconcileBranchLinks, type LinksFs } from './branch-links.js'
import { addWorktree, worktreePath, type WorktreeDirEntry } from './index.js'

const CWD = '/repo'
const LINKS = join(CWD, BRANCHES_DIR)

/** A checkout at the #1580 location, dir named as the branch it was created on. */
const current = (agentId: string): WorktreeDirEntry => ({ agentId, path: join(LINKS, `agent-${agentId}`) })

/** An in-memory {@link LinksFs}: `links` maps absolute path -> target; `files` are non-symlinks. */
function memFs(opts: { links?: Record<string, string>; files?: string[] } = {}) {
  const links = new Map(Object.entries(opts.links ?? {}))
  const files = new Set(opts.files ?? [])
  const fs: LinksFs = {
    readdir: async dir =>
      [...links.keys(), ...files].filter(p => p.startsWith(dir + '/')).map(p => p.slice(dir.length + 1)).filter(n => !n.includes('/')),
    mkdir: async () => {},
    symlink: async (target, path) => {
      if (links.has(path) || files.has(path)) throw new Error('EEXIST')
      links.set(path, target)
    },
    readlink: async path => links.get(path),
    unlink: async path => void links.delete(path),
    lexists: async path => links.has(path) || files.has(path),
  }
  return { fs, links, files }
}

/** The links inside the branches dir, as name -> target. */
const branchLinksOf = (links: Map<string, string>) =>
  Object.fromEntries([...links].filter(([path]) => path.startsWith(LINKS + '/')).map(([path, t]) => [path.slice(LINKS.length + 1), t]))

test('a checkout still on its birth branch gets no link — the dir already carries the name (#1580)', async () => {
  const { fs, links } = memFs()
  await reconcileBranchLinks(CWD, { fs, worktrees: async () => [current('r1')], branchOf: async () => 'agent-r1' })
  assert.deepEqual(branchLinksOf(links), {})
})

test('a renamed branch gets a sibling link, and the stale name goes in the same pass', async () => {
  const { fs, links } = memFs({ links: { [join(LINKS, 'agent-old-name')]: 'agent-r1' } })
  await reconcileBranchLinks(CWD, { fs, worktrees: async () => [current('r1')], branchOf: async () => 'agent-cool-name' })
  assert.deepEqual(branchLinksOf(links), { 'agent-cool-name': 'agent-r1' })
})

test('a reclaimed checkout loses its link; detached and slash-named branches never get one', async () => {
  const { fs, links } = memFs({ links: { [join(LINKS, 'agent-done')]: 'agent-gone' } })
  await reconcileBranchLinks(CWD, {
    fs,
    worktrees: async () => [current('detached'), current('old')],
    branchOf: async path => (path.endsWith('old') ? 'feature/old-name' : undefined),
  })
  assert.deepEqual(branchLinksOf(links), {}, 'the dead link is gone, nothing new appeared')
})

test('only our own links are touched: user files and foreign symlinks stay', async () => {
  const userFile = join(LINKS, 'agent-mine')
  const foreignLink = join(LINKS, 'elsewhere')
  const { fs, links, files } = memFs({ files: [userFile], links: { [foreignLink]: '/somewhere/else' } })
  await reconcileBranchLinks(CWD, { fs, worktrees: async () => [current('r1')], branchOf: async () => 'agent-mine' })
  assert.ok(files.has(userFile), 'the user file at the wanted name is untouched')
  assert.equal(links.get(foreignLink), '/somewhere/else', 'a foreign symlink is never removed')
  assert.equal(links.has(join(LINKS, 'agent-mine')), false, 'nothing was created over the user file')
})

test('a .branches/ directory that is not a worktree gets no link, against real git (#1654)', async () => {
  // Default seams on purpose: the bug was in the default branch read. Git asked in a residue
  // directory answers with the enclosing repo's branch, which left a `main -> agent-…` link
  // beside the checkouts on the rig.
  const git = nodeGitRunner()
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'branch-links-')))
  try {
    await git(['init', '-b', 'main'], repo)
    await git(['config', 'user.email', 't@t'], repo)
    await git(['config', 'user.name', 't'], repo)
    await writeFile(join(repo, 'README.md'), '# t\n')
    await git(['add', '-A'], repo)
    await git(['commit', '-m', 'init'], repo)
    const { path } = await addWorktree(repo, { agentId: 'r1', branch: 'agent-r1' }, git)
    await git(['checkout', '-q', '-b', 'agent-real-name'], path)
    await mkdir(join(worktreePath(repo, 'r2'), 'leftover'), { recursive: true })

    await reconcileBranchLinks(repo)
    const names = (await readdir(join(repo, BRANCHES_DIR))).sort()
    assert.deepEqual(names, ['agent-r1', 'agent-r2', 'agent-real-name'], 'the real rename is linked; no `main` link for the residue')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
