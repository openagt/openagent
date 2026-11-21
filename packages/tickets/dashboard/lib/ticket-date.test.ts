import { describe, expect, test } from 'vitest'
import { ticketAge, ticketDay } from './ticket-date.js'

// A ticket named on the 13th, as the command dates it: that day's midnight in UTC.
const named = { file: '2026-11-13_dark-mode.md', date: '2026-11-13T00:00:00.000Z' }

describe('a ticket\'s age, in days', () => {
  test('named today, it is today at any hour of it, and yesterday the next day', () => {
    expect(ticketAge(named, new Date(2026, 10, 13, 0, 5))).toBe('today')
    expect(ticketAge(named, new Date(2026, 10, 13, 21, 31))).toBe('today')
    expect(ticketAge(named, new Date(2026, 10, 14, 9, 0))).toBe('yesterday')
  })

  test('then days, weeks and years', () => {
    expect(ticketAge(named, new Date(2026, 10, 16))).toBe('3d ago')
    expect(ticketAge(named, new Date(2026, 11, 1))).toBe('2w ago')
    expect(ticketAge(named, new Date(2028, 0, 1))).toBe('1y ago')
  })

  test('a ticket named otherwise is dated by the day of its file; one with no date has no age', () => {
    expect(ticketAge({ file: 'imported.md', date: new Date(2026, 10, 12, 23, 59).toISOString() }, new Date(2026, 10, 13, 0, 1))).toBe('yesterday')
    expect(ticketAge({ file: 'imported.md', date: 'not a date' })).toBe('—')
  })

  test('the tooltip says the day, with no hour', () => {
    expect(ticketDay(named)).toBe(new Date(2026, 10, 13).toLocaleDateString())
  })
})
