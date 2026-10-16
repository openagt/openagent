import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionLog } from './session-log.js'

const kinds = async (log: SessionLog): Promise<string[]> =>
  (await readFile(log.diaryPath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line).kind)

test('the message being written goes in the live file, never the diary, and goes once the message is whole', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'session-log-live-'))
  try {
    const log = new SessionLog(dir, { id: 'r1' })
    await log.open()
    void log.record({ type: 'partial', text: 'Rivers car' })
    void log.record({ type: 'partial', text: 'Rivers carve' })
    await log.record({ type: 'partial', text: 'Rivers carve valleys.' })
    assert.equal(await readFile(join(dir, 'r1.live'), 'utf8'), 'Rivers carve valleys.')
    assert.deepEqual(await kinds(log), [])
    await log.record({ type: 'text', text: 'Rivers carve valleys.' })
    assert.equal(existsSync(join(dir, 'r1.live')), false)
    assert.deepEqual(await kinds(log), ['said'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a run that ends mid-message leaves no live file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'session-log-live-'))
  try {
    const log = new SessionLog(dir, { id: 'r1' })
    await log.open()
    await log.record({ type: 'partial', text: 'Half a' })
    assert.equal(existsSync(log.livePath), true)
    await log.end('stopped')
    assert.equal(existsSync(log.livePath), false)
    assert.deepEqual(await kinds(log), ['ended'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a subagent of the agent\'s own is a diary line of its own kind, with every field its driver filled', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'session-log-subagent-'))
  try {
    const log = new SessionLog(dir, { id: 'r1' }, false, () => '2026-10-16T10:00:00.000Z')
    await log.open()
    await log.record({ type: 'subagent', id: 'toolu_1', status: 'working', name: 'Map the serving', role: 'Explore', model: 'sonnet', prompt: 'Read how the pages are served.' })
    // The row ends under the same id; a field the CLI never said is absent on the line too.
    await log.record({ type: 'subagent', id: 'toolu_1', status: 'ended', name: 'Map the serving', role: 'Explore' })
    const lines = (await readFile(log.diaryPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(lines, [
      { kind: 'subagent', id: 'toolu_1', status: 'working', name: 'Map the serving', role: 'Explore', model: 'sonnet', prompt: 'Read how the pages are served.', at: '2026-10-16T10:00:00.000Z' },
      { kind: 'subagent', id: 'toolu_1', status: 'ended', name: 'Map the serving', role: 'Explore', at: '2026-10-16T10:00:00.000Z' },
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a tool call and what it gave back are two diary lines, the second naming the first by its id', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'session-log-output-'))
  try {
    const log = new SessionLog(dir, { id: 'r1' }, false, () => '2026-10-04T10:00:00.000Z')
    await log.open()
    await log.record({ type: 'action', label: 'Bash', detail: 'pnpm test', id: 't1' })
    await log.record({ type: 'output', id: 't1', text: '1 failed', failed: true, exitCode: 1 })
    const lines = (await readFile(log.diaryPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    assert.deepEqual(lines, [
      { kind: 'action', label: 'Bash', detail: 'pnpm test', id: 't1', at: '2026-10-04T10:00:00.000Z' },
      { kind: 'output', id: 't1', text: '1 failed', failed: true, exitCode: 1, at: '2026-10-04T10:00:00.000Z' },
    ])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the run can be named once: the name on the card and a line in the diary, and a second name is ignored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'session-log-title-'))
  try {
    const log = new SessionLog(dir, { id: 'r1' })
    await log.open()
    await log.title('README.md condensing')
    await log.title('Something else')
    await log.settled()
    assert.equal(log.card.title, 'README.md condensing')
    assert.equal(JSON.parse(await readFile(log.cardPath, 'utf8')).title, 'README.md condensing')
    const lines = (await readFile(log.diaryPath, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    assert.deepEqual(lines.filter(line => line.kind === 'title').map(line => line.text), ['README.md condensing'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the card says how full the conversation is now, the newest reading replacing the one before', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'session-log-context-'))
  try {
    const log = new SessionLog(dir, { id: 'r1' })
    await log.open()
    const turn = (contextTokens: number) => log.record({ type: 'result', text: 'ok', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, contextTokens } })
    await turn(20_000)
    await turn(45_000)
    await log.settled()
    // Not 65_000: the window holds one conversation, and the last turn says how full it is.
    assert.equal(log.card.contextTokens, 45_000)
    assert.equal(JSON.parse(await readFile(log.cardPath, 'utf8')).contextTokens, 45_000)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
