import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { FakeDriver, type Driver, type DriverStartOptions } from '@openagt/agent-driver'
import { readdir } from 'node:fs/promises'
import { MAX_TITLE, nameRun, titleOf, titlePrompt, TITLE_MODELS, TITLE_SYSTEM } from './title.js'

// A run's short name: what the small model is asked, what is taken from its answer, and that the
// asking is a session of its own that never touches the run's record.

/** A fake agent that answers with `said` and records how it was started. */
function naming(said: string): Driver & { starts: DriverStartOptions[] } {
  const fake = new FakeDriver({ respond: () => said })
  const starts: DriverStartOptions[] = []
  return {
    id: 'claude-code',
    starts,
    start: opts => {
      starts.push(opts)
      return fake.start(opts)
    },
  }
}

test('the prompt asks for a few words and carries what the person asked', () => {
  const asked = titlePrompt('make readme.md shorter')
  assert.match(asked, /two to five words/)
  assert.match(asked, /make readme\.md shorter/)
})

test('what the model answered is taken as the name, free of the wrapping a model adds', () => {
  assert.equal(titleOf('README.md condensing'), 'README.md condensing')
  assert.equal(titleOf('"Dark mode toggle"'), 'Dark mode toggle')
  assert.equal(titleOf('Title: Dark mode toggle.'), 'Dark mode toggle')
  // Models like to leave a blank line first: the name is the first line with anything on it.
  assert.equal(titleOf('\n\nDark mode toggle\n'), 'Dark mode toggle')
})

test('a sentence is no name, and neither is an empty answer: the run keeps the person\'s words', () => {
  // What a coding agent answered when it was asked in the run's own checkout and looked around.
  assert.equal(titleOf('The file is hello.sh in the branch agent-2026-10-14T06-27-07-791Z, committed'), undefined)
  assert.equal(titleOf('a'.repeat(MAX_TITLE + 20)), undefined)
  assert.equal(titleOf('   \n  '), undefined)
  assert.equal(titleOf('""'), undefined)
})

test('the agent is asked in a session of its own, on its small model', async () => {
  const driver = naming('README.md condensing')
  assert.equal(await nameRun(driver, { prompt: 'make readme.md shorter' }), 'README.md condensing')
  assert.equal(driver.starts.length, 1)
  assert.equal(driver.starts[0]?.model, TITLE_MODELS['claude-code'])
  assert.equal(driver.starts[0]?.system, TITLE_SYSTEM)
  // An empty folder of its own, never the run's checkout: there is nothing there to look at, and
  // nothing of it makes the run's tree dirty.
  assert.ok(driver.starts[0]?.cwd.includes('openagent-naming-'))
  assert.deepEqual(await readdir(driver.starts[0]!.cwd).catch(() => 'gone'), 'gone', 'the folder is removed after')
  // The naming session keeps no log: nothing of it reaches the run's own record.
  assert.equal(driver.starts[0]?.log, undefined)
})

test('an agent with no small model named for it, and one that fails, name nothing', async () => {
  assert.equal(await nameRun(new FakeDriver({ respond: () => 'Anything' }), { prompt: 'do it' }), undefined)
  const broken: Driver = { id: 'claude-code', start: () => Promise.reject(new Error('not logged in')) }
  assert.equal(await nameRun(broken, { prompt: 'do it' }), undefined)
})
