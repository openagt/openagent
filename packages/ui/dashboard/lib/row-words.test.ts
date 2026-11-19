import { describe, expect, test } from 'vitest'
import type { OpenAgentEvent } from '../../src/index.js'
import { formatOpenAgentEvent } from '../../src/client.js'
import { rowWords } from './row-words.js'

// The chat's words for the rows the terminal writes with glyphs. Each is said as a chat says
// things — no ■ ◆ ✗, no indent, no machine's spelling of a time — and anything this does not name
// keeps the terminal's line, so no row can come out empty.
describe('the chat says a row in its own words', () => {
  test('how a run ended: stopped is not a failure, and a failure says what went wrong', () => {
    expect(rowWords({ kind: 'end', ok: false, stopped: true })).toEqual({ said: 'Stopped' })
    expect(rowWords({ kind: 'end', ok: false, detail: 'exited 1' })).toEqual({ said: 'Failed — exited 1' })
    expect(rowWords({ kind: 'end', ok: false })).toEqual({ said: 'Failed — unknown error' })
    // A clean end and an end waiting on an answer are no rows: the agent's own last word is the end.
    expect(rowWords({ kind: 'end', ok: true })).toBeUndefined()
    expect(rowWords({ kind: 'end', ok: false, waiting: true })).toBeUndefined()
  })

  test('where the work is: the branch, the pull request (which opens), the hand-off', () => {
    expect(rowWords({ kind: 'branch', branch: 'fix-the-thing' })).toEqual({ said: 'Branch', thing: 'fix-the-thing' })
    expect(rowWords({ kind: 'pull-request', number: 2105, url: 'https://github.com/openagt/openagent/pull/2105' })).toEqual({
      said: 'Pull request',
      thing: '#2105',
      href: 'https://github.com/openagt/openagent/pull/2105',
    })
    expect(rowWords({ kind: 'cloud-anchor', sha: '806eb7cb9af2dfcc9d1284990ca179f5ea8d80e1' })).toEqual({ said: 'Handed off at', thing: '806eb7c' })
  })

  test('what was said: a log line, a notice and an error keep their own text', () => {
    expect(rowWords({ kind: 'log', message: 'the checkout was reclaimed' })).toEqual({ said: 'the checkout was reclaimed' })
    expect(rowWords({ kind: 'driver', event: { type: 'notice', message: 'resumed from the record' } })).toEqual({ said: 'resumed from the record' })
    expect(rowWords({ kind: 'error', headline: 'gh is not logged in', detail: 'run gh auth login' })).toEqual({
      said: 'gh is not logged in',
      detail: 'run gh auth login',
    })
    expect(rowWords({ kind: 'error', headline: 'gh is not logged in' })).toEqual({ said: 'gh is not logged in' })
    expect(rowWords({ kind: 'driver', event: { type: 'error', message: 'rate limited' } })).toEqual({
      said: 'The agent reported an error',
      detail: 'rate limited',
    })
  })

  test("the quota reads in words, and comes back on the reader's own clock", () => {
    const at = Date.UTC(2026, 9, 16, 18, 30)
    const quota = (status: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'rate-limit', limit: { status, window: 'five_hour', resetsAt: at } } }) as OpenAgentEvent
    expect(rowWords(quota('rejected'))).toEqual({ said: 'The five-hour quota is used up', thing: `resets ${new Date(at).toLocaleString()}` })
    expect(rowWords(quota('allowed_warning'))?.said).toBe('The five-hour quota is running low')
    // A quota that is fine is no row, as it is no line in the terminal either.
    expect(rowWords(quota('allowed'))).toBeUndefined()
  })

  test('nothing the chat names keeps a glyph or an indent of the terminal', () => {
    const rows: OpenAgentEvent[] = [
      { kind: 'end', ok: false, stopped: true },
      { kind: 'end', ok: false, detail: 'boom' },
      { kind: 'error', headline: 'no' },
      { kind: 'settled' },
      { kind: 'branch', branch: 'b' },
      { kind: 'pull-request', number: 1, url: 'https://x/1' },
      { kind: 'cloud-anchor', sha: 'abcdef1234' },
      { kind: 'log', message: 'said' },
      { kind: 'intent', text: 'make it shorter' },
    ]
    for (const e of rows) {
      const words = rowWords(e)
      expect(words, e.kind).toBeTruthy()
      const whole = `${words!.said} ${words!.thing ?? ''}`
      expect(whole, e.kind).not.toMatch(/[◆■✗▶?✓›‹·💭~!]/)
      expect(words!.said.startsWith(' '), e.kind).toBe(false)
      // The terminal still has its own line for every one of them.
      expect(formatOpenAgentEvent(e), e.kind).toBeTruthy()
    }
  })

  test('a kind the chat does not name keeps the terminal line', () => {
    expect(rowWords({ kind: 'session', driver: 'claude-code', workspace: '/repo', fake: false })).toBeUndefined()
    expect(rowWords({ kind: 'usage', costUsd: 0.12 })).toBeUndefined()
    expect(rowWords({ kind: 'driver', event: { type: 'text', text: 'hello' } })).toBeUndefined()
  })
})
