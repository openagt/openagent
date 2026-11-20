import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readDiary, type RunCard } from '@openagt/agent-driver'
import { recorded, removeRepo, testRepo } from './test-support.js'
import { findWebRun, isCloudSessionId, projectWebRuns, sessionUrl, updateWebRun, webRunOf } from './web-runs.js'

// A run of this host's, as its record keeps it: the card, and what only the host knows of it in its `caller`.

const card = (caller: Record<string, unknown>): RunCard => ({ id: 'r', startedAt: '2026-11-19T10:00:00.000Z', status: 'running', caller })

test("a card is a web run's when its caller says this host; its session, its start and the start's branch read only as what they are (#2394)", () => {
  assert.equal(webRunOf(card({ target: 'actions' })), undefined)
  assert.equal(webRunOf({ id: 'r', startedAt: '', status: 'done' }), undefined)
  const anchor = 'a'.repeat(40)
  assert.deepEqual(webRunOf(card({ target: 'web', sessionId: 'session_01ABC', anchor, anchorRef: 'openagent-web-r' })), {
    card: card({ target: 'web', sessionId: 'session_01ABC', anchor, anchorRef: 'openagent-web-r' }),
    session: { id: 'session_01ABC', url: 'https://claude.ai/code/session_01ABC' },
    anchor,
    anchorRef: 'openagent-web-r',
  })
  // A record anyone with the project can write says nothing else of them.
  const odd = webRunOf(card({ target: 'web', sessionId: 'javascript:alert(1)', anchor: 'HEAD', anchorRef: '' }))!
  assert.deepEqual([odd.session, odd.anchor, odd.anchorRef], [undefined, undefined, undefined])
  assert.equal(isCloudSessionId('session_01ABC'), true)
  assert.equal(isCloudSessionId('session_../x'), false)
  assert.equal(isCloudSessionId(7), false)
  assert.equal(sessionUrl('session_01ABC'), 'https://claude.ai/code/session_01ABC')
})

test("the project's web runs are listed newest first, found by id, and recorded again with what a pass learned (#2394)", async () => {
  const repo = await testRepo()
  try {
    await recorded(repo, '2026-11-19T09-00-00-000Z')
    await recorded(repo, '2026-11-19T10-00-00-000Z', {}, { sessionId: 'session_01ABC' })
    await recorded(repo, '2026-11-19T11-00-00-000Z', {}, { target: 'actions' })
    const project = { dir: repo }
    assert.deepEqual(
      (await projectWebRuns(project)).map(run => [run.card.id, run.session?.id]),
      [
        ['2026-11-19T10-00-00-000Z', 'session_01ABC'],
        ['2026-11-19T09-00-00-000Z', undefined],
      ],
    )
    assert.deepEqual((await projectWebRuns(project, { since: Date.parse('2026-11-19T09:30:00.000Z') })).map(run => run.card.id), ['2026-11-19T10-00-00-000Z'])
    assert.equal((await findWebRun(repo, '2026-11-19T10-00-00-000Z'))?.session?.id, 'session_01ABC')
    assert.equal(await findWebRun(repo, '2026-11-19T11-00-00-000Z'), undefined, "another host's run is none of this host's")
    const written = await updateWebRun(repo, '2026-11-19T09-00-00-000Z', current => ({ ...current, status: 'done', endedAt: '2026-11-19T12:00:00.000Z' }), [{ kind: 'ended', status: 'done', at: '2026-11-19T12:00:00.000Z' }])
    assert.equal(written?.status, 'done')
    assert.equal((await findWebRun(repo, '2026-11-19T09-00-00-000Z'))?.card.status, 'done')
    assert.deepEqual((await readDiary(repo, '2026-11-19T09-00-00-000Z'))?.map(line => line.kind), ['ended'])
    assert.equal(await updateWebRun(repo, '2026-11-19T08-00-00-000Z', current => current), undefined, 'no record, nothing written')
    assert.deepEqual(await projectWebRuns({ dir: '/nowhere' }), [], 'a project whose records cannot be read has none')
  } finally {
    await removeRepo(repo)
  }
})
