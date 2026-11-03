import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readyPrompt, type Driver, type DriverSession, type DriverStartOptions } from '@openagt/agent-driver'
import { ReadyNaming, type NamingSetup } from './ready-naming.js'
import { askName, givenName, NAME_FILE_ENV, TITLE_SYSTEM } from './title.js'

// A run's name, from a naming session started before the run was: the session waiting is taken
// for the run, the next is started for the run after, and a run handed its name does not ask again.

/** A naming agent whose sessions are started ready; `said` answers each prompt. */
function namingAgent(said: (prompt: string) => string = () => 'Fix flaky login test') {
  const starts: DriverStartOptions[] = []
  const asked: string[] = []
  let cancelled = 0
  const driver: Driver = {
    id: 'claude-code',
    async start(opts) {
      starts.push(opts)
      const session: DriverSession = {
        id: `naming-${starts.length}`,
        cwd: opts.cwd,
        prompt: () => Promise.reject(new Error('a naming session is only asked ready')),
        ready: () =>
          readyPrompt(
            (words, stop) =>
              new Promise((resolve, reject) => {
                stop.addEventListener('abort', () => {
                  cancelled++
                  reject(new Error('cancelled'))
                })
                void words.then(prompt => {
                  asked.push(prompt)
                  resolve({ text: said(prompt) })
                })
              }),
          ),
        dispose: () => Promise.resolve(),
      }
      return session
    },
  }
  return { driver, starts, asked, cancelled: () => cancelled }
}

const setupOf =
  (driver: Driver, key = 'same') =>
  async (): Promise<NamingSetup> => ({ key, driver })

/** Let the pool's background work (starting the next session) settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

test('a run is named by the session waiting for it, and the next one is started for the run after', async () => {
  const agent = namingAgent()
  const pool = new ReadyNaming({ setup: setupOf(agent.driver) })
  await pool.prepare('/repo', 'claude-code')
  assert.equal(agent.starts.length, 1, 'one session waits')
  assert.equal(agent.starts[0]!.system, TITLE_SYSTEM)
  assert.equal(agent.starts[0]!.noTools, true)
  assert.equal(agent.starts[0]!.model, 'haiku')
  await pool.prepare('/repo', 'claude-code')
  assert.equal(agent.starts.length, 1, 'never a second for the same setup')

  assert.equal(await pool.name('/repo', 'fix the flaky login test', 'claude-code'), 'Fix flaky login test')
  assert.equal(agent.starts.length, 1, 'the waiting session was the one asked')
  assert.match(agent.asked[0]!, /--------\nfix the flaky login test\n--------/)
  await settle()
  assert.equal(agent.starts.length, 2, 'the next run has one waiting')
  await pool.close()
})

test('with none waiting, a run is still named, by a session started then', async () => {
  const agent = namingAgent()
  const pool = new ReadyNaming({ setup: setupOf(agent.driver) })
  assert.equal(await pool.name('/repo', 'make the readme shorter', 'claude-code'), 'Fix flaky login test')
  await settle()
  assert.equal(agent.starts.length, 2, 'the one asked, and the one now waiting')
  await pool.close()
})

test('a bare command and an agent with no small model are not named here', async () => {
  const agent = namingAgent()
  const pool = new ReadyNaming({ setup: setupOf(agent.driver) })
  assert.equal(pool.names('/work-queue', 'claude-code'), false, 'a bare command is named from its report')
  assert.equal(pool.names('fix the login test', 'claude-code'), true)
  assert.equal(await pool.name('/repo', '/triage quick', 'claude-code'), undefined)
  assert.equal(agent.starts.length, 0)
  await pool.close()
})

test('a session that waited too long is not asked: it is replaced', async () => {
  const agent = namingAgent()
  let now = 0
  const pool = new ReadyNaming({ setup: setupOf(agent.driver), now: () => now, maxWaitMs: 1000 })
  await pool.prepare('/repo', 'claude-code')
  now = 5000
  await pool.name('/repo', 'fix the login test', 'claude-code')
  assert.equal(agent.starts.length, 2, 'a fresh session answered')
  assert.equal(agent.cancelled() >= 1, true, 'the old one was ended')
  await pool.close()
})

test('a few setups wait at most, the one waiting longest going first', async () => {
  const agent = namingAgent()
  let now = 0
  const pool = new ReadyNaming({ setup: async repo => ({ key: repo, driver: agent.driver }), now: () => now, maxWaiting: 2 })
  for (const repo of ['/a', '/b', '/c']) {
    now += 10
    await pool.prepare(repo, 'claude-code')
  }
  const waiting = (pool as unknown as { waiting: Map<string, unknown> }).waiting
  assert.deepEqual([...waiting.keys()].sort(), ['/b', '/c'])
  await pool.close()
  assert.equal(waiting.size, 0, 'closing ends every one')
})

test('an answer that is a sentence names nothing', async () => {
  const agent = namingAgent(() => 'I cannot name this because the files you mention are not in the working directory at all')
  const pool = new ReadyNaming({ setup: setupOf(agent.driver) })
  assert.equal(await pool.name('/repo', 'read SKILL.md and follow it', 'claude-code'), undefined)
  await pool.close()
})

test('a run takes the name its starter wrote, and asks itself when the starter got none', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'given-name-'))
  try {
    const file = join(dir, 'name.json')
    const waiting = givenName(file)
    await writeFile(file, JSON.stringify({ title: 'Fix flaky login test' }))
    assert.equal(await waiting, 'Fix flaky login test')
    await assert.rejects(() => readFile(file), 'the file is taken')
    await writeFile(file, '{}')
    assert.equal(await givenName(file), 'ask')
    assert.equal(await givenName(join(dir, 'never.json'), undefined, 120), undefined, 'one that never comes names nothing')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a run handed a name file reads it and never asks; the file is out of the environment its agent gets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'given-name-'))
  const agent = namingAgent(() => 'Asked here')
  try {
    const file = join(dir, 'name.json')
    process.env[NAME_FILE_ENV] = file
    const asked = askName(agent.driver, 'fix the login test')
    assert.equal(process.env[NAME_FILE_ENV], undefined)
    await writeFile(file, JSON.stringify({ title: 'Given by the dashboard' }))
    assert.equal(await asked.title, 'Given by the dashboard')
    assert.equal(agent.starts.length, 0)

    process.env[NAME_FILE_ENV] = file
    const fallback = askName(agent.driver, 'fix the login test')
    await writeFile(file, '{}')
    assert.equal(await fallback.title, 'Asked here', 'the starter got none: the run asks itself')
  } finally {
    delete process.env[NAME_FILE_ENV]
    await rm(dir, { recursive: true, force: true })
  }
})
