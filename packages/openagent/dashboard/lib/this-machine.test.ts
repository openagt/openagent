import { describe, expect, test } from 'vitest'
import { thisMachineName } from './this-machine.js'

describe('what the page calls the machine its dashboard is on', () => {
  test('opened on the computer itself it is "This machine"', () => {
    for (const own of ['localhost', '127.0.0.1', '[::1]', '::1', '']) expect(thisMachineName(own)).toBe('This machine')
    // A test's page is at the computer's own name.
    expect(thisMachineName()).toBe('This machine')
  })

  test('opened from anywhere else it is the name the page was reached at', () => {
    expect(thisMachineName('165.245.244.10')).toBe('165.245.244.10')
    expect(thisMachineName('suleimans-macbook-pro.local')).toBe('suleimans-macbook-pro.local')
    // A name that only starts like a loopback address is a name on a network.
    expect(thisMachineName('127.evil.com')).toBe('127.evil.com')
  })
})
