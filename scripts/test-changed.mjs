// The tests to run before a push (AGENTS.md): those of the packages the change touches, and of the
// packages that depend on them. `pnpm test:changed`, in the checkout of the change.
//
// The change is everything this checkout has that its fork from origin's main has not: commits,
// staged and unstaged edits, and new files. pnpm's own `--filter '...[origin/main]'` is not enough:
// it never sees a new file, and in a git worktree inside another checkout, where every OpenAgent
// session works (`.branches/agent-<id>`), it reads the changed paths against the outer checkout and
// matches no package at all, so the agent ran nothing and read that as green.
import { execFileSync, spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The files the change in the checkout at `cwd` touches, against `base`: relative to the checkout's root. */
export function changedFiles(cwd, base = 'origin/main') {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })
  const fork = git('merge-base', 'HEAD', base).trim()
  const lines = text => text.split('\n').filter(Boolean)
  // The working tree against the fork: the commits since, and what is not committed yet.
  return [...new Set([...lines(git('diff', '--name-only', fork)), ...lines(git('ls-files', '--others', '--exclude-standard'))])]
}

/** The folders of the workspace's packages, the root's left out: relative to the root. */
export function packageFolders(root) {
  const listed = JSON.parse(execFileSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], { cwd: root, encoding: 'utf8' }))
  const top = realpathSync(root)
  return listed.map(pkg => relative(top, realpathSync(pkg.path))).filter(folder => folder !== '')
}

/** The packages whose folder holds one of `files`: each file is its innermost package's. */
export function touchedPackages(files, folders) {
  const inside = (file, folder) => file.startsWith(folder + sep) || file.startsWith(folder + '/')
  const touched = new Set()
  for (const file of files) {
    const owner = folders.filter(folder => inside(file, folder)).sort((a, b) => b.length - a.length)[0]
    if (owner !== undefined) touched.add(owner)
  }
  return [...touched].sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const touched = touchedPackages(changedFiles(root), packageFolders(root))
  if (touched.length === 0) {
    console.log('No package is changed against origin/main: no package tests to run.')
    process.exit(0)
  }
  console.log(`Changed: ${touched.join(', ')}. Testing them and the packages that depend on them.`)
  // The root depends on most packages, and its own `test` runs all of them: it is left out.
  const filters = [...touched.flatMap(folder => ['--filter', `...{./${folder}}`]), '--filter', '!openagent']
  const run = spawnSync('pnpm', ['-r', '--no-bail', ...filters, 'test'], { cwd: root, stdio: 'inherit' })
  process.exit(run.status ?? 1)
}
