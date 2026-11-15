import { describe, expect, test } from 'vitest'
import { ADD_TO_QUEUE } from './add-to-queue.js'
import { fakeHost } from './test-host.js'

describe('"Add to queue"', () => {
  test('a link the queue holds an entry for is done already, read from the queue once; another is not', async () => {
    const host = fakeHost({ p1: { '--local': ['[Login page](tickets/login.md) after the review', 'Tidy the loader'] } })
    const done = await ADD_TO_QUEUE.done!(host, 'p1')
    expect(done({ text: 'Login', href: 'tickets/login.md' })).toBe(true)
    expect(done({ text: 'Tidy the loader' })).toBe(true)
    expect(done({ text: 'Signup', href: 'tickets/signup.md' })).toBe(false)
    expect(host.runCommand.mock.calls).toEqual([['p1', ['--local']]])
  })
})
