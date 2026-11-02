import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const onBridgeToken = vi.hoisted(() => vi.fn(async (): Promise<string | null> => 'tok-1'))
const onBridgeStatus = vi.hoisted(() =>
  vi.fn(async () => ({ lastContact: null, questions: 0, page: null, version: null }) as {
    lastContact: { at: string; route: string; status: number } | null
    questions: number
    page: null
    version: { got: string; expected: string; blocked: boolean; at: string } | null
  }),
)
vi.mock('../rpc/reads.js', () => ({ onBridgeToken, onBridgeStatus }))

import { BridgeSettings } from './BridgeSettings.js'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('BridgeSettings version gate (#1519)', () => {
  test('a refused extension is named, with both versions and the way out', async () => {
    // Without this line the block is invisible from the dashboard: the bridge just looks
    // disconnected, which after a repo pull is exactly the wrong diagnosis to hand someone.
    onBridgeStatus.mockResolvedValue({
      lastContact: null,
      questions: 0,
      page: null,
      version: { got: '0.7.3', expected: '0.8.0', blocked: true, at: '2026-08-17T12:00:00.000Z' },
    })
    render(<BridgeSettings enabled onChange={() => {}} />)
    const notice = await screen.findByText(/blocked/)
    expect(notice.textContent).toContain('0.7.3')
    expect(notice.textContent).toContain('0.8.0')
    expect(notice.textContent).toContain('chrome://extensions')
  })

  test('an accepted version shows no blocked notice', async () => {
    onBridgeStatus.mockResolvedValue({
      lastContact: null,
      questions: 0,
      page: null,
      version: { got: '0.8.0', expected: '0.8.0', blocked: false, at: '2026-08-17T12:00:00.000Z' },
    })
    render(<BridgeSettings enabled onChange={() => {}} />)
    // The token row proves the panel rendered before asserting the absence.
    await screen.findByText(/paste this token/)
    expect(screen.queryByText(/blocked/)).toBeNull()
  })
})

describe('BridgeSettings refused contact (#1225)', () => {
  test('a rejected token is named, with the way out', async () => {
    // A 401 dies before the version gate, so no version claim exists to render — the
    // refused-contact slot is the only evidence something is trying with a stale token.
    onBridgeStatus.mockResolvedValue({
      lastContact: { at: '2026-08-17T12:00:00.000Z', route: '/_bridge/sessions', status: 401 },
      questions: 0,
      page: null,
      version: null,
    })
    render(<BridgeSettings enabled onChange={() => {}} />)
    const notice = await screen.findByText(/token this dashboard rejects/)
    expect(notice.textContent).toContain('save the token')
  })

  test('an accepted contact shows no refused notice', async () => {
    onBridgeStatus.mockResolvedValue({
      lastContact: { at: '2026-08-17T12:00:00.000Z', route: '/_bridge/sessions', status: 200 },
      questions: 0,
      page: null,
      version: { got: '0.8.0', expected: '0.8.0', blocked: false, at: '2026-08-17T12:00:00.000Z' },
    })
    render(<BridgeSettings enabled onChange={() => {}} />)
    await screen.findByText(/paste this token/)
    expect(screen.queryByText(/rejects/)).toBeNull()
  })

  test('a version block outranks a refused contact left behind by the same extension', async () => {
    // Fixing the token is step one; once it lands, the version gate speaks and its banner
    // carries the more specific cure. Both at once would say "do two things" in two colors.
    onBridgeStatus.mockResolvedValue({
      lastContact: { at: '2026-08-17T11:00:00.000Z', route: '/_bridge/sessions', status: 401 },
      questions: 0,
      page: null,
      version: { got: '0.7.3', expected: '0.8.0', blocked: true, at: '2026-08-17T12:00:00.000Z' },
    })
    render(<BridgeSettings enabled onChange={() => {}} />)
    await screen.findByText(/blocked/)
    expect(screen.queryByText(/token this dashboard rejects/)).toBeNull()
  })
})
