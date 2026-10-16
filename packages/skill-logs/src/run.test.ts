import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ANONYMOUS_DIR, agentLines, formatDiary, formatRunCard, isRunId, newestFirst, parseDiary, parseRunCard, personDir, publicCard, runIdOfFile } from './run.js'

test('a run id is letters, digits, dashes and underscores; a card file is named after one', () => {
  assert.equal(isRunId('2026-09-08T18-14-30-111Z'), true)
  assert.equal(isRunId('hand_picked'), true)
  for (const bad of ['', '../escape', 'a/b', '.', '..', 'with space', 'dot.json']) assert.equal(isRunId(bad), false, bad)
  assert.equal(runIdOfFile('2026-09-08T18-14-30-111Z.json'), '2026-09-08T18-14-30-111Z')
  assert.equal(runIdOfFile('2026-09-08T18-14-30-111Z.jsonl'), undefined, 'a diary is not a card')
  assert.equal(runIdOfFile('.hidden.json'), undefined)
  assert.equal(runIdOfFile('notes.md'), undefined)
})

test('a person is filed under their git email, made safe; no identity is still filed', () => {
  assert.equal(personDir('git@example.com'), 'git@example.com')
  assert.equal(personDir('  Git@Example.COM  '), 'git@example.com', 'trimmed and lowercased')
  // The value comes from repository configuration and is joined onto a path: never `.`, `..`,
  // a dotfile or a separator.
  for (const hostile of ['..', '.', '../../etc/passwd', '.hidden', '/absolute', '..@evil.com']) {
    const dir = personDir(hostile)
    assert.ok(!dir.startsWith('.') && !dir.includes('/'), `${hostile} -> ${dir}`)
  }
  assert.equal(personDir('..'), ANONYMOUS_DIR)
  assert.equal(personDir(undefined), ANONYMOUS_DIR)
  assert.equal(personDir('   '), ANONYMOUS_DIR)
  assert.equal(personDir('a'.repeat(200)), ANONYMOUS_DIR, 'an absurd length is not a directory name')
})

test('a card reads back with the package\'s fields and the writer\'s under caller, nothing else', () => {
  const json = JSON.stringify({
    status: 'done',
    id: 'r1',
    startedAt: '2026-09-08T18:14:30.651Z',
    endedAt: '2026-09-08T18:15:40.433Z',
    intent: 'fix it',
    driver: 'claude-code',
    model: 'opus',
    branch: 'agent-r1',
    pr: { number: 7, url: 'https://x/pull/7' },
    ticket: 'tickets/2026-09-01_fix.md',
    cost: 0.62,
    caller: { pid: 923, host: 'laptop' },
    stray: 'ignored',
    model_extra: 1,
  })
  const card = parseRunCard(json)!
  assert.deepEqual(card, {
    id: 'r1',
    startedAt: '2026-09-08T18:14:30.651Z',
    status: 'done',
    endedAt: '2026-09-08T18:15:40.433Z',
    intent: 'fix it',
    driver: 'claude-code',
    model: 'opus',
    branch: 'agent-r1',
    pr: { number: 7, url: 'https://x/pull/7' },
    cost: 0.62,
    caller: { pid: 923, host: 'laptop' },
    // Not the package's fields, so not read here, and kept as they were.
    ticket: 'tickets/2026-09-01_fix.md',
    stray: 'ignored',
    model_extra: 1,
  })
  assert.ok(!('caller' in publicCard(card)), 'the command prints everything but the writer\'s own key')
  assert.equal((publicCard(card) as Record<string, unknown>)['ticket'], 'tickets/2026-09-01_fix.md')
  // A field of the wrong shape is dropped, not kept: the card is the package's contract.
  const odd = parseRunCard(JSON.stringify({ id: 'r2', startedAt: 'now', status: 'failed', pr: { number: '7' }, cost: '1', caller: [] }))!
  assert.deepEqual(odd, { id: 'r2', startedAt: 'now', status: 'failed' })
})

