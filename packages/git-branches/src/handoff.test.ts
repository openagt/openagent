import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isCopyName, sessionCopies } from './handoff.js'

// A session's copies of repos, read off its folder in a sessions home of the test's own, with real git.

const ID = '2026-11-24T10-00-00-000Z'
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim()

test("a copy is named by one folder's own name: never a path, and none of the dot-entries", () => {
  assert.deepEqual(['site', 'my.repo', 'a b'].map(isCopyName), [true, true, true])
  assert.deepEqual(['../site', 'a/b', 'a\\b', '.openagent', '..', '', 3, undefined].map(isCopyName), [false, false, false, false, false, false, false, false])
})

test("the session's copies are the repositories in its folder, by name; a session with no folder has none", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'session-copies-')))
  const folder = join(home, ID)
  try {
    for (const name of ['site', 'api']) {
      await mkdir(join(folder, name), { recursive: true })
      git(join(folder, name), 'init', '-q', '-b', 'main')
      await writeFile(join(folder, name, 'README.md'), '# t\n')
      git(join(folder, name), 'add', '-A')
      git(join(folder, name), 'commit', '-q', '-m', 'init')
    }
    await mkdir(join(folder, 'notes'))
    await mkdir(join(folder, '.openagent'))
    assert.deepEqual(await sessionCopies(ID, home), ['api', 'site'], 'the plain folder and the live record are no copies')
    assert.deepEqual(await sessionCopies('2026-01-01T00-00-00-000Z', home), [])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
