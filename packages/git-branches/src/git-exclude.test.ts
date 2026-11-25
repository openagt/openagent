import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { excludeFromGit, unexcludeFromGit } from './git-exclude.js'
import { nodeGitRunner } from './git.js'

// The exclude file of a real repository: a rule written once, and taken back out without
// touching any other line.

const git = nodeGitRunner()

async function repository(): Promise<string> {
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'agent-data-exclude-')))
  await git(['init', '-q', '-b', 'main'], repo)
  return repo
}

const excludeOf = (repo: string): Promise<string> => readFile(join(repo, '.git', 'info', 'exclude'), 'utf8')

test('a rule taken back out leaves every other line as it was, a person\'s own included', async () => {
  const repo = await repository()
  try {
    await writeFile(join(repo, '.git', 'info', 'exclude'), '# mine\n/notes.txt\n')
    await excludeFromGit(repo, '/.tool')
    await excludeFromGit(repo, '/.tool')
    await excludeFromGit(repo, '/.tool-two')
    assert.equal(await excludeOf(repo), '# mine\n/notes.txt\n/.tool\n/.tool-two\n', 'written once')

    assert.equal(await unexcludeFromGit(repo, '/.tool'), true)
    assert.equal(await excludeOf(repo), '# mine\n/notes.txt\n/.tool-two\n', 'only the line that is exactly the rule')
    assert.equal(await unexcludeFromGit(repo, '/.tool'), false, 'a rule that is not there changes nothing')
    assert.equal(await unexcludeFromGit(repo, '/notes'), false, 'part of a line is not the rule')
    assert.equal(await excludeOf(repo), '# mine\n/notes.txt\n/.tool-two\n')
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})

test('a repository with no exclude file is left without one', async () => {
  const repo = await repository()
  try {
    await rm(join(repo, '.git', 'info', 'exclude'), { force: true })
    assert.equal(await unexcludeFromGit(repo, '/.tool'), false)
    assert.equal(await excludeOf(repo).then(() => true, () => false), false)
  } finally {
    await rm(repo, { recursive: true, force: true })
  }
})
