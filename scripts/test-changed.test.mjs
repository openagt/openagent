import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { changedFiles, packageFolders, touchedPackages } from './test-changed.mjs'

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8' })
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

test('the change of a session is found in its checkout inside the project, its uncommitted edits and new files included', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'test-changed-')))
  try {
    const project = join(home, 'project')
    write(join(project, 'package.json'), JSON.stringify({ name: 'root', private: true }))
    write(join(project, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    write(join(project, '.gitignore'), '.branches/\n')
    for (const name of ['a', 'b', 'c', 'd']) {
      write(join(project, 'packages', name, 'package.json'), JSON.stringify({ name, version: '0.0.0' }))
      write(join(project, 'packages', name, 'index.js'), '')
    }
    git(home, 'init', '-q', '--bare', '-b', 'main', 'origin.git')
    git(project, 'init', '-q', '-b', 'main')
    git(project, 'add', '-A')
    git(project, 'commit', '-q', '-m', 'start')
    git(project, 'remote', 'add', 'origin', join(home, 'origin.git'))
    git(project, 'push', '-q', 'origin', 'main')
    // A session's checkout: a worktree of the project, inside the project's folder.
    const session = join(project, '.branches', 'agent-1')
    git(project, 'worktree', 'add', '-q', '-b', 'agent-1', session, 'origin/main')
    appendFileSync(join(session, 'packages', 'a', 'index.js'), 'export const a = 1\n')
    git(session, 'commit', '-q', '-am', 'a committed edit')
    appendFileSync(join(session, 'packages', 'b', 'index.js'), 'export const b = 1\n')
    write(join(session, 'packages', 'c', 'new.js'), 'export const c = 1\n')
    write(join(session, 'NOTES.md'), 'not in a package\n')

    assert.deepEqual(touchedPackages(changedFiles(session), packageFolders(session)), ['packages/a', 'packages/b', 'packages/c'])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("a file is its innermost package's", () => {
  assert.deepEqual(touchedPackages(['packages/ui/dashboard/x.ts', 'packages/ui/src/y.ts', 'README.md'], ['packages/ui', 'packages/ui/dashboard']), ['packages/ui', 'packages/ui/dashboard'])
})
