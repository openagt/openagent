import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpenAgentEvent } from '../events.js'
import { partialReader, tailEvents, tailAgentEvents, type TailTarget } from './events-tail.js'

const line = (message: string): string => JSON.stringify({ kind: 'log', message } satisfies OpenAgentEvent) + '\n'
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function tmpWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'openagent-events-tail-'))
}

test('tailEvents seeds with what is already logged, then follows appends', async () => {
  const cwd = await tmpWorkspace()
  const path = join(cwd, 'events.jsonl')
  await writeFile(path, line('first'))
  const seen: string[] = []
  const stop = tailEvents<OpenAgentEvent>(path, e => void (e.kind === 'log' && seen.push(e.message)))
  try {
    await sleep(150)
    assert.deepEqual(seen, ['first'])
    // Append, the way an agent writes its log. This used to rewrite the whole file, which truncates
    // it first — and a poll landing in that instant makes the tailer do exactly what it is built
    // to do (#567): treat the log as rewritten, reset, and replay `first`. The rewrite path is
    // covered on purpose by the next test; this one is about following appends (#811).
    await appendFile(path, line('second'))
    await sleep(1400) // fs.watch is unreliable on CI; wait out the poll backstop behind it
    assert.deepEqual(seen, ['first', 'second'])
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailEvents resets when a fresh run rewrites the log to the same length (#567)', async () => {
  const cwd = await tmpWorkspace()
  const path = join(cwd, 'events.jsonl')
  // Both lines are the same byte length, so the shrink check alone cannot see this;
  // it is caught only by the same-length-rewrite detection. That is the whole point.
  assert.equal(Buffer.byteLength(line('old-run')), Buffer.byteLength(line('new-run')))
  await writeFile(path, line('old-run'))
  const seen: string[] = []
  const stop = tailEvents<OpenAgentEvent>(path, e => void (e.kind === 'log' && seen.push(e.message)))
  try {
    await sleep(150)
    assert.deepEqual(seen, ['old-run'])
    await sleep(20) // let mtime advance past the seeding read
    await writeFile(path, line('new-run'))
    await sleep(1400) // fs.watch, and the poll backstop behind it
    assert.deepEqual(seen, ['old-run', 'new-run'])
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailEvents stops pulling once stopped, and skips malformed lines', async () => {
  const cwd = await tmpWorkspace()
  const path = join(cwd, 'events.jsonl')
  await writeFile(path, line('kept') + 'not json at all\n')
  const seen: string[] = []
  const stop = tailEvents<OpenAgentEvent>(path, e => void (e.kind === 'log' && seen.push(e.message)))
  try {
    await sleep(150)
    assert.deepEqual(seen, ['kept']) // the malformed line never breaks the stream
    stop()
    await writeFile(path, line('kept') + line('after-stop'))
    await sleep(1200)
    assert.deepEqual(seen, ['kept']) // nothing arrives after the stop
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailEvents reports the replay boundary after the backlog, before any follow-append (#1383)', async () => {
  const cwd = await tmpWorkspace()
  const path = join(cwd, 'events.jsonl')
  await writeFile(path, line('first') + line('second'))
  const order: string[] = []
  const stop = tailEvents<OpenAgentEvent>(
    path,
    e => void (e.kind === 'log' && order.push(e.message)),
    () => order.push('<sync>'),
  )
  try {
    await sleep(150)
    // The marker lands exactly between the replay and anything the follower delivers.
    assert.deepEqual(order, ['first', 'second', '<sync>'])
    await appendFile(path, line('third'))
    await sleep(1400) // fs.watch is unreliable on CI; wait out the poll backstop behind it
    assert.deepEqual(order, ['first', 'second', '<sync>', 'third'])
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailEvents reports the replay boundary even when the log does not exist yet (#1383)', async () => {
  const cwd = await tmpWorkspace()
  const path = join(cwd, 'events.jsonl')
  const order: string[] = []
  const stop = tailEvents<OpenAgentEvent>(
    path,
    e => void (e.kind === 'log' && order.push(e.message)),
    () => order.push('<sync>'),
  )
  try {
    await sleep(150)
    // An absent log is an empty replay, not a marker withheld: a client waiting on it
    // forever would freeze its feed.
    assert.deepEqual(order, ['<sync>'])
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

// The relocating tail: while a run has its checkout, its diary is a file there; when the run is
// recorded and the checkout removed, the diary is the finished run's lines, read whole from the
// project's runs provider. tailAgentEvents asks again when the tailed file disappears and sends
// the finished lines past the count it already delivered — once, with no replay.

/** A finished run's lines, as the runs provider answers them: the diary file's lines, in order. */
async function finished(path: string): Promise<{ finished: OpenAgentEvent[] }> {
  const { readFile } = await import('node:fs/promises')
  return { finished: (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l) as OpenAgentEvent) }
}

test('tailAgentEvents follows the diary into the finished run: missed lines arrive exactly once', async () => {
  const cwd = await tmpWorkspace()
  const live = join(cwd, 'worktree-events.jsonl')
  const archive = join(cwd, 'archived-events.jsonl')
  await writeFile(live, line('one') + line('two'))
  const seen: string[] = []
  let sync = 0
  const { rename } = await import('node:fs/promises')
  const stop = tailAgentEvents<OpenAgentEvent>(
    async () => ((await import('node:fs')).existsSync(live) ? { file: live } : finished(archive)),
    e => void (e.kind === 'log' && seen.push(e.message)),
    () => sync++,
  )
  try {
    await sleep(200)
    assert.deepEqual(seen, ['one', 'two'])
    // The retirement, compressed: the final lines land and the diary moves in one breath, so
    // whether the watcher saw the appends before the move is scheduling luck — exactly the
    // window that used to swallow a fast agent's `end`. Either way the tail must deliver
    // everything, each line once.
    await appendFile(live, line('three') + line('four'))
    await rename(live, archive)
    await sleep(1600) // fs.watch is unreliable on CI; wait out the poll backstop behind it
    assert.deepEqual(seen, ['one', 'two', 'three', 'four'])
    // A relocation is not a new replay boundary: the marker stays once-per-subscription (#1383).
    assert.equal(sync, 1)
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailAgentEvents does not replay a fully-consumed diary once the run is finished', async () => {
  const cwd = await tmpWorkspace()
  const live = join(cwd, 'worktree-events.jsonl')
  const archive = join(cwd, 'archived-events.jsonl')
  await writeFile(live, line('one') + line('two'))
  const seen: string[] = []
  const { copyFile, rm: rmFile } = await import('node:fs/promises')
  const stop = tailAgentEvents<OpenAgentEvent>(
    async () => ((await import('node:fs')).existsSync(live) ? { file: live } : finished(archive)),
    e => void (e.kind === 'log' && seen.push(e.message)),
  )
  try {
    await sleep(200)
    assert.deepEqual(seen, ['one', 'two'])
    await copyFile(live, archive)
    await rmFile(live)
    await sleep(1600)
    assert.deepEqual(seen, ['one', 'two'])
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailAgentEvents still follows a diary that moves to another file, carrying its offset', async () => {
  const cwd = await tmpWorkspace()
  const first = join(cwd, 'first.jsonl')
  const second = join(cwd, 'second.jsonl')
  await writeFile(first, line('one'))
  const seen: string[] = []
  const { rename } = await import('node:fs/promises')
  const { existsSync } = await import('node:fs')
  const stop = tailAgentEvents<OpenAgentEvent>(
    async () => ({ file: existsSync(first) ? first : second }),
    e => void (e.kind === 'log' && seen.push(e.message)),
  )
  try {
    await sleep(200)
    await appendFile(first, line('two'))
    await rename(first, second)
    await sleep(1600)
    await appendFile(second, line('three'))
    await sleep(1600)
    assert.deepEqual(seen, ['one', 'two', 'three'])
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailAgentEvents stays put while the resolver has no better answer', async () => {
  const cwd = await tmpWorkspace()
  const live = join(cwd, 'worktree-events.jsonl')
  const archive = join(cwd, 'archived-events.jsonl')
  await writeFile(live, line('one'))
  const seen: string[] = []
  const { copyFile, rm: rmFile } = await import('node:fs/promises')
  let archiveVisible = false
  const stop = tailAgentEvents<OpenAgentEvent>(
    // The window where the live file is gone but the finished run is not readable yet: the
    // resolver answers undefined (a deleted session resolves like this forever), and the tail
    // must idle rather than hop somewhere wrong — then catch up once the finished run appears.
    async () => ((await import('node:fs')).existsSync(live) ? { file: live } : archiveVisible ? finished(archive) : undefined),
    e => void (e.kind === 'log' && seen.push(e.message)),
  )
  try {
    await sleep(200)
    assert.deepEqual(seen, ['one'])
    await appendFile(live, line('two'))
    await copyFile(live, archive)
    await rmFile(live)
    await sleep(1300) // a full poll with the resolver still answering undefined
    archiveVisible = true
    await sleep(1600)
    assert.deepEqual(seen, ['one', 'two'])
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailAgentEvents finds a diary it never saw in its checkout: a short run, started and recorded between two polls (#1774)', async () => {
  const cwd = await tmpWorkspace()
  const checkout = join(cwd, 'checkout', 'diary.jsonl') // never exists: the run came and went
  const recorded = join(cwd, 'recorded-diary.jsonl')
  const seen: string[] = []
  let sync = 0
  const { existsSync } = await import('node:fs')
  const stop = tailAgentEvents<OpenAgentEvent>(
    async () => (existsSync(recorded) ? finished(recorded) : { file: checkout }),
    e => void (e.kind === 'log' && seen.push(e.message)),
    () => sync++,
  )
  try {
    await sleep(200)
    assert.deepEqual(seen, [])
    await writeFile(recorded, line('one') + line('two'))
    await sleep(1600) // the poll backstop: nothing watches a directory that does not exist
    assert.deepEqual(seen, ['one', 'two'])
    assert.equal(sync, 1)
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailAgentEvents on a diary that is nowhere yet: the file once it has a home, and the replay marker only after its lines (#1774)', async () => {
  const cwd = await tmpWorkspace()
  const live = join(cwd, 'diary.jsonl')
  const seen: string[] = []
  let sync = 0
  let home = false
  const stop = tailAgentEvents<OpenAgentEvent>(
    async () => (home ? { file: live } : { pending: true }),
    e => void (e.kind === 'log' && seen.push(e.message)),
    () => sync++,
  )
  try {
    await sleep(200)
    assert.equal(sync, 0, 'no boundary yet: a feed that reconnects would swap a full chat for nothing')
    assert.deepEqual(seen, [])
    await sleep(1300) // one poll: asked again, still nowhere
    assert.equal(sync, 0)
    await writeFile(live, line('one'))
    home = true
    await sleep(1600) // the next poll: asked again, and found
    assert.deepEqual(seen, ['one'])
    assert.equal(sync, 1, 'the boundary, once the lines the home holds are delivered')
    await appendFile(live, line('two'))
    await sleep(1600)
    assert.deepEqual(seen, ['one', 'two'], 'and followed from there')
    assert.equal(sync, 1, 'the boundary is reported once')
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailAgentEvents on a run already finished: every line, then the replay marker, and nothing follows', async () => {
  const seen: string[] = []
  let sync = 0
  const stop = tailAgentEvents<OpenAgentEvent>(
    async () => ({ finished: [{ kind: 'log', message: 'one' }, { kind: 'log', message: 'two' }] as OpenAgentEvent[] }),
    e => void (e.kind === 'log' && seen.push(e.message)),
    () => sync++,
  )
  try {
    await sleep(100)
    assert.deepEqual(seen, ['one', 'two'])
    assert.equal(sync, 1)
  } finally {
    stop()
  }
})

test('tailAgentEvents reads the message being written beside the diary: each change once, and empty once it is whole', async () => {
  const cwd = await tmpWorkspace()
  const diary = join(cwd, 'r1.jsonl')
  const live = join(cwd, 'r1.live')
  await writeFile(diary, line('one'))
  const partials: string[] = []
  const stop = tailAgentEvents<OpenAgentEvent>(async () => ({ file: diary }), () => {}, undefined, partialReader(text => partials.push(text)))
  try {
    await sleep(200)
    assert.deepEqual(partials, [])
    // Only the live file changes, not the diary: its watch reads it all the same.
    await writeFile(live, 'Rivers car')
    await sleep(1400)
    await writeFile(live, 'Rivers carve valleys.')
    await sleep(1400)
    await rm(live)
    await sleep(1400)
    assert.deepEqual(partials, ['Rivers car', 'Rivers carve valleys.', ''])
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailAgentEvents keeps asking after a run finished: a resume is followed from its first new line, and its end too', async () => {
  const cwd = await tmpWorkspace()
  const diary = join(cwd, 'r1.jsonl')
  const leg1 = [{ kind: 'log', message: 'one' }, { kind: 'log', message: 'two' }] as OpenAgentEvent[]
  let answer: TailTarget<OpenAgentEvent> = { finished: leg1 }
  const asks: (boolean | undefined)[] = []
  const seen: string[] = []
  const stop = tailAgentEvents<OpenAgentEvent>(
    async opts => {
      asks.push(opts?.cached)
      return answer
    },
    e => void (e.kind === 'log' && seen.push(e.message)),
  )
  try {
    await sleep(1300)
    assert.deepEqual(seen, ['one', 'two'])
    // Resumed: its checkout's diary starts with the lines the feed has, then the new leg.
    await writeFile(diary, line('one') + line('two') + line('three'))
    answer = { file: diary }
    await sleep(1400)
    assert.deepEqual(seen, ['one', 'two', 'three'])
    await appendFile(diary, line('four'))
    await sleep(1400)
    assert.deepEqual(seen, ['one', 'two', 'three', 'four'])
    // Ended again: recorded, the checkout reclaimed.
    answer = { finished: [...leg1, { kind: 'log', message: 'three' }, { kind: 'log', message: 'four' }, { kind: 'log', message: 'five' }] as OpenAgentEvent[] }
    await rm(diary)
    await sleep(1400)
    assert.deepEqual(seen, ['one', 'two', 'three', 'four', 'five'])
    // A finished run is asked about from cached reads only.
    assert.equal(asks[1], true)
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailAgentEvents on a diary rewritten in place: a run continued in the checkout it kept sends only its new lines', async () => {
  const cwd = await tmpWorkspace()
  const diary = join(cwd, 'r1.jsonl')
  await writeFile(diary, line('one') + line('two'))
  const seen: string[] = []
  const stop = tailAgentEvents<OpenAgentEvent>(async () => ({ file: diary }), e => void (e.kind === 'log' && seen.push(e.message)))
  try {
    await sleep(200)
    assert.deepEqual(seen, ['one', 'two'])
    // The resume writes the diary again, whole: the same bytes, a newer file.
    await sleep(20)
    await writeFile(diary, line('one') + line('two'))
    await sleep(1400)
    assert.deepEqual(seen, ['one', 'two'], 'the same lines written again are not sent again')
    await appendFile(diary, line('three'))
    await sleep(1400)
    assert.deepEqual(seen, ['one', 'two', 'three'])
    // Written again and grown in one step: still only what is new.
    await writeFile(diary, line('one') + line('two') + line('three') + line('four'))
    await sleep(1400)
    assert.deepEqual(seen, ['one', 'two', 'three', 'four'])
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailAgentEvents on a diary that is nowhere yet and turns up finished: its lines, then the replay marker', async () => {
  const order: string[] = []
  let finished = false
  const stop = tailAgentEvents<OpenAgentEvent>(
    async () => (finished ? { finished: [{ kind: 'log', message: 'one' }] as OpenAgentEvent[] } : { pending: true }),
    e => void (e.kind === 'log' && order.push(e.message)),
    () => order.push('boundary'),
  )
  try {
    await sleep(200)
    assert.deepEqual(order, [])
    finished = true
    await sleep(1400)
    assert.deepEqual(order, ['one', 'boundary'])
    await sleep(1200)
    assert.deepEqual(order, ['one', 'boundary'], 'reported once, however often the finished run is asked about')
  } finally {
    stop()
  }
})

test('tailAgentEvents on a diary that is there and still empty: the replay marker waits for its first lines', async () => {
  const cwd = await tmpWorkspace()
  const diary = join(cwd, 'r1.jsonl')
  const order: string[] = []
  // The file exists before anything is in it: what a writer leaves between creating it and writing.
  await writeFile(diary, '')
  const stop = tailAgentEvents<OpenAgentEvent>(async () => ({ file: diary }), e => void (e.kind === 'log' && order.push(e.message)), () => order.push('boundary'))
  try {
    await sleep(1400)
    assert.deepEqual(order, [], 'no boundary over a file that holds nothing: it would say an empty replay')
    await appendFile(diary, line('one') + line('two'))
    await sleep(1400)
    assert.deepEqual(order, ['one', 'two', 'boundary'])
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('tailAgentEvents on a checkout whose diary is not written yet: the replay marker waits for the file', async () => {
  const cwd = await tmpWorkspace()
  const diary = join(cwd, 'r1.jsonl')
  const order: string[] = []
  const stop = tailAgentEvents<OpenAgentEvent>(async () => ({ file: diary }), e => void (e.kind === 'log' && order.push(e.message)), () => order.push('boundary'))
  try {
    await sleep(300)
    assert.deepEqual(order, [], 'no boundary over a file that is not there: it would say an empty replay')
    await writeFile(diary, line('one') + line('two'))
    await sleep(1400)
    assert.deepEqual(order, ['one', 'two', 'boundary'])
    await appendFile(diary, line('three'))
    await sleep(1400)
    assert.deepEqual(order, ['one', 'two', 'boundary', 'three'], 'reported once')
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})
