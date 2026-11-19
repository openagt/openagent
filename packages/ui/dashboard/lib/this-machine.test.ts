import { describe, expect, test } from 'vitest'
import { ownComputerName, thisMachineName } from './this-machine.js'

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

describe('what the page calls its own computer beside the others', () => {
  test('opened from anywhere else, the name the page was reached at, as "Run on" says it', () => {
    expect(ownComputerName('ubuntu-s-1vcpu-2gb-fra1', '165.245.244.10')).toBe('165.245.244.10')
    expect(ownComputerName(undefined, '165.245.244.10')).toBe('165.245.244.10')
  })

  test('opened on the computer itself, its own name', () => {
    expect(ownComputerName('Suleimans-MacBook-Pro', 'localhost')).toBe('Suleimans-MacBook-Pro')
    expect(ownComputerName(undefined, '127.0.0.1')).toBeUndefined()
  })
})
