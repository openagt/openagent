import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { OpenAgentEvent } from '../../src/index.js'
import { AgentDetails } from './AgentDetails.js'

const onModels = vi.hoisted(() =>
  vi.fn(async () => ({ 'claude-code': { models: [{ id: 'opus', name: 'Opus 5.5', resolvedId: 'claude-opus-5-5' }] }, codex: { models: [] } })),
)
vi.mock('../rpc/models.js', () => ({ onModels }))

afterEach(cleanup)

const answered: OpenAgentEvent = { kind: 'driver', event: { type: 'result', text: 'Done.' } }
const priced = (usd: number): OpenAgentEvent => ({ kind: 'usage', costUsd: usd })
const shown = (label: string) => screen.getByText(label).nextSibling?.textContent

describe('AgentDetails', () => {
  test('before the record holds a priced or answered turn, the strip says so', () => {
    render(<AgentDetails events={[]} />)
    expect(screen.getByText(/No spend reported yet/)).toBeTruthy()
    expect(screen.queryByText('Spent')).toBeNull()
    expect(screen.queryByText('Turns')).toBeNull()
  })

  test('the spend is every priced turn added up and the turns are the answers; the record keeps no token counts, so none show', () => {
    render(<AgentDetails events={[answered, priced(0.5), answered, priced(0.25)]} />)
    expect(shown('Spent')).toBe('$0.75')
    expect(shown('Turns')).toBe('2')
    expect(screen.queryByText('Tokens')).toBeNull()
    expect(screen.queryByText('Cache')).toBeNull()
    expect(screen.queryByText(/No spend reported yet/)).toBeNull()
  })

  test('the agent and model come off the run\'s card, each by the name a person knows it by', async () => {
    render(<AgentDetails events={[]} card={{ driver: 'claude-code', model: 'opus' }} />)
    expect(shown('Agent')).toBe('Claude Code')
    await waitFor(() => expect(shown('Model')).toBe('Opus 5.5'))
    cleanup()
    // What a run's card holds once Claude Code named the model it ran.
    render(<AgentDetails events={[]} card={{ driver: 'claude-code', model: 'claude-opus-5-5' }} />)
    await waitFor(() => expect(shown('Model')).toBe('Opus 5.5'))
    cleanup()
    render(<AgentDetails events={[]} card={{ driver: 'codex' }} />)
    expect(shown('Agent')).toBe('Codex')
    expect(screen.queryByText('Model')).toBeNull()
  })

  test('before the card is listed, no agent or model is named', () => {
    render(<AgentDetails events={[]} />)
    expect(screen.queryByText('Agent')).toBeNull()
    expect(screen.queryByText('Model')).toBeNull()
  })

  test('an answered turn without a price shows the turn alone', () => {
    render(<AgentDetails events={[answered]} />)
    expect(screen.queryByText('Spent')).toBeNull()
    expect(shown('Turns')).toBe('1')
  })
})
