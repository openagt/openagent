import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeDriver } from './fake.js'
import { appendInbox, takeInbox } from './inbox.js'
import type { DriverEvent } from './types.js'

// The transport and the log, through the fake driver: what reaches a running agent, what the
// driver reports when a turn ends on a question, and the two files the session keeps.

const QUESTION = 'Done with the plan.\n\n```await-choices\n{ "title": "Ship it?", "options": [{ "label": "Approve" }, { "label": "Decline", "stop": true }], "recommended": "Approve" }\n```\n'

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-driver-inbox-'))
}

test('the inbox: lines appended are taken once, in order, and a torn line is skipped', async () => {
  const dir = await scratch()
  try {
    const path = join(dir, 'inbox.jsonl')
    assert.deepEqual(await takeInbox(path), [], 'no inbox is no lines')
    await appendInbox(path, { kind: 'message', text: 'first' })
    await appendInbox(path, { kind: 'answer', question: 'Ship it?', answer: 'Approve' })
    // A message may say how far the run takes its work from here on, for the tool that runs it.
    await appendInbox(path, { kind: 'message', text: 'ship it', publish: 'pr' })
    await (await import('node:fs/promises')).appendFile(path, '{ torn\n{"kind":"nope"}\n{"kind":"message","text":"x","publish":3}\n')
    assert.deepEqual(await takeInbox(path), [
      { kind: 'message', text: 'first' },
      { kind: 'answer', question: 'Ship it?', answer: 'Approve' },
      { kind: 'message', text: 'ship it', publish: 'pr' },
    ])
    assert.deepEqual(await takeInbox(path), [], 'taken once')
    assert.equal(await stat(path).then(() => true, () => false), false, 'the file is gone until the next line')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a turn ending on a question is reported as one event; the inbox is drained into further turns of the session', async () => {
  const dir = await scratch()
  try {
    const inbox = join(dir, 'inbox.jsonl')
    const events: DriverEvent[] = []
    const driver = new FakeDriver({ turns: [{ text: QUESTION }, { text: 'Shipped.' }, { text: 'And tested.' }] })
    const session = await driver.start({ cwd: dir, onEvent: e => events.push(e) })
    // Two lines wait before the turn ends: the answer, then a message.
    await appendInbox(inbox, { kind: 'answer', question: 'Ship it?', answer: 'Approve' })
    await appendInbox(inbox, { kind: 'message', text: 'Also add a test.' })
    const turn = await session.prompt('/work-queue', { inbox })
    assert.equal(turn.text, 'And tested.', 'the prompt resolves with the last turn')
    assert.deepEqual(session.prompts, ['/work-queue', 'You paused to ask: "Ship it?". The user chose: Approve. Continue with that decision.', 'Also add a test.'])
    const question = events.find(e => e.type === 'question')
    assert.ok(question && question.type === 'question')
    assert.equal(question.question.title, 'Ship it?')
    assert.equal(question.question.recommended, 'opt:0')
    assert.deepEqual(await takeInbox(inbox), [], 'nothing left, and nothing waited')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a text attached to a prompt goes with that prompt alone: an inbox line it goes on to send carries the added sentence and no attached text', async () => {
  const dir = await scratch()
  try {
    const inbox = join(dir, 'inbox.jsonl')
    const events: DriverEvent[] = []
    const session = await new FakeDriver({ turns: [{ text: 'Done.' }, { text: 'Tested.' }] }).start({ cwd: dir, onEvent: e => events.push(e) })
    await appendInbox(inbox, { kind: 'message', text: 'Also add a test.' })
    await session.prompt('/work-queue', { inbox, attached: 'Found:\n["one entry"]', added: 'Commit your work.' })
    assert.deepEqual(session.prompts, ['/work-queue\n\nFound:\n["one entry"]\n\nCommit your work.', 'Also add a test.\n\nCommit your work.'])
    assert.deepEqual(events.filter(e => e.type === 'start'), [
      { type: 'start', prompt: '/work-queue', attached: 'Found:\n["one entry"]', added: 'Commit your work.' },
      { type: 'start', prompt: 'Also add a test.', added: 'Commit your work.' },
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a sentence added after a prompt follows every inbox line that prompt goes on to send', async () => {
  const dir = await scratch()
  try {
    const inbox = join(dir, 'inbox.jsonl')
    const events: DriverEvent[] = []
    const session = await new FakeDriver({ turns: [{ text: 'Done.' }, { text: 'Tested.' }] }).start({ cwd: dir, onEvent: e => events.push(e) })
    await appendInbox(inbox, { kind: 'message', text: 'Also add a test.' })
    await session.prompt('/work-queue', { inbox, added: 'Commit your work.' })
    assert.deepEqual(session.prompts, ['/work-queue\n\nCommit your work.', 'Also add a test.\n\nCommit your work.'])
    assert.deepEqual(events.filter(e => e.type === 'start'), [
      { type: 'start', prompt: '/work-queue', added: 'Commit your work.' },
      { type: 'start', prompt: 'Also add a test.', added: 'Commit your work.' },
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the caller says what an inbox line changes, for it and the lines after it: a new sentence after it, say', async () => {
  const dir = await scratch()
  try {
    const inbox = join(dir, 'inbox.jsonl')
    const session = await new FakeDriver({ turns: [{ text: 'Done.' }, { text: 'Shipped.' }, { text: 'Tested.' }] }).start({ cwd: dir })
    await appendInbox(inbox, { kind: 'message', text: 'Ship it.', publish: 'pr' })
    await appendInbox(inbox, { kind: 'message', text: 'Also add a test.' })
    const seen: string[] = []
    await session.prompt('Fix it.', {
      inbox,
      added: 'Commit your work.',
      onInboxLine: async (line, sent) => {
        seen.push(line.kind === 'message' ? line.text : line.answer)
        return line.kind === 'message' && line.publish === 'pr' ? { ...sent, added: 'Open its pull request.' } : sent
      },
    })
    assert.deepEqual(seen, ['Ship it.', 'Also add a test.'], 'handed each line, in order')
    assert.deepEqual(session.prompts, ['Fix it.\n\nCommit your work.', 'Ship it.\n\nOpen its pull request.', 'Also add a test.\n\nOpen its pull request.'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the log: a card and a diary in the record shape, current as the turn streams, patched and ended by the caller', async () => {
  const dir = await scratch()
  try {
    const driver = new FakeDriver({ turns: [{ text: 'Working.', actions: ['Bash'], usage: { costUsd: 0.5, inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheCreationTokens: 0 } }, { text: QUESTION }] })
    const session = await driver.start({ cwd: dir, log: { dir: join(dir, 'log'), card: { id: 'run-1', intent: '/work-queue', driver: 'fake', caller: { pid: 42 } } } })
    assert.ok(session.log)
    await session.prompt('/work-queue')
    await session.log.patch({ branch: 'agent-fix-it', caller: { host: 'box' } })
    await session.prompt('go on')
    await session.log.end('done')
    await session.log.settled()

    const card = JSON.parse(await readFile(join(dir, 'log', 'run-1.json'), 'utf8'))
    assert.equal(card.status, 'done')
    assert.equal(card.intent, '/work-queue')
    assert.equal(card.branch, 'agent-fix-it')
    assert.equal(card.cost, 0.5)
    assert.deepEqual(card.caller, { pid: 42, sessionId: 'fake-session', host: 'box' })
    assert.ok(card.startedAt && card.endedAt)

    const lines = (await readFile(join(dir, 'log', 'run-1.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l))
    // Every line says when it was written; the rest of each line is the event.
    for (const line of lines) assert.equal(new Date(line.at).toISOString(), line.at, `a time on ${line.kind}`)
    assert.equal(lines.at(-1).at, card.endedAt, 'the ended line and the card agree on the end')
    const diary = lines.map(({ at: _at, ...line }) => line)
    assert.deepEqual(diary.map(l => l.kind), ['start', 'action', 'said', 'result', 'cost', 'start', 'said', 'result', 'question', 'ended'])
    assert.deepEqual(diary[2], { kind: 'said', text: 'Working.' })
    assert.deepEqual(diary[4], { kind: 'cost', usd: 0.5 })
    assert.equal(diary[8].title, 'Ship it?')
    assert.deepEqual(diary[9], { kind: 'ended', status: 'done' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
