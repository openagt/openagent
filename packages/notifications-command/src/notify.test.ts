import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { messageOf, newsOf, runCommandFor, type Notified } from './notify.js'

test('the news: a waiting run always, a done run only with a pull request new to it, nothing else', () => {
  const pr = { url: 'https://x/pull/1' }
  const waiting = { status: 'waiting', question: 'Ship it?' } as const
  assert.deepEqual(newsOf({ outcome: waiting }), { status: 'waiting', question: 'Ship it?' })
  assert.deepEqual(newsOf({ outcome: waiting, pr }), { status: 'waiting', question: 'Ship it?', pr })
  assert.deepEqual(newsOf({ outcome: waiting, pr, prBefore: pr }), { status: 'waiting', question: 'Ship it?' })
  assert.deepEqual(newsOf({ outcome: { status: 'done' }, pr }), { status: 'done', pr })
  assert.deepEqual(newsOf({ outcome: { status: 'done' }, pr, prBefore: { url: 'https://x/pull/0' } }), { status: 'done', pr }, 'another pull request is news')
  assert.equal(newsOf({ outcome: { status: 'done' }, pr, prBefore: pr }), undefined)
  assert.equal(newsOf({ outcome: { status: 'done' } }), undefined)
  assert.equal(newsOf({ outcome: { status: 'failed', error: 'boom' }, pr }), undefined)
  assert.equal(newsOf({ outcome: { status: 'stopped' }, pr }), undefined)
})

test("the message names the project, the prompt's first line cut short, and what the run needs or did, on one line", () => {
  assert.equal(messageOf('shop', '/work-queue', { status: 'waiting', question: 'Ship\nit?' }), 'shop: "/work-queue" is waiting for you: Ship it?')
  assert.equal(messageOf('shop', '/work-queue', { status: 'waiting', question: 'Ship it?', pr: { url: 'https://x/pull/1' } }), 'shop: "/work-queue" is waiting for you: Ship it? (pull request: https://x/pull/1)')
  const long = messageOf('shop', `${'a'.repeat(100)}\nsecond line`, { status: 'done', pr: { url: 'https://x/pull/1' } })
  assert.equal(long, `shop: "${'a'.repeat(79)}…" opened a pull request: https://x/pull/1`)
})

const RUN: Notified = { id: 'r1', project: 'shop', prompt: '/work-queue', news: { status: 'waiting', question: 'Q?' } }

test("the command runs in the folder it is given, with the run's facts in its environment, and is waited for", async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notifications-command-'))
  try {
    await runCommandFor(`printf '%s|%s|%s|%s|%s' "$RUN_ID" "$STATUS" "$QUESTION" "$PR_URL" "$MESSAGE" > out.txt`, dir, { ...RUN, news: { status: 'done', pr: { url: 'https://x/pull/1' } } })
    assert.equal(await readFile(join(dir, 'out.txt'), 'utf8'), 'r1|done||https://x/pull/1|shop: "/work-queue" opened a pull request: https://x/pull/1')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a command that fails, or takes too long, throws why, in words for the run\'s log', async () => {
  await assert.rejects(runCommandFor('echo nope >&2; exit 3', tmpdir(), RUN), { message: 'it exited 3: nope' })
  await assert.rejects(runCommandFor('kill -TERM $$', tmpdir(), RUN), { message: 'it was ended by SIGTERM' })
  // A child that outlives the shell and holds its stderr is ended with it, within the limit.
  const started = Date.now()
  await assert.rejects(runCommandFor('sleep 30 & sleep 30', tmpdir(), RUN, 300), { message: 'it took longer than 300ms and was ended' })
  assert.ok(Date.now() - started < 5000, 'the wait ends at the limit')
})

test('what cannot even start throws too: a folder that is not there, a question carrying a NUL', async () => {
  await assert.rejects(runCommandFor('true', join(tmpdir(), 'notifications-command-no-such-folder'), RUN), /^Error: it could not start: /)
  await assert.rejects(runCommandFor('true', tmpdir(), { ...RUN, news: { status: 'waiting', question: 'a\u0000b' } }))
})
