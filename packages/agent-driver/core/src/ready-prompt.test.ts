import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readyPrompt } from './ready-prompt.js'

// A prompt whose process starts before its words are known: the words go once, and a process that
// ended or was cancelled takes none.

test('the turn starts at once and gets its words when the prompt is sent', async () => {
  let started = false
  let given: string | undefined
  const ready = readyPrompt(async words => {
    started = true
    given = await words
    return { text: `named: ${given}` }
  })
  assert.equal(started, true, 'the process is started before any words')
  assert.equal(ready.waiting, true)
  assert.deepEqual(await ready.prompt('fix the login test'), { text: 'named: fix the login test' })
  assert.equal(given, 'fix the login test')
  assert.equal(ready.waiting, false, 'a process takes one prompt')
  await assert.rejects(() => ready.prompt('again'), /one prompt/)
})

test('a process that ended while it waited takes no prompt, and says so', async () => {
  const ready = readyPrompt(() => Promise.reject(new Error('not logged in')))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(ready.waiting, false)
  await assert.rejects(() => ready.prompt('words'), /ended before it was asked/)
})

test('cancelling ends the process through its signal', async () => {
  let stopped = false
  const ready = readyPrompt(
    (_words, stop) =>
      new Promise((_resolve, reject) => {
        stop.addEventListener('abort', () => {
          stopped = true
          reject(new Error('aborted'))
        })
      }),
  )
  ready.cancel()
  ready.cancel()
  assert.equal(stopped, true)
  assert.equal(ready.waiting, false)
})
