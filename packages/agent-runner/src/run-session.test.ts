import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { lstat, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FakeDriver, type Driver } from '@openagt/agent-driver'
import { personalFolder, sessionFolder, sessionsHome, SESSIONS_DIR } from '@openagt/agent-data'
import { findRun } from '@openagt/skill-logs'
import { readLiveCard } from './live-card.js'
import { resumeRun, runCommand, SESSION_FOLDER_STAYS } from './run.js'
import { markerCard, writeMarker } from './records.js'
import { sweep } from './sweep.js'
import { runCli } from './cli.js'
import { NOW, noGitHost } from './run-test-support.js'

// A session with no project: a run in the sessions home works in a folder of its own there, with
// no git, and its record is kept with the other sessions' in the personal folder.

const ID = '2026-09-16T14-01-00-000Z'

/** An agent that writes a file where it works and says so. */
function writingDriver(seen: { cwd?: string } = {}): Driver {
  return {
    id: 'fake',
    start: async opts => {
      seen.cwd = opts.cwd
      await writeFile(join(opts.cwd, 'notes.md'), 'what I found\n')
      return new FakeDriver({ respond: prompt => ({ text: `Done: ${prompt}`, usage: { costUsd: 0.25, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 } }), sessionId: 's-1' }).start(opts)
    },
  }
}

async function freshHome(): Promise<string> {
  const home = sessionsHome()
  await rm(home, { recursive: true, force: true })
  await rm(join(personalFolder(), SESSIONS_DIR), { recursive: true, force: true })
  await mkdir(home, { recursive: true })
  return home
}

test('a run in the sessions home works in its own folder, keeps it, and is recorded with the sessions', async () => {
  const home = await freshHome()
  const skill = join(home, '..', 'a-skill')
  await mkdir(skill, { recursive: true })
  await writeFile(join(skill, 'SKILL.md'), '---\nname: a-skill\n---\n')
  const seen: { cwd?: string } = {}
  const outcome = await runCommand(home, { prompt: 'Read the news', driver: writingDriver(seen), host: 'this-box', pid: 4242, now: () => NOW, gitHost: noGitHost, skills: async () => [{ name: 'a-skill', dir: skill }] })

  assert.equal(seen.cwd, sessionFolder(home, ID), 'the agent works in the session folder')
  assert.equal(outcome.status, 'done')
  assert.equal(outcome.branch, undefined, 'a session folder has no branch')
  assert.deepEqual(outcome.checkout, { reclaimed: false, reason: SESSION_FOLDER_STAYS })
  assert.equal(await readFile(join(sessionFolder(home, ID), 'notes.md'), 'utf8'), 'what I found\n', 'what the agent made stays')
  assert.ok((await lstat(join(sessionFolder(home, ID), '.claude/skills/a-skill'))).isSymbolicLink(), "the run's skills are linked in")

  const card = await findRun(home, ID)
  assert.equal(card?.status, 'done')
  assert.equal(card?.branch, undefined)
  assert.equal(card?.intent, 'Read the news')
  const people = join(personalFolder(), SESSIONS_DIR, 'agents')
  const [person] = await readdir(people)
  assert.deepEqual((await readdir(join(people, person!))).sort(), [`${ID}.json`, `${ID}.jsonl`], "the record is in the personal folder's sessions directory")
})

test('a session goes on in the same folder when it is resumed', async () => {
  const home = await freshHome()
  await runCommand(home, { prompt: 'Read the news', driver: writingDriver(), host: 'this-box', pid: 4242, now: () => NOW, gitHost: noGitHost, skills: async () => [] })
  const seen: { cwd?: string } = {}
  const outcome = await resumeRun(home, { id: ID, text: 'And the weather', driver: writingDriver(seen), host: 'this-box', pid: 4243, gitHost: noGitHost, skills: async () => [] })
  assert.equal(outcome.status, 'done')
  assert.equal(seen.cwd, sessionFolder(home, ID))
  assert.equal((await findRun(home, ID))?.status, 'done')
})

test('the sweep closes a session whose process died, and leaves its folder', async () => {
  const home = await freshHome()
  const folder = sessionFolder(home, ID)
  await mkdir(join(folder, '.openagent'), { recursive: true })
  const card = markerCard({ id: ID, startedAt: NOW.toISOString(), prompt: 'Read the news', driver: 'fake', mark: { host: 'this-box', pid: 999_999 } })
  await writeMarker(home, card)
  await writeFile(join(folder, '.openagent', `${ID}.json`), JSON.stringify({ ...card, status: 'running' }))
  const swept = await sweep(home, { host: 'this-box', isAlive: () => false, now: () => NOW })
  assert.deepEqual(swept.recorded, [{ id: ID, status: 'failed' }])
  assert.deepEqual(swept.kept, [{ id: ID, reason: SESSION_FOLDER_STAYS }])
  assert.equal((await findRun(home, ID))?.status, 'failed')
  assert.equal((await readLiveCard(folder, ID))?.status, 'failed')

  // Swept again: the session's record says how it ended, so it is left alone.
  assert.deepEqual(await sweep(home, { host: 'this-box', isAlive: () => false, now: () => NOW }), { recorded: [], reclaimed: [], kept: [] })
})

test('a run in the sessions home takes no flag about git', async () => {
  const home = await freshHome()
  const err: string[] = []
  const code = await runCli(['run', '--publish', 'pr', 'Read the news'], { cwd: home, stdout: () => {}, stderr: line => err.push(line) })
  assert.equal(code, 2)
  assert.match(err[0] ?? '', /--publish is for a run in a project: a session with no project has no git/)
})
