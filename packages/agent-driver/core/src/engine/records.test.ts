import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { DATA_BRANCH } from '@openagt/git-branches'
import { findRun, listRuns, readDiary } from '../record-store.js'
import { lasting, markerCard, recordRun, runnerMark, withdrawMarker, writeMarker } from './records.js'
import { git, removeRepo, testRepo } from './test-repo.js'

// The marker is the logs skill's record, on the real branch: written before the agent exists,
// read by every machine, written again at the end over the same file.

const mark = { host: 'this-box', pid: 4242 }

test('a marker is a running card on agent-data, pushed to origin, that the logs skill lists like any run', async () => {
  const repo = await testRepo()
  try {
    const card = markerCard({ id: '2026-09-16T14-01-00-000Z', startedAt: '2026-09-16T14:01:00.000Z', prompt: '/work-queue', driver: 'claude-code', model: 'opus', mark })
    const written = await writeMarker(repo, card)
    assert.ok(written.ok && written.pushed, 'the marker reached origin, so another machine sees it')
    const found = await findRun(repo, card.id)
    assert.equal(found?.status, 'running')
    assert.equal(found?.intent, '/work-queue')
    assert.deepEqual(runnerMark(found!), mark)
    assert.equal(found?.caller?.['host'], mark.host, 'the machine, where a reader looks for it on a live card too')
    assert.deepEqual(await readDiary(repo, card.id), [])
    assert.match(await git(['log', '-1', '--format=%s', `origin/${DATA_BRANCH}`], repo), /^logs: record run 2026-09-16T14-01-00-000Z/)
  } finally {
    await removeRepo(repo)
  }
})

test('the record at the end overwrites the marker: same id, same file, and a withdrawn marker is gone', async () => {
  const repo = await testRepo()
  try {
    const card = markerCard({ id: 'a1', startedAt: '2026-09-16T14:01:00.000Z', prompt: '/work-queue', driver: 'claude-code', model: 'opus', mark })
    await writeMarker(repo, card)
    await recordRun(repo, { ...card, status: 'done', endedAt: '2026-09-16T14:05:00.000Z', branch: 'agent-fix-it', cost: 1.12, pr: { number: 7, url: 'https://x/pull/7' } }, [{ kind: 'said', text: 'done' }, { kind: 'ended', status: 'done' }])
    const found = await findRun(repo, 'a1')
    assert.equal(found?.status, 'done')
    assert.equal(found?.pr?.number, 7)
    assert.deepEqual(runnerMark(found!), mark)
    assert.equal((await readDiary(repo, 'a1'))?.length, 2)

    await writeMarker(repo, markerCard({ id: 'a2', startedAt: '2026-09-16T14:06:00.000Z', prompt: '/work-queue', driver: 'claude-code', model: 'opus', mark }))
    await withdrawMarker(repo, 'a2')
    assert.equal(await findRun(repo, 'a2'), undefined)
    assert.equal((await listRuns(repo)).length, 1)
  } finally {
    await removeRepo(repo)
  }
})

test('a run told where to start names that branch beside the host, and a run told none names none', () => {
  const card = markerCard({ id: 'c3', startedAt: '2026-09-16T14:01:00.000Z', prompt: 'the task', driver: 'claude-code', mark: { ...mark, base: 'my-branch' } })
  assert.equal(card.caller?.['base'], 'my-branch')
  assert.equal(runnerMark(card)?.base, 'my-branch', 'and in the mark, as before')
  assert.equal(markerCard({ id: 'c4', startedAt: '2026-09-16T14:01:00.000Z', prompt: 'the task', driver: 'claude-code', mark }).caller?.['base'], undefined)
})

test('a run started for a thread names it beside the host, and keeps it for its whole life, a resume included', () => {
  const card = markerCard({ id: 'c5', startedAt: '2026-09-16T14:01:00.000Z', prompt: '/reply', driver: 'claude-code', mark: { ...mark, for: 'https://github.com/o/r/issues/5' } })
  assert.equal(card.caller?.['for'], 'https://github.com/o/r/issues/5')
  assert.equal(runnerMark(card)?.for, 'https://github.com/o/r/issues/5')
  assert.equal(lasting(runnerMark(card)!).for, 'https://github.com/o/r/issues/5')
  assert.equal(markerCard({ id: 'c6', startedAt: '2026-09-16T14:01:00.000Z', prompt: '/reply', driver: 'claude-code', mark }).caller?.['for'], undefined)
})

test('the mark keeps the publish level a run was given, and drops a word that is no level', () => {
  const card = markerCard({ id: 'c2', startedAt: '2026-09-16T14:01:00.000Z', prompt: '/work-queue', driver: 'claude-code', mark: { ...mark, publish: 'merge' } })
  assert.equal(runnerMark(card)?.publish, 'merge')
  assert.equal(runnerMark({ ...card, caller: { runner: { ...mark, publish: 'push' } } })?.publish, undefined)
})

test("a session's picks last on the mark, for its readers too, its profile with them: the plugins it goes without, the project's skills it gets, over its profile's; a list that is no names, or a word that is no profile id, is dropped", () => {
  assert.deepEqual(lasting({ pluginsWithout: ['tickets', 'ask'], projectSkills: 'none', profile: 'reviewer' }), { pluginsWithout: ['tickets', 'ask'], projectSkills: 'none', profile: 'reviewer' })
  assert.deepEqual(lasting({ projectSkills: ['deploy', 'lint'] }), { projectSkills: ['deploy', 'lint'] })
  assert.deepEqual(lasting({ projectSkills: 'all' }), { projectSkills: 'all' })
  assert.deepEqual(lasting({ pluginsWithout: [] }), { pluginsWithout: [] }, "none of them, over the profile's")
  assert.deepEqual(lasting({ pluginsWithout: ['Not A Plugin'], projectSkills: 'some', profile: '../me' }), {})
  const card = markerCard({ id: '2026-09-16T14-01-00-000Z', startedAt: '2026-09-16T14:01:00.000Z', prompt: 'Review', driver: 'claude-code', mark: { ...mark, pluginsWithout: ['ask'], projectSkills: 'none' } })
  assert.deepEqual(card.caller?.['pluginsWithout'], ['ask'])
  assert.equal(card.caller?.['projectSkills'], 'none')
  assert.deepEqual(runnerMark(card), { ...mark, pluginsWithout: ['ask'], projectSkills: 'none' })
})
