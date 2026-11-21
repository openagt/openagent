import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { join } from 'node:path'
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, readlink, lstat, realpath, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { findDependencyDirs, linkDependencies, nodeLinkFs, type LinkFs } from './index.js'

/** A {@link LinkFs} over an in-memory set of directory paths, recording the links made. */
function fakeFs(dirs: string[]): LinkFs & { links: { target: string; path: string }[] } {
  const set = new Set(dirs)
  const links: { target: string; path: string }[] = []
  return {
    links,
    async readdir(path) {
      const prefix = path.endsWith('/') ? path : path + '/'
      const names = new Set<string>()
      for (const dir of set) {
        if (!dir.startsWith(prefix)) continue
        const name = dir.slice(prefix.length).split('/')[0]
        if (name) names.add(name)
      }
      return [...names]
    },
    async isDirectory(path) {
      return set.has(path)
    },
    async entryExists(path) {
      return set.has(path)
    },
    async mkdir(path) {
      set.add(path)
    },
    async symlinkDir(target, path) {
      links.push({ target, path })
      set.add(path)
    },
  }
}

test('findDependencyDirs finds the root and every workspace package tree (#736)', async () => {
  const fs = fakeFs([
    '/repo',
    '/repo/node_modules',
    '/repo/packages',
    '/repo/packages/a',
    '/repo/packages/a/node_modules',
    '/repo/packages/b',
    '/repo/examples',
    '/repo/examples/demo',
    '/repo/examples/demo/node_modules',
    // Below MAX_DEPTH: not found.
    '/repo/packages/a/src',
    '/repo/packages/a/src/deep',
    '/repo/packages/a/src/deep/node_modules',
  ])
  assert.deepEqual(await findDependencyDirs('/repo', fs), ['examples/demo/node_modules', 'node_modules', 'packages/a/node_modules'])
})

test('findDependencyDirs never descends into node_modules or dot dirs', async () => {
  const fs = fakeFs([
    '/repo',
    '/repo/node_modules',
    '/repo/node_modules/dep',
    '/repo/node_modules/dep/node_modules',
    '/repo/.git',
    '/repo/.git/node_modules',
    '/repo/.branches',
    '/repo/.branches',
    '/repo/.branches/x',
    '/repo/.branches/x/node_modules',
  ])
  assert.deepEqual(await findDependencyDirs('/repo', fs), ['node_modules'])
})

test('linkDependencies mirrors each tree as a real directory of entry links, at the same relative path', async () => {
  const fs = fakeFs([
    '/repo',
    '/repo/node_modules',
    '/repo/node_modules/dep',
    '/repo/node_modules/.bin',
    '/repo/packages',
    '/repo/packages/a',
    '/repo/packages/a/node_modules',
    '/repo/packages/a/node_modules/@scope',
    '/repo/packages/a/node_modules/@scope/pkg',
    '/wt',
    '/wt/packages',
    '/wt/packages/a',
  ])
  const linked = await linkDependencies('/repo', '/wt', fs)
  assert.deepEqual(linked, ['node_modules', 'packages/a/node_modules'])
  assert.equal(await fs.isDirectory('/wt/node_modules'), true, 'a directory of the worktree\'s own, not a link')
  assert.deepEqual(
    fs.links.sort((a, b) => a.path.localeCompare(b.path)),
    [
      { target: '/repo/node_modules/.bin', path: '/wt/node_modules/.bin' },
      { target: '/repo/node_modules/dep', path: '/wt/node_modules/dep' },
      { target: '/repo/packages/a/node_modules/@scope/pkg', path: '/wt/packages/a/node_modules/@scope/pkg' },
    ],
  )
  assert.equal(await fs.isDirectory('/wt/packages/a/node_modules/@scope'), true, 'a scope is a directory of the worktree\'s own, holding a link per package')
})

// The #1262 regression: linking the package manager's own state made the parent's tree the
// worktree's install in pnpm's eyes, and an install in the worktree rewrote or purged it.
test('linkDependencies leaves the package manager\'s private state out (#1262)', async () => {
  const fs = fakeFs([
    '/repo',
    '/repo/node_modules',
    '/repo/node_modules/dep',
    '/repo/node_modules/.bin',
    '/repo/node_modules/.pnpm',
    '/repo/node_modules/.modules.yaml',
    '/repo/node_modules/.pnpm-workspace-state-v1.json',
    '/wt',
  ])
  await linkDependencies('/repo', '/wt', fs)
  assert.deepEqual(fs.links.map(l => l.path).sort(), ['/wt/node_modules/.bin', '/wt/node_modules/dep'])
})

