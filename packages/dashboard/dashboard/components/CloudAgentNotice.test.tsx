import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { OpenAgentEvent } from '../../src/index.js'

// The component reads the bridge over three RPCs; unmocked they fetch `/_rpc/<name>`, which no
// daemon answers behind jsdom, so each read hangs or throws instead of returning a fixture.
const onBridgeQuestion = vi.fn(async () => null as unknown)
const onBridgeEvents = vi.fn(async () => [] as unknown)
const onBridgeAnswer = vi.fn(async () => null as unknown)
vi.mock('../rpc/reads.js', () => ({ onBridgeQuestion, onBridgeEvents, onBridgeAnswer }))
const sendBridgeAnswer = vi.fn(async () => ({ ok: true }) as { ok: boolean; error?: string })
const sendBridgeAnswerCancel = vi.fn(async () => undefined)
const sendChoice = vi.fn(async () => undefined)
vi.mock('../rpc/control.js', () => ({ sendBridgeAnswer, sendBridgeAnswerCancel, sendChoice }))

const { CloudAgentNotice, CloudMirrorRow, scrubMirrorText } = await import('./CloudAgentNotice.js')

afterEach(() => {
  cleanup()
  onBridgeQuestion.mockReset()
  onBridgeQuestion.mockResolvedValue(null)
  onBridgeEvents.mockReset()
  onBridgeEvents.mockResolvedValue([])
  onBridgeAnswer.mockReset()
  onBridgeAnswer.mockResolvedValue(null)
  sendBridgeAnswer.mockReset()
  sendBridgeAnswer.mockResolvedValue({ ok: true })
  sendBridgeAnswerCancel.mockReset()
  sendChoice.mockReset()
})

const URL = 'https://claude.ai/code/session_01ABCdefGHIjklMNO?from=cli&m=0'
const handOff = (url = URL): OpenAgentEvent => ({ kind: 'driver', event: { type: 'action', label: `cloud ${url}` } })

const QUESTION = {
  sessionId: 'session_01ABCdefGHIjklMNO',
  title: 'Where should the tickets page live?',
  options: [{ label: 'One page, both routes', detail: 'lists every project' }, { label: 'Cross-project only' }],
  recommended: 'One page, both routes',
  receivedAt: '2026-07-26T18:00:00.000Z',
}

describe('CloudAgentNotice (#610)', () => {
  test('says the session is still being created before the hand-off lands', () => {
    render(<CloudAgentNotice target="web" events={[]} projectId="p" agentId="a" />)
    expect(screen.getByRole('status').textContent).toMatch(/Starting a Claude Code cloud session/i)
    expect(screen.queryByRole('link')).toBeNull()
  })

  test('links through to the cloud session once the driver reports it', () => {
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    expect(screen.getByRole('link', { name: /Open the session/i }).getAttribute('href')).toBe(URL)
  })

  test('offers the teleport command, which is how the work comes back to this machine', () => {
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    expect(screen.getByRole('status').textContent).toMatch(/claude --teleport session_01ABCdefGHIjklMNO/)
  })

  test('says the cloud session opens its own PR, since nothing streams back here', () => {
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    expect(screen.getByRole('status').textContent).toMatch(/opens its own pull request/i)
  })

  test('says a question it parks on shows here once the bridge carries it (#1554)', () => {
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    expect(screen.getByRole('status').textContent).toMatch(/a question it parks on shows here/i)
  })

  test('renders nothing for the other targets', () => {
    for (const target of ['local', 'actions', 'remote'] as const) {
      const { container } = render(<CloudAgentNotice target={target} events={[handOff()]} projectId="p" agentId="a" />)
      expect(container.firstChild).toBeNull()
    }
    expect(render(<CloudAgentNotice events={[]} projectId="p" agentId="a" />).container.firstChild).toBeNull()
  })
})

