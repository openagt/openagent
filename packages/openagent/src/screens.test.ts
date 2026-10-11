import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { OpenAgentEvent } from './events.js'
import { foldScreenRows, liveScreen } from './screens.js'

const at = (n: number) => `http://127.0.0.1:${n}/?t=x`
const shown = (url: string, label = 'browser'): OpenAgentEvent => ({ kind: 'screen', url, label })
const gone = (url: string): OpenAgentEvent => ({ kind: 'screen', url, label: 'browser · closed', ended: true })

test('a run\'s live screen is its newest open one, until it closes or the run ends', () => {
  assert.equal(liveScreen([]), undefined)
  assert.equal(liveScreen([shown(at(1))]), at(1))
  assert.equal(liveScreen([shown(at(1)), shown(at(1), 'next page')]), at(1))
  assert.equal(liveScreen([shown(at(1)), gone(at(1))]), undefined)
  assert.equal(liveScreen([shown(at(1)), { kind: 'end', ok: true }]), undefined)
  assert.equal(liveScreen([shown(at(1)), { kind: 'end', ok: false, waiting: true }]), at(1), 'a run waiting on an answer keeps its screen')
  // A browser closed and opened again answers at a new address: the old one is gone, the new one live.
  assert.equal(liveScreen([shown(at(1)), gone(at(1)), shown(at(2))]), at(2))
  assert.equal(liveScreen([shown(at(1)), { kind: 'end', ok: true }, shown(at(2))]), at(2), 'a run continued opens a screen again')
})

test('the rows: the newest line at an address is the live one, an ended line is hidden', () => {
  const first = shown(at(1))
  const second = shown(at(1), 'next page')
  const closed = gone(at(1))
  assert.deepEqual([...foldScreenRows([first, second]).live], [second])
  const folded = foldScreenRows([first, second, closed])
  assert.equal(folded.live.size, 0)
  assert.deepEqual([...folded.hidden], [closed])
})