test('linkDependencies leaves an existing tree alone (a run may have installed its own)', async () => {
  const fs = fakeFs(['/repo', '/repo/node_modules', '/repo/node_modules/dep', '/wt', '/wt/node_modules'])
  assert.deepEqual(await linkDependencies('/repo', '/wt', fs), [])
  assert.deepEqual(fs.links, [])
})

test('linkDependencies swallows a filesystem that refuses the link (a run still starts)', async () => {
  const fs = fakeFs(['/repo', '/repo/node_modules', '/repo/node_modules/dep', '/wt'])
  fs.symlinkDir = async () => {
    throw new Error('EPERM')
  }
  assert.deepEqual(await linkDependencies('/repo', '/wt', fs), ['node_modules'])
  fs.mkdir = async () => {
    throw new Error('EROFS')
  }
  assert.deepEqual(await linkDependencies('/repo', '/wt2', fs), [])
})

// The point of the module is that a real worktree can resolve a real dependency, so link a
// pnpm-shaped tree on disk — a package entry that is itself a relative link into `.pnpm` —
// and read a file back through the chain.
test('linkDependencies gives a real worktree a working dependency tree, and an install there stays there (#736, #1262)', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'worktree-deps-')))
  try {
    const repo = join(root, 'repo')
    const wt = join(root, 'wt')
    const store = join(repo, 'node_modules', '.pnpm', 'dep@1.0.0', 'node_modules', 'dep')
    await mkdir(store, { recursive: true })
    await writeFile(join(store, 'index.js'), 'module.exports = 1\n')
    await symlink(join('.pnpm', 'dep@1.0.0', 'node_modules', 'dep'), join(repo, 'node_modules', 'dep'), 'dir')
    await writeFile(join(repo, 'node_modules', '.modules.yaml'), 'layoutVersion: 5\n')
    await mkdir(join(repo, 'packages', 'a', 'node_modules'), { recursive: true })
    await mkdir(join(wt, 'packages', 'a'), { recursive: true })

    const linked = await linkDependencies(repo, wt, nodeLinkFs())
    assert.deepEqual(linked, ['node_modules', 'packages/a/node_modules'])
    assert.equal((await lstat(join(wt, 'node_modules'))).isDirectory(), true, 'a real directory of the worktree\'s own')
    assert.equal((await lstat(join(wt, 'node_modules', 'dep'))).isSymbolicLink(), true, 'its entries are links')
    assert.equal(await readFile(join(wt, 'node_modules', 'dep', 'index.js'), 'utf8'), 'module.exports = 1\n')
    assert.deepEqual(await readdir(join(wt, 'node_modules')), ['dep'], 'no .pnpm, no .modules.yaml')

    // An install in the worktree replaces the worktree's entries; the parent's tree is untouched.
    await unlink(join(wt, 'node_modules', 'dep'))
    await mkdir(join(wt, 'node_modules', 'dep'))
    await writeFile(join(wt, 'node_modules', 'dep', 'index.js'), 'module.exports = 2\n')
    assert.equal(await readlink(join(repo, 'node_modules', 'dep')), join('.pnpm', 'dep@1.0.0', 'node_modules', 'dep'))
    assert.equal(await readFile(join(repo, 'node_modules', 'dep', 'index.js'), 'utf8'), 'module.exports = 1\n')

    // A new scoped package installed in the worktree lands in the worktree's own scope directory,
    // never in the parent's.
    await mkdir(join(repo, 'node_modules', '@acme', 'old'), { recursive: true })
    await rm(join(wt, 'node_modules'), { recursive: true })
    await linkDependencies(repo, wt, nodeLinkFs())
    assert.equal((await lstat(join(wt, 'node_modules', '@acme'))).isSymbolicLink(), false, 'the scope is a real directory')
    assert.equal((await lstat(join(wt, 'node_modules', '@acme', 'old'))).isSymbolicLink(), true, 'its packages are links')
    await mkdir(join(wt, 'node_modules', '@acme', 'new'))
    assert.deepEqual(await readdir(join(repo, 'node_modules', '@acme')), ['old'], 'the parent\'s scope is untouched')

        // Idempotent: a second call over the same worktree links nothing new.
    assert.deepEqual(await linkDependencies(repo, wt, nodeLinkFs()), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
