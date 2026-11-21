import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { crawlRepoFiles, isActivated, type ProjectFs } from './project.js'
import { gitignorePath, type GitRunner } from '@openagt/agent-data'

const CWD = '/proj'

/** A {@link ProjectFs} that reports exactly one set of paths as existing files. */
function fakeFs(files: string[]): ProjectFs {
  return {
    async exists(path) {
      return files.includes(path)
    },
  }
}

test('isActivated is true when the install-written .openagent/.gitignore exists (#1600)', async () => {
  assert.equal(await isActivated(CWD, fakeFs([gitignorePath(CWD)])), true)
})

test('isActivated is false without the ignore file — a bare .openagent/ dir is not activation (#1600)', async () => {
  assert.equal(await isActivated(CWD, fakeFs([])), false)
})

test('crawlRepoFiles parses NUL-separated output, deduped + sorted', async () => {
  const calls: { args: string[]; cwd: string }[] = []
  const agent: GitRunner = async (args, cwd) => {
    calls.push({ args, cwd })
    // git -z output ends with a trailing NUL.
    return 'src/b.ts\0README.md\0src/a.ts\0'
  }
  const files = await crawlRepoFiles(CWD, agent)
  assert.deepEqual(files, ['README.md', 'src/a.ts', 'src/b.ts'])
  assert.deepEqual(calls, [
    { args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd: CWD },
  ])
})

test('crawlRepoFiles drops the trailing empty entry from the final NUL', async () => {
  const files = await crawlRepoFiles(CWD, async () => 'only.ts\0')
  assert.deepEqual(files, ['only.ts'])
})

test('crawlRepoFiles de-dupes a path that appears twice', async () => {
  const files = await crawlRepoFiles(CWD, async () => 'dup.ts\0dup.ts\0other.ts\0')
  assert.deepEqual(files, ['dup.ts', 'other.ts'])
})

test('crawlRepoFiles yields [] when git fails', async () => {
  const files = await crawlRepoFiles(CWD, async () => {
    throw new Error('not a git repository')
  })
  assert.deepEqual(files, [])
})