test('a card a writer put its own fields on keeps them through the reads and writes of a continuation', () => {
  // A run that ends, is continued, and ends again is read and written three times over, each time
  // by whatever version is running — the run's own process, a resume, a tool landing a subagent's
  // work. `ticket` stands for any field this version does not know: it must come out as it went in.
  const started = '{"id":"r1","startedAt":"t","status":"done","intent":"split it","ticket":"tickets/2026-09-01_fix.md","caller":{"pid":1}}'

  const read = parseRunCard(started)!
  assert.equal((read as unknown as Record<string, unknown>)['ticket'], 'tickets/2026-09-01_fix.md', 'a read keeps what it does not know')

  const continued = parseRunCard(formatRunCard({ ...read, status: 'running' }))!
  const ended = parseRunCard(formatRunCard({ ...continued, status: 'done', endedAt: 'u' }))!
  assert.equal((ended as unknown as Record<string, unknown>)['ticket'], 'tickets/2026-09-01_fix.md', 'and so does every write after it')
  assert.equal(ended.intent, 'split it')
  assert.equal(ended.status, 'done')
})

test('what is not a card reads as none', () => {
  assert.equal(parseRunCard('not json'), undefined)
  assert.equal(parseRunCard('[]'), undefined)
  assert.equal(parseRunCard(JSON.stringify({ id: 'r1', startedAt: 'now' })), undefined, 'no status')
  assert.equal(parseRunCard(JSON.stringify({ id: 'r1', startedAt: 'now', status: 'paused' })), undefined, 'not a status')
  assert.equal(parseRunCard(JSON.stringify({ id: '../x', startedAt: 'now', status: 'done' })), undefined, 'not an id')
})

test('a card is written with the package\'s fields first, the writer\'s next, caller last, and reads back the same', () => {
  const card = { id: 'r1', startedAt: 't', status: 'running' as const, caller: { pid: 1 }, intent: 'x' }
  const text = formatRunCard(card)
  assert.ok(text.endsWith('\n'))
  assert.deepEqual(Object.keys(JSON.parse(text)), ['id', 'startedAt', 'status', 'intent', 'caller'], 'absent fields are not written')
  assert.deepEqual(parseRunCard(text), card)

  const theirs = { ...card, ticket: 'tickets/2026-09-01_fix.md' }
  assert.deepEqual(Object.keys(JSON.parse(formatRunCard(theirs))), ['id', 'startedAt', 'status', 'intent', 'ticket', 'caller'])
  assert.deepEqual(parseRunCard(formatRunCard(theirs)), theirs)
})

test('a diary is JSON lines; the agent\'s are four kinds, everything else is the writer\'s', () => {
  const lines = parseDiary(
    [
      '{"kind":"session","driver":"claude-code"}',
      '{"kind":"said","text":"Reading the ticket."}',
      '{"kind":"action","label":"Bash"}',
      '"a bare string"',
      '{"no":"kind"}',
      '{"kind":"result","text":"Done.","sessionId":"s1"}',
      '{"kind":"cost","usd":0.5,"inputTokens":28}',
      '{"kind":"cost"}',
      '{"kind":"ended","status":"failed","detail":"API 500"}',
      '',
    ].join('\n'),
  )
  assert.equal(lines.length, 7, 'a line without a kind, and a non-object, are not lines')
  assert.deepEqual(agentLines(lines), [
    { kind: 'said', text: 'Reading the ticket.' },
    { kind: 'result', text: 'Done.', sessionId: 's1' },
    { kind: 'cost', usd: 0.5, inputTokens: 28 },
    { kind: 'cost' },
    { kind: 'ended', status: 'failed', detail: 'API 500' },
  ])
  // A known kind with the wrong fields is not the agent's line.
  assert.deepEqual(agentLines(parseDiary('{"kind":"said"}\n{"kind":"ended","status":"running"}\n{"kind":"cost","usd":"1"}\n')), [])
  assert.equal(formatDiary(lines), lines.map(l => JSON.stringify(l) + '\n').join(''))
})

test('a torn line ends the diary read and keeps what came before', () => {
  assert.deepEqual(parseDiary('{"kind":"said","text":"a"}\n{"kind":"sai'), [{ kind: 'said', text: 'a' }])
})

test('newest first is the id order reversed', () => {
  assert.deepEqual(newestFirst([{ id: '2026-07-01T00-00-00-000Z' }, { id: '2026-09-01T00-00-00-000Z' }, { id: '2026-08-01T00-00-00-000Z' }]).map(c => c.id), [
    '2026-09-01T00-00-00-000Z',
    '2026-08-01T00-00-00-000Z',
    '2026-07-01T00-00-00-000Z',
  ])
})
