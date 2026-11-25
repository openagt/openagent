import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { watch, type FSWatcher } from 'node:fs'
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonlTailer, followFile } from './jsonl-tail.js'

const line = (message: string): string => JSON.stringify({ message }) + '\n'
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function tmpWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'openagent-jsonl-tail-'))
}

/**
 * `followFile` keeps its watcher private, so hook the FSWatcher prototype across the one call
 * that creates it. `fs.watch(dir, listener)` registers the listener on the instance, which hands
 * us the instance an 'error' has to be emitted on to reproduce #996 (no real filesystem event is
 * portable enough to raise one on demand).
 */
function captureWatcher(create: () => () => void): { watcher: FSWatcher; stop: () => void } {
  const probe = watch(tmpdir(), () => {})
  const proto = Object.getPrototypeOf(probe) as FSWatcher
  probe.close()
  const seen = new Set<FSWatcher>()
  const original = proto.addListener
  const record = function (this: FSWatcher, ...args: Parameters<FSWatcher['addListener']>): FSWatcher {
    seen.add(this)
    return original.apply(this, args)
  }
  Object.assign(proto, { on: record, addListener: record })
  let stop: () => void
  try {
    stop = create()
  } finally {
    delete (proto as Partial<FSWatcher>).on
    delete (proto as Partial<FSWatcher>).addListener
  }
  const [watcher] = [...seen]
  assert.ok(watcher, 'expected followFile to create an FSWatcher')
  return { watcher, stop }
}

type Line = { message: string }

