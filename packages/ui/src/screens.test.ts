import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { OpenAgentEvent } from './events.js'
import { foldScreenRows, liveScreen } from './screens.js'

const at = (n: number) => `http://127.0.0.1:${n}/?t=x`
const shown = (url: string, label = 'browser'): OpenAgentEvent => ({ kind: 'screen', url, label })
const gone = (url: string): OpenAgentEvent => ({ kind: 'screen', url, label: 'browser · closed', ended: true })
/** What the browser writes when it outlives its run: the live view stays until then. */
const kept = (url: string, until: string): OpenAgentEvent => ({ kind: 'screen', url, label: 'browser', until })
const NOW = Date.parse('2026-10-15T12:00:00.000Z')
const soon = new Date(NOW + 60_000).toISOString()
const past = new Date(NOW - 60_000).toISOString()

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

test('a browser that outlives its run keeps its screen until it says, and no longer', () => {
  const ended: OpenAgentEvent = { kind: 'end', ok: true }
  assert.equal(liveScreen([shown(at(1)), ended, kept(at(1), soon)], NOW), at(1), 'the person still has the page the run left')
  assert.equal(liveScreen([shown(at(1)), ended, kept(at(1), past)], NOW), undefined, 'the time it was kept for has passed')
  assert.equal(liveScreen([shown(at(1)), ended, kept(at(1), soon), gone(at(1))], NOW), undefined, 'the browser closed before that time')
  // Kept, then said again for longer while the person was still watching.
  assert.equal(liveScreen([shown(at(1)), ended, kept(at(1), past), kept(at(1), soon)], NOW), at(1))
  // A line that keeps another browser's screen says nothing about this one.
  assert.equal(liveScreen([shown(at(1)), ended, kept(at(2), soon)], NOW), undefined)
  // The lines that keep a screen are rows of their own to nobody.
  const line = kept(at(1), soon)
  const folded = foldScreenRows([shown(at(1)), ended, line], NOW)
  assert.deepEqual([...folded.hidden], [line])
  assert.equal(folded.live.size, 1)
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
