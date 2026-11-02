import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

// Record what the feed subscribes to. The channel never sends; we only care about addressing.
const onEvents = vi.hoisted(() => vi.fn())
vi.mock('../rpc/events.js', () => ({ onEvents }))

const { useLiveEvents } = await import('./use-live-events.js')

afterEach(() => {
  cleanup()
  onEvents.mockReset()
  vi.useRealTimers()
})

/** A channel stub that records its callbacks so a test can push events and drop the stream. */
function fakeChannel() {
  const callbacks: Array<(err?: Error) => void> = []
  const listeners: Array<(event: unknown) => void> = []
  return {
    channel: {
      listen: (cb: (event: unknown) => void) => listeners.push(cb),
      close: () => {},
      onClose: (cb: (err?: Error) => void) => callbacks.push(cb),
    },
    push: (event: unknown) => listeners.forEach(cb => cb(event)),
    dropWith: (err?: Error) => callbacks.forEach(cb => cb(err)),
  }
}

function Probe({ projectId, agentId: agentId }: { projectId: string | null; agentId?: string | null }) {
  const { lost } = useLiveEvents(projectId, agentId)
  return <span>{lost ? 'lost' : 'live'}</span>
}

// #770: right after Start, the agent's row does not exist yet. The feed used to subscribe with no run
// id in that window, which resolves server-side to the project root — so a newly started agent showed
// the PREVIOUS agent's log for a beat before correcting itself. The shell passes the id it got back
// from Start, so there is no window where the feed is pointed at the wrong log.
describe('useLiveEvents addressing (#770)', () => {
  test('subscribes to the run it was given', async () => {
    onEvents.mockResolvedValue(fakeChannel().channel)
    render(<Probe projectId="p1" agentId="2026-07-19T13-00-00-000Z" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledWith('p1', '2026-07-19T13-00-00-000Z'))
  })

  test('resubscribes when the selected run changes, so two runs never share a feed', async () => {
    onEvents.mockResolvedValue(fakeChannel().channel)
    const { rerender } = render(<Probe projectId="p1" agentId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledWith('p1', 'run-a'))
    rerender(<Probe projectId="p1" agentId="run-b" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledWith('p1', 'run-b'))
  })

  test('no run id still subscribes per project (the non-git fallback path)', async () => {
    onEvents.mockResolvedValue(fakeChannel().channel)
    render(<Probe projectId="p1" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledWith('p1', undefined))
  })
})

