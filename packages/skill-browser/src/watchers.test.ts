import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { test } from 'node:test'
import { consoleLog } from './console.js'
import { ACTED, CONSOLE, CURSOR, FRAME, readConsoleLine, SELECTED, streamReader } from './stream.js'
import { screenWatchers } from './watchers.js'

/** A watcher's stream: what it was sent, kind and bytes, and whether it is full right now. */
function watcher() {
  const res = Object.assign(new EventEmitter(), {
    writableNeedDrain: false,
    sent: [] as Uint8Array[],
    write(bytes: Uint8Array) {
      res.sent.push(bytes)
      return true
    },
    end() {},
  })
  const read = streamReader()
  const parts = () => res.sent.splice(0).flatMap(bytes => read(bytes))
  return { res, stream: res as unknown as ServerResponse, parts }
}

const jpeg = (n: number) => Buffer.from([0xff, 0xd8, n])

test('who joins is told what the others see: the picture, the pointer, the selection, where the agent acted, the console so far', () => {
  const log = consoleLog()
  const watchers = screenWatchers(log)
  log.add({ at: 1, level: 'log', text: 'before anyone watched' })
  watchers.picture(jpeg(1))
  watchers.cursor('pointer')
  watchers.selection('hunter2')
  watchers.acted({ x: 3, y: 4, act: 'click' })

  const late = watcher()
  watchers.join(late.stream)
  assert.deepEqual(
    late.parts().map(part => part.kind),
    [FRAME, CURSOR, SELECTED, ACTED, CONSOLE],
  )
  // Told once: the same pointer again says nothing; another page has the agent's pointer nowhere.
  watchers.cursor('pointer')
  watchers.actedNowhere()
  const after = watcher()
  watchers.join(after.stream)
  assert.deepEqual(late.parts(), [])
  assert.ok(!after.parts().some(part => part.kind === ACTED))
})

test('a stream too slow for the pictures gets the newest one when it drains, and the console lines it missed', () => {
  const log = consoleLog()
  const watchers = screenWatchers(log)
  const slow = watcher()
  watchers.join(slow.stream)
  slow.parts()

  slow.res.writableNeedDrain = true
  watchers.picture(jpeg(1))
  watchers.picture(jpeg(2))
  log.add({ at: 1, level: 'error', text: 'one' })
  watchers.pourConsole()
  watchers.cursor('text')
  assert.deepEqual(slow.parts(), [], 'nothing is written to a full stream')

  slow.res.writableNeedDrain = false
  slow.res.emit('drain')
  const [picture, line, ...rest] = slow.parts()
  assert.deepEqual([...picture!.bytes], [...jpeg(2)], 'the newest picture, not a queue of old ones')
  assert.equal(readConsoleLine(line!.bytes)?.text, 'one')
  assert.deepEqual(rest, [], 'the pointer is told at its next change, not on a drain')
})