describe('the parked question the bridge reports (#1237)', () => {
  test('shows the question and its options once the bridge has one', async () => {
    onBridgeQuestion.mockResolvedValue(QUESTION)
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    await waitFor(() => expect(screen.getByText(QUESTION.title)).toBeTruthy())
    // The card a local agent's question gets (#1554), with the options only: the bridge types
    // nothing but the question's own labels, so there is no "Other" row and no Skip.
    expect(screen.getByRole('region', { name: QUESTION.title })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /One page, both routes/ }).textContent).toBe('One page, both routesRecommendedlists every project')
    expect(screen.getByRole('radio', { name: /Cross-project only/ }).getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('radio', { name: 'Other' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy()
  })

  test('its number keys are not bound: they belong to a question in the chat', async () => {
    onBridgeQuestion.mockResolvedValue(QUESTION)
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    await screen.findByRole('region', { name: QUESTION.title })
    fireEvent.keyDown(window, { key: '2' })
    expect(screen.getByRole('radio', { name: /Cross-project only/ }).getAttribute('aria-checked')).toBe('false')
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(sendBridgeAnswer).not.toHaveBeenCalled()
    expect(screen.queryByText(/Number keys pick/)).toBeNull()
  })

  test('is asked for by cloud session id, which is what the bridge can see', async () => {
    onBridgeQuestion.mockResolvedValue(QUESTION)
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    await waitFor(() => expect(onBridgeQuestion).toHaveBeenCalledWith('session_01ABCdefGHIjklMNO'))
  })

  test('keeps the link out as the manual way to answer', async () => {
    onBridgeQuestion.mockResolvedValue(QUESTION)
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    const link = await screen.findByRole('link', { name: /Answer it in the session/i })
    expect(link.getAttribute('href')).toBe(URL)
  })

  test('shows nothing extra when no question is parked, so an ordinary run is unchanged', async () => {
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    await waitFor(() => expect(onBridgeQuestion).toHaveBeenCalled())
    expect(screen.queryByRole('link', { name: /Answer it in the session/i })).toBeNull()
  })

  test('never asks before the hand-off lands: there is no session to ask about', () => {
    render(<CloudAgentNotice target="web" events={[]} projectId="p" agentId="a" />)
    expect(onBridgeQuestion).not.toHaveBeenCalled()
  })
})

describe('answering from the dashboard (#1237)', () => {
  const ANSWER = {
    id: 'a1',
    sessionId: 'session_01ABCdefGHIjklMNO',
    labels: ['Cross-project only'],
    text: 'You paused to ask: "Where should the tickets page live?". The user chose: Cross-project only. Continue with that decision.',
    queuedAt: '',
    state: 'queued' as const,
  }

  test('a picked option goes through the bridge on Submit, never the local answer path (#1554)', async () => {
    onBridgeQuestion.mockResolvedValue(QUESTION)
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    fireEvent.click(await screen.findByRole('radio', { name: /Cross-project only/i }))
    expect(sendBridgeAnswer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(sendBridgeAnswer).toHaveBeenCalledWith('session_01ABCdefGHIjklMNO', ['Cross-project only']))
    expect(sendChoice).not.toHaveBeenCalled()
  })

  test('a multi-select posts the checked subset as labels (#1554)', async () => {
    onBridgeQuestion.mockResolvedValue({
      ...QUESTION,
      multi: true,
      recommended: undefined,
      options: [{ label: 'Lint', default: true }, { label: 'Tests' }, { label: 'Docs' }],
    })
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    await screen.findByRole('region', { name: QUESTION.title })
    fireEvent.click(screen.getByRole('checkbox', { name: /Tests/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(sendBridgeAnswer).toHaveBeenCalledWith('session_01ABCdefGHIjklMNO', ['Lint', 'Tests']))
  })

  test('a refused pick shows the daemon\'s reason on the panel', async () => {
    onBridgeQuestion.mockResolvedValue(QUESTION)
    sendBridgeAnswer.mockResolvedValue({ ok: false, error: 'that session has no parked question' })
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.getByText(/that session has no parked question/)).toBeTruthy())
  })

  test('a queued answer shows as on its way, and can still be withdrawn', async () => {
    onBridgeQuestion.mockResolvedValue(QUESTION)
    onBridgeAnswer.mockResolvedValue(ANSWER)
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    await waitFor(() => expect(screen.getByText(/Sending .Cross-project only./i)).toBeTruthy())
    // The question card yields to the sending state, so a second pick cannot race the first.
    expect(screen.queryByText(QUESTION.title)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }))
    await waitFor(() => expect(sendBridgeAnswerCancel).toHaveBeenCalledWith('session_01ABCdefGHIjklMNO'))
  })

  test('a delivered answer reads as answered, with the question gone', async () => {
    onBridgeAnswer.mockResolvedValue({ ...ANSWER, state: 'sent' })
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    await waitFor(() => expect(screen.getByText(/Answered .Cross-project only./i)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Cancel/i })).toBeNull()
  })

  test('a failed delivery says so and offers the question again', async () => {
    onBridgeQuestion.mockResolvedValue(QUESTION)
    onBridgeAnswer.mockResolvedValue({ ...ANSWER, state: 'failed', note: 'no composer on the page' })
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    await waitFor(() => expect(screen.getByText(/failed: no composer on the page/i)).toBeTruthy())
    expect(screen.getByText(QUESTION.title)).toBeTruthy()
  })
})

