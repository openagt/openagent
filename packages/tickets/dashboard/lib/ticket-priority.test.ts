import { describe, expect, test } from 'vitest'
import { parsePriority, priorityTone } from './ticket-priority.js'

describe('ticket-priority (#1144/#1265)', () => {
  test('parses a numeric priority string', () => {
    expect(parsePriority('7')).toBe(7)
    expect(parsePriority('0')).toBe(0)
  })

  test('an absent or unparseable priority is undefined, not NaN', () => {
    expect(parsePriority(undefined)).toBe(undefined)
    expect(parsePriority('urgent')).toBe(undefined)
  })

  test('tone reads red at 10 only, the queue\'s "act immediately", and in the text colour below it and when absent', () => {
    expect(priorityTone('10')).toBe('text-danger')
    expect(priorityTone('9')).toBe('text-foreground')
    expect(priorityTone('8')).toBe('text-foreground')
    expect(priorityTone('0')).toBe('text-foreground')
    expect(priorityTone(undefined)).toBe('text-foreground')
  })
})