// #948: a dead stream used to be silent — events just stopped. An errored close must flip `lost`
// and retry; a clean close is the server being done on purpose (relay ended, unknown project) and
// must do neither.
describe('useLiveEvents stream loss (#948)', () => {
  test('an errored close reports the stream lost and resubscribes', async () => {
    const first = fakeChannel()
    onEvents.mockResolvedValue(first.channel)
    render(<Probe projectId="p1" agentId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    first.dropWith(new Error('connection reset'))
    await waitFor(() => expect(screen.getByText('lost')).toBeTruthy())
    // The retry resubscribes on its own and recovers.
    await waitFor(() => expect(onEvents.mock.calls.length).toBeGreaterThan(1), { timeout: 3000 })
    await waitFor(() => expect(screen.getByText('live')).toBeTruthy(), { timeout: 3000 })
  })

  test('a clean close neither alarms nor retries', async () => {
    const first = fakeChannel()
    onEvents.mockResolvedValue(first.channel)
    render(<Probe projectId="p1" agentId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    first.dropWith()
    // Give a would-be retry room to fire, then assert it did not.
    await new Promise(resolve => setTimeout(resolve, 1200))
    expect(onEvents).toHaveBeenCalledTimes(1)
    expect(screen.getByText('live')).toBeTruthy()
  })

  test('a failed subscribe reports the stream lost and keeps trying', async () => {
    onEvents.mockRejectedValueOnce(new Error('daemon down')).mockResolvedValue(fakeChannel().channel)
    render(<Probe projectId="p1" agentId="run-a" />)
    await waitFor(() => expect(screen.getByText('lost')).toBeTruthy())
    await waitFor(() => expect(screen.getByText('live')).toBeTruthy(), { timeout: 3000 })
  })
})

// A resumed session (#762) appends a second `session` boundary to the SAME journal. An agent's own
// tail (#749) holds nothing but that agent, so its feed must keep everything — slicing at the last
// `session` hid the whole pre-resume transcript for as long as the agent was live. The project-root
// fallback still slices: that subscription genuinely spans run boundaries.
describe('useLiveEvents run scoping', () => {
  const log = (message: string) => ({ kind: 'log', message })

  function FeedProbe({ projectId, agentId: agentId }: { projectId: string | null; agentId?: string | null }) {
    const { events } = useLiveEvents(projectId, agentId)
    return <span data-testid="feed">{events.map(e => (e.kind === 'log' ? e.message : e.kind)).join(',')}</span>
  }
  const feed = () => screen.getByTestId('feed').textContent

  test("a run's own feed keeps the transcript from before a resume's session boundary", async () => {
    const ch = fakeChannel()
    onEvents.mockResolvedValue(ch.channel)
    render(<FeedProbe projectId="p1" agentId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    ch.push(log('a'))
    ch.push({ kind: 'session' })
    ch.push(log('b'))
    await waitFor(() => expect(feed()).toBe('a,session,b'))
  })

  test('the project-root fallback still scopes to the newest session', async () => {
    const ch = fakeChannel()
    onEvents.mockResolvedValue(ch.channel)
    render(<FeedProbe projectId="p1" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    ch.push(log('a'))
    ch.push({ kind: 'session' })
    ch.push(log('b'))
    await waitFor(() => expect(feed()).toBe('session,b'))
  })
})

// #1383: every subscribe replays the whole log before following live. Blanking the feed while
// that replay re-streamed was the mid-run flicker — the lost banner cleared on resubscribe, then
// the feed sat empty until the replay caught up. A reconnect now buffers the replay and swaps
// atomically on the server's stream-sync marker (or a grace deadline for sources that send none).
describe('useLiveEvents reconnect keeps the feed (#1383)', () => {
  const log = (message: string) => ({ kind: 'log', message })

  function FeedProbe({ projectId, agentId: agentId }: { projectId: string | null; agentId?: string | null }) {
    const { events } = useLiveEvents(projectId, agentId)
    return <span data-testid="feed">{events.map(e => (e.kind === 'log' ? e.message : e.kind)).join(',')}</span>
  }
  const feed = () => screen.getByTestId('feed').textContent

  test('the first subscribe streams straight in, and the sync marker is swallowed', async () => {
    const ch = fakeChannel()
    onEvents.mockResolvedValue(ch.channel)
    render(<FeedProbe projectId="p1" agentId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    ch.push(log('a'))
    ch.push({ kind: 'stream-sync' })
    ch.push(log('b'))
    await waitFor(() => expect(feed()).toBe('a,b'))
  })

  test('a reconnect never shows less than it already showed: the replay swaps in atomically', async () => {
    const first = fakeChannel()
    const second = fakeChannel()
    onEvents.mockResolvedValueOnce(first.channel).mockResolvedValue(second.channel)
    render(<FeedProbe projectId="p1" agentId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    first.push(log('a'))
    first.push({ kind: 'stream-sync' })
    first.push(log('b'))
    await waitFor(() => expect(feed()).toBe('a,b'))

    first.dropWith(new Error('connection reset'))
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(2), { timeout: 3000 })
    // The replay is streaming again — but the populated feed stays put until the marker.
    second.push(log('a'))
    second.push(log('b'))
    expect(feed()).toBe('a,b')
    second.push(log('c'))
    second.push({ kind: 'stream-sync' })
    // The swap is atomic: the whole replayed log at once, never a shorter prefix.
    await waitFor(() => expect(feed()).toBe('a,b,c'))
    second.push(log('d'))
    await waitFor(() => expect(feed()).toBe('a,b,c,d'))
  })

  test('a source that sends no marker still swaps at the grace deadline (relay/remote)', async () => {
    const first = fakeChannel()
    const second = fakeChannel()
    onEvents.mockResolvedValueOnce(first.channel).mockResolvedValue(second.channel)
    render(<FeedProbe projectId="p1" agentId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    first.push(log('a'))
    await waitFor(() => expect(feed()).toBe('a'))

    first.dropWith(new Error('connection reset'))
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(2), { timeout: 3000 })
    second.push(log('a'))
    second.push(log('b'))
    expect(feed()).toBe('a')
    // No stream-sync ever arrives: the deadline swap keeps the feed from freezing.
    await waitFor(() => expect(feed()).toBe('a,b'), { timeout: 3000 })
  })

  test('a reconnect that brings nothing by the deadline keeps the feed: an agent being continued has no diary to replay for a moment', async () => {
    const first = fakeChannel()
    const second = fakeChannel()
    onEvents.mockResolvedValueOnce(first.channel).mockResolvedValue(second.channel)
    render(<FeedProbe projectId="p1" agentId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    first.push(log('a'))
    first.push(log('b'))
    await waitFor(() => expect(feed()).toBe('a,b'))

    first.dropWith(new Error('connection reset'))
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(2), { timeout: 3000 })
    // Past the deadline with nothing replayed: the feed is not emptied.
    await new Promise(resolve => setTimeout(resolve, 2000))
    expect(feed()).toBe('a,b')
    // The replay comes late, then the marker: swapped in whole.
    second.push(log('a'))
    second.push(log('b'))
    second.push(log('c'))
    expect(feed()).toBe('a,b')
    second.push({ kind: 'stream-sync' })
    await waitFor(() => expect(feed()).toBe('a,b,c'))
  }, 10_000)

  test('a late replay from a source that sends no marker swaps a deadline after its first event', async () => {
    const first = fakeChannel()
    const second = fakeChannel()
    onEvents.mockResolvedValueOnce(first.channel).mockResolvedValue(second.channel)
    render(<FeedProbe projectId="p1" agentId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    first.push(log('a'))
    await waitFor(() => expect(feed()).toBe('a'))

    first.dropWith(new Error('connection reset'))
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(2), { timeout: 3000 })
    await new Promise(resolve => setTimeout(resolve, 2000))
    second.push(log('a'))
    second.push(log('b'))
    expect(feed()).toBe('a')
    await waitFor(() => expect(feed()).toBe('a,b'), { timeout: 3000 })
  }, 10_000)

  test('a reconnect that dies mid-replay drops the partial buffer rather than swapping it in', async () => {
    const first = fakeChannel()
    const second = fakeChannel()
    const third = fakeChannel()
    onEvents.mockResolvedValueOnce(first.channel).mockResolvedValueOnce(second.channel).mockResolvedValue(third.channel)
    render(<FeedProbe projectId="p1" agentId="run-a" />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    first.push(log('a'))
    first.push(log('b'))
    first.push({ kind: 'stream-sync' })
    await waitFor(() => expect(feed()).toBe('a,b'))

    first.dropWith(new Error('connection reset'))
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(2), { timeout: 3000 })
    second.push(log('a')) // replay cut short
    second.dropWith(new Error('gone again'))
    // The populated feed survives both drops; the third attempt replays and syncs in full.
    expect(feed()).toBe('a,b')
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(3), { timeout: 4000 })
    third.push(log('a'))
    third.push(log('b'))
    third.push(log('c'))
    third.push({ kind: 'stream-sync' })
    await waitFor(() => expect(feed()).toBe('a,b,c'))
  })
})

// The message the agent is writing streams in as the text so far, beside the feed and never in it.
describe('useLiveEvents message being written', () => {
  function Writing() {
    const { events, writing } = useLiveEvents('p1', 'run-a')
    return (
      <span>
        {events.length} events, writing: [{writing}]
      </span>
    )
  }
  const said = (text: string) => ({ kind: 'driver', event: { type: 'text', text } })

  test('shows the text so far, replaces it with the whole message, and ignores its pieces read a beat late', async () => {
    const ch = fakeChannel()
    onEvents.mockResolvedValue(ch.channel)
    render(<Writing />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    ch.push({ kind: 'partial', text: 'Rivers car' })
    await waitFor(() => expect(screen.getByText('0 events, writing: [Rivers car]')).toBeTruthy())
    ch.push(said('Rivers carve valleys.'))
    await waitFor(() => expect(screen.getByText('1 events, writing: []')).toBeTruthy())
    // The live file read after the diary line, before the file was removed: not shown twice.
    ch.push({ kind: 'partial', text: 'Rivers carve valleys.' })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(screen.getByText('1 events, writing: []')).toBeTruthy()
    ch.push({ kind: 'partial', text: '' })
    ch.push({ kind: 'partial', text: 'Next' })
    await waitFor(() => expect(screen.getByText('1 events, writing: [Next]')).toBeTruthy())
  })

  test('a run that ends writes nothing more', async () => {
    const ch = fakeChannel()
    onEvents.mockResolvedValue(ch.channel)
    render(<Writing />)
    await waitFor(() => expect(onEvents).toHaveBeenCalledTimes(1))
    ch.push({ kind: 'partial', text: 'Half a' })
    await waitFor(() => expect(screen.getByText('0 events, writing: [Half a]')).toBeTruthy())
    ch.push({ kind: 'end', ok: false, stopped: true })
    await waitFor(() => expect(screen.getByText('1 events, writing: []')).toBeTruthy())
  })
})