describe('the mirror row at the log tail (#1265)', () => {
  test('renders what the session has said, in order, inside one labelled box', async () => {
    onBridgeEvents.mockResolvedValue([
      { sessionId: 'session_01ABCdefGHIjklMNO', seq: 0, role: 'agent', text: 'Reading the repo', receivedAt: '' },
      { sessionId: 'session_01ABCdefGHIjklMNO', seq: 1, role: 'agent', text: 'Found three packages', receivedAt: '' },
    ])
    render(<CloudMirrorRow target="web" events={[handOff()]} />)
    await waitFor(() => expect(screen.getByText('Reading the repo')).toBeTruthy())
    expect(screen.getByText('Found three packages')).toBeTruthy()
    // The provenance boundary: the box says what it is, so a scrape never reads as the agent's own log.
    expect(screen.getByRole('status', { name: /Cloud session mirror/i })).toBeTruthy()
  })

  test("the user's turns are one line each, the session's in full (#1225)", async () => {
    onBridgeEvents.mockResolvedValue([
      { sessionId: 'session_01ABCdefGHIjklMNO', seq: 0, role: 'user', text: 'Fix the flaky publish job\n\nYou are an agent of OpenAgent.\nProtocol: …', receivedAt: '' },
      { sessionId: 'session_01ABCdefGHIjklMNO', seq: 2, role: 'agent', text: 'Reading the repo\nFound three packages', receivedAt: '' },
      { sessionId: 'session_01ABCdefGHIjklMNO', seq: 3, role: 'user', text: 'Go with the first', receivedAt: '' },
    ])
    render(<CloudMirrorRow target="web" events={[handOff()]} />)
    await waitFor(() => expect(screen.getByText(/Found three packages/)).toBeTruthy())
    // The opening turn is the run's whole prompt: only its first line shows, the rest is a tooltip.
    const prompt = screen.getByText(/Fix the flaky publish job/)
    expect(prompt.textContent).toBe('you › Fix the flaky publish job')
    expect(prompt.getAttribute('title')).toContain('You are an agent of OpenAgent.')
    expect(screen.queryByText(/Protocol:/)).toBeNull()
    expect(screen.getByText(/Go with the first/).textContent).toBe('you › Go with the first')
    // The session's own turn is shown whole.
    expect(screen.getByText(/Reading the repo/).textContent).toBe('Reading the repo\nFound three packages')
  })

  test('shows a connecting placeholder before anything is scraped, so a web run never shows dead air', async () => {
    render(<CloudMirrorRow target="web" events={[handOff()]} />)
    await waitFor(() => expect(onBridgeEvents).toHaveBeenCalled())
    expect(screen.getByText(/Connecting to the cloud session/i)).toBeTruthy()
  })

  test('drops the claude.ai UI chrome the tail scrape drags in', async () => {
    onBridgeEvents.mockResolvedValue([
      {
        sessionId: 'session_01ABCdefGHIjklMNO',
        seq: 0,
        role: 'agent',
        text: 'Arrow keys move the tile focus\nReading the repo\nShow message actions\nSonnet 4.5\nFound three packages',
        receivedAt: '',
      },
    ])
    render(<CloudMirrorRow target="web" events={[handOff()]} />)
    await waitFor(() => expect(screen.getByText(/Reading the repo/)).toBeTruthy())
    expect(screen.getByText(/Found three packages/)).toBeTruthy()
    expect(screen.queryByText(/Arrow keys move the tile/)).toBeNull()
    expect(screen.queryByText(/Show message actions/)).toBeNull()
  })

  test('renders nothing before the hand-off or for other targets, so the feed mounts it unconditionally', () => {
    expect(render(<CloudMirrorRow target="web" events={[]} />).container.firstChild).toBeNull()
    expect(render(<CloudMirrorRow target="local" events={[handOff()]} />).container.firstChild).toBeNull()
    expect(onBridgeEvents).not.toHaveBeenCalled()
  })

  test('the notice pane no longer carries the transcript: the mirror lives at the log tail instead', async () => {
    onBridgeEvents.mockResolvedValue([
      { sessionId: 'session_01ABCdefGHIjklMNO', seq: 0, role: 'agent', text: 'Reading the repo', receivedAt: '' },
    ])
    render(<CloudAgentNotice target="web" events={[handOff()]} projectId="p" agentId="a" />)
    await waitFor(() => expect(onBridgeQuestion).toHaveBeenCalled())
    expect(screen.queryByText(/Reading the repo/)).toBeNull()
  })
})

describe('scrubMirrorText (#1265)', () => {
  test('is anchored per line: a message that mentions a model or arrows is untouched', () => {
    const text = 'We should use Sonnet 4.5 for this\nArrow keys move the tile focus\ndone'
    expect(scrubMirrorText(text)).toBe('We should use Sonnet 4.5 for this\ndone')
  })

  test('collapses the holes the dropped lines leave', () => {
    expect(scrubMirrorText('a\n\nShow message actions\n\nb')).toBe('a\n\nb')
  })

  test('an all-chrome block scrubs to nothing, so the row can skip it entirely', () => {
    expect(scrubMirrorText('Haiku 4.5\nShow message actions')).toBe('')
  })
})
