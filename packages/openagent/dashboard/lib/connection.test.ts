import { describe, expect, test } from 'vitest'
import { currentConnection } from './connection.js'

describe('which daemon the dashboard is on (#1052)', () => {
  test('a loopback address is this machine, any other is that machine by its address', () => {
    expect(currentConnection('localhost:4200', 'localhost')).toEqual({ label: 'Local', isLocal: true })
    expect(currentConnection('127.0.0.1:4200', '127.0.0.1')).toEqual({ label: 'Local', isLocal: true })
    expect(currentConnection('192.168.1.5:4200', '192.168.1.5')).toEqual({ label: '192.168.1.5:4200', isLocal: false })
  })
})