test('JsonlTailer dispatches only lines appended since the last pull', async () => {
  const dir = await tmpWorkspace()
  const path = join(dir, 'log.jsonl')
  try {
    const seen: string[] = []
    const tailer = new JsonlTailer<Line>(path, e => void seen.push(e.message))

    await tailer.pull() // file absent -> no throw, nothing seen
    assert.deepEqual(seen, [])

    await writeFile(path, line('one') + line('two'))
    await tailer.pull()
    assert.deepEqual(seen, ['one', 'two'])

    await appendFile(path, line('three'))
    await tailer.pull()
    assert.deepEqual(seen, ['one', 'two', 'three']) // only the new line was re-read
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('JsonlTailer buffers a torn trailing line until its newline arrives', async () => {
  const dir = await tmpWorkspace()
  const path = join(dir, 'log.jsonl')
  try {
    const seen: string[] = []
    const tailer = new JsonlTailer<Line>(path, e => void seen.push(e.message))

    await writeFile(path, line('complete') + '{"mess') // half a second line
    await tailer.pull()
    assert.deepEqual(seen, ['complete']) // the fragment is held back

    await appendFile(path, 'age":"rest"}\n')
    await tailer.pull()
    assert.deepEqual(seen, ['complete', 'rest'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('JsonlTailer resets when the log is truncated by a fresh run', async () => {
  const dir = await tmpWorkspace()
  const path = join(dir, 'log.jsonl')
  try {
    const seen: string[] = []
    const tailer = new JsonlTailer<Line>(path, e => void seen.push(e.message))

    await writeFile(path, line('old-run'))
    await tailer.pull()
    assert.deepEqual(seen, ['old-run'])

    // Truncate + rewrite to the SAME byte length, so this is caught by the mtime check, not by
    // the shrink check.
    await sleep(20) // let mtime advance past the read above
    await writeFile(path, line('new-run'))
    await tailer.pull()
    assert.deepEqual(seen, ['old-run', 'new-run'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('JsonlTailer.pull rejects when the read fails, which is what pump has to absorb (#996)', async () => {
  const cwd = await tmpWorkspace()
  try {
    // A directory opens and stats fine, then rejects on read (EISDIR) — the same shape as an
    // EIO on a network mount, and the surface `pull`'s own try/catch does not cover.
    const tailer = new JsonlTailer(cwd, () => {})
    await assert.rejects(() => tailer.pull(), /EISDIR/)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('followFile survives a pull that rejects, and keeps pulling (#996)', async () => {
  const cwd = await tmpWorkspace()
  let calls = 0
  // Rejects on the seeding pull and the first polls, then recovers, the way a transient read
  // error does. Without the catch in `pump` the very first one is an unhandled rejection.
  const stop = followFile(
    cwd,
    async () => {
      calls += 1
      if (calls <= 3) throw new Error('EIO: simulated read failure')
    },
    { pollMs: 20 },
  )
  try {
    // Waited for, not slept through: on a loaded machine five polls can take longer than any
    // fixed pause, and the test then failed with the code right.
    const deadline = Date.now() + 5_000
    while (calls <= 4 && Date.now() < deadline) await sleep(10)
    assert.ok(calls > 4, `expected polling to continue past the failures, saw ${calls} pulls`)
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('followFile survives a rejecting pull through the real tailer, over a directory (#996)', async () => {
  const cwd = await tmpWorkspace()
  const tailer = new JsonlTailer(cwd, () => {})
  const stop = followFile(cwd, () => tailer.pull(), { pollMs: 20 })
  try {
    await sleep(200) // several failing polls; the process must still be here to assert
    assert.ok(true)
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a watcher error does not throw, and the poll keeps the tail alive (#996)', async () => {
  const cwd = await tmpWorkspace()
  const path = join(cwd, 'events.jsonl')
  await writeFile(path, line('before'))
  const seen: string[] = []
  const tailer = new JsonlTailer<{ message: string }>(path, e => void seen.push(e.message))
  const { watcher, stop } = captureWatcher(() => followFile(cwd, () => tailer.pull(), { pollMs: 20 }))
  try {
    await sleep(150)
    assert.deepEqual(seen, ['before'])
    // Exactly what node does when the watch handle fails: it closes the handle, then emits.
    // With no listener that throws straight out of `emit` and takes the process with it.
    assert.doesNotThrow(() => void watcher.emit('error', new Error('EPERM: simulated watch failure')))
    await appendFile(path, line('after'))
    await sleep(300) // the watcher is gone; only the poll backstop can deliver this
    assert.deepEqual(seen, ['before', 'after'])
  } finally {
    stop()
    await rm(cwd, { recursive: true, force: true })
  }
})

/**
 * `unref: true` must cover both handles `followFile` opens, not just the poll timer.
 *
 * The watcher was left ref'd, so a caller that opted out of holding the process open was still
 * held open by it. That only stayed invisible while every caller closed its tail on the way out;
 * an agent that aborted on a config fault before its tail had an owner never exited, and sat there
 * with the agent recorded as `running` forever.
 *
 * Asserted in a child process, because that is the actual claim: not "unref was called" but "the
 * process is able to exit". A ref'd watcher hangs it until the test timeout kills it.
 */
test('followFile with unref lets the process exit, watcher included', async () => {
  const { spawn } = await import('node:child_process')
  const cwd = await tmpWorkspace()
  await writeFile(join(cwd, 'events.jsonl'), line('seed'))
  const moduleUrl = new URL('./jsonl-tail.js', import.meta.url).href
  try {
    const code = await new Promise<number | null>((resolvePromise, rejectPromise) => {
      // Nothing else in this child holds the loop: if it exits, the tail let go of it.
      const child = spawn(
        process.execPath,
        [
          '-e',
          `import(${JSON.stringify(moduleUrl)}).then(m => {` +
            `m.followFile(${JSON.stringify(cwd)}, async () => {}, { pollMs: 20, unref: true })` +
            `})`,
        ],
        { stdio: 'ignore' },
      )
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        rejectPromise(new Error('followFile({ unref: true }) kept the process alive'))
      }, 10_000)
      child.once('error', rejectPromise)
      child.once('exit', exitCode => {
        clearTimeout(timer)
        resolvePromise(exitCode)
      })
    })
    assert.equal(code, 0)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
