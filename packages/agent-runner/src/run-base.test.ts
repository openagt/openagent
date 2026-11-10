import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { publishedBase } from '@openagt/agent-data/names'
import { FakeDriver, type Driver, type DriverSession, type DriverStartOptions } from '@openagt/agent-driver'
import { findRun } from '@openagt/skill-logs'
import { resumeRun, runCommand } from './run.js'
import { runnerMark } from './records.js'
import { git, handDownBasicSkills, removeRepo, testRepo } from './test-repo.js'
import { NOW, noGitHost } from './run-test-support.js'

// A run told to start from a branch as origin has it, end to end on a real repository and a real
// bare origin, with the agent faked. Its own file: `run.test.ts` is at the runner's time limit.
handDownBasicSkills()

/** A fake agent that notes the commit its checkout is on. */
function looking(seen: { head: string }): Driver {
  return {
    id: 'fake',
    start: async (opts: DriverStartOptions): Promise<DriverSession> => {
      seen.head = (await git(['rev-parse', 'HEAD'], opts.cwd)).trim()
      return new FakeDriver({ turns: [{ text: 'Nothing to change.' }], sessionId: 's-1' }).start(opts)
    },
  }
}

test('a run started from a branch only origin has starts on origin\'s copy, fetched then; its record names the branch as a person reads it, and keeps where it started for a resume', async () => {
  const repo = await testRepo()
  const other = join(dirname(repo), 'other')
  try {
    // Pushed by someone else: this clone has never seen it.
    await git(['clone', '-q', '-b', 'main', join(dirname(repo), 'origin.git'), other], dirname(repo))
    await git(['config', 'user.email', 'other@example.com'], other)
    await git(['config', 'user.name', 'other'], other)
    await git(['checkout', '-q', '-b', 'feature-x'], other)
    await writeFile(join(other, 'theirs.txt'), 'theirs\n')
    await git(['add', '-A'], other)
    await git(['commit', '-q', '-m', 'Theirs'], other)
    await git(['push', '-q', 'origin', 'feature-x'], other)
    const theirs = (await git(['rev-parse', 'HEAD'], other)).trim()

    const seen = { head: '' }
    const outcome = await runCommand(repo, { prompt: 'Do it', base: publishedBase('feature-x'), driver: looking(seen), now: () => NOW, gitHost: noGitHost })
    assert.equal(outcome.status, 'done')
    assert.equal(seen.head, theirs)
    const ended = await findRun(repo, outcome.id)
    assert.equal(ended!.caller?.['base'], 'feature-x', 'what a reader of the card shows')
    assert.equal(ended!.caller?.['baseCommit'], theirs, 'what the Changes pane measures from')
    assert.equal(runnerMark(ended!)?.base, publishedBase('feature-x'), 'what a resume of a branch gone everywhere starts again from')

    // The empty branch went with the checkout: a resume makes it again from the same place, which no local branch of that name can take over.
    await git(['branch', 'feature-x', 'main'], repo)
    seen.head = ''
    const continued = await resumeRun(repo, { id: outcome.id, text: 'Look again.', driver: looking(seen), now: () => new Date(NOW.getTime() + 60_000), gitHost: noGitHost })
    assert.equal(continued.status, 'done')
    assert.equal(seen.head, theirs)

    // Gone from origin: the run fails on its record, with words, and started from nothing else.
    await git(['push', '-q', 'origin', '--delete', 'feature-x'], other)
    const gone = await runCommand(repo, { prompt: 'Do it again', base: publishedBase('feature-x'), driver: new FakeDriver({ turns: [{ text: 'Never asked.' }] }), now: () => NOW, gitHost: noGitHost })
    assert.equal(gone.status, 'failed')
    assert.match(gone.detail ?? '', /the branch feature-x could not be fetched from origin/)
  } finally {
    await removeRepo(repo)
  }
})
