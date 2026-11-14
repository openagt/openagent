import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const onAgentWorktree = vi.fn(async (..._args: unknown[]) => null as unknown)
vi.mock('../rpc/reads.js', () => ({ onAgentWorktree }))

const { useCheckoutStatus } = await import('./use-checkout-status.js')

function Probe({ agentId, turn }: { agentId: string; turn?: boolean }) {
  const checkout = useCheckoutStatus('p1', agentId, turn)
  return <div data-testid="branch">{checkout?.branch ?? 'none'}</div>
}
const branch = () => screen.getByTestId('branch').textContent

beforeEach(() => {
  onAgentWorktree.mockReset()
})
afterEach(cleanup)

describe('useCheckoutStatus', () => {
  test("it reads the agent's checkout, and nothing until the answer is in", async () => {
    onAgentWorktree.mockResolvedValue({ branch: 'agent-run-1' })
    render(<Probe agentId="run-1" />)
    expect(branch()).toBe('none')
    await waitFor(() => expect(branch()).toBe('agent-run-1'))
    expect(onAgentWorktree).toHaveBeenCalledWith('p1', 'run-1')
  })

  test("switching agents never gives the previous agent's answer; going back gives its own at once", async () => {
    onAgentWorktree.mockImplementation(async (_p: unknown, id: unknown) => ({ branch: `agent-${id}` }))
    const { rerender } = render(<Probe agentId="run-a" />)
    await waitFor(() => expect(branch()).toBe('agent-run-a'))
    onAgentWorktree.mockImplementation(() => new Promise(() => {}))
    rerender(<Probe agentId="run-b" />)
    expect(branch()).toBe('none') // run-a's answer, not given as run-b's
    rerender(<Probe agentId="run-a" />)
    expect(branch()).toBe('agent-run-a') // remembered, from the first frame
  })

  test('it is read again at once when the turn starts or ends, not on the first render', async () => {
    onAgentWorktree.mockResolvedValue({ branch: 'agent-run-t' })
    const { rerender } = render(<Probe agentId="run-t" turn />)
    await waitFor(() => expect(branch()).toBe('agent-run-t'))
    expect(onAgentWorktree).toHaveBeenCalledTimes(1)
    rerender(<Probe agentId="run-t" turn />)
    expect(onAgentWorktree).toHaveBeenCalledTimes(1)
    rerender(<Probe agentId="run-t" turn={false} />)
    await waitFor(() => expect(onAgentWorktree).toHaveBeenCalledTimes(2))
  })

  test('a turn that ends is asked about once, however its pace changes with it, and its answer stays shown', async () => {
    onAgentWorktree.mockResolvedValue({ branch: 'agent-run-o' })
    const { rerender } = render(<Probe agentId="run-o" turn />)
    await waitFor(() => expect(branch()).toBe('agent-run-o'))
    vi.useFakeTimers()
    try {
      let answer!: (value: unknown) => void
      onAgentWorktree.mockImplementation(() => new Promise(resolve => (answer = resolve)))
      rerender(<Probe agentId="run-o" turn={false} />)
      await vi.advanceTimersByTimeAsync(500)
      expect(onAgentWorktree).toHaveBeenCalledTimes(2)
      expect(branch()).toBe('agent-run-o')
      answer({ branch: 'agent-run-o2' })
      await vi.advanceTimersByTimeAsync(0)
      expect(branch()).toBe('agent-run-o2')
    } finally {
      vi.useRealTimers()
    }
  })

  test('after a turn ends it is read every second for a while, then at rest again', async () => {
    onAgentWorktree.mockResolvedValue({ branch: 'agent-run-s' })
    const { rerender } = render(<Probe agentId="run-s" turn />)
    await waitFor(() => expect(branch()).toBe('agent-run-s'))
    vi.useFakeTimers()
    try {
      rerender(<Probe agentId="run-s" turn={false} />)
      await vi.advanceTimersByTimeAsync(10)
      const atEnd = onAgentWorktree.mock.calls.length
      // Every second, not every ten.
      await vi.advanceTimersByTimeAsync(3_000)
      expect(onAgentWorktree.mock.calls.length - atEnd).toBeGreaterThanOrEqual(3)
      // The while over, back to every ten seconds.
      await vi.advanceTimersByTimeAsync(10_000)
      const rested = onAgentWorktree.mock.calls.length
      await vi.advanceTimersByTimeAsync(5_000)
      expect(onAgentWorktree.mock.calls.length).toBe(rested)
    } finally {
      vi.useRealTimers()
    }
  })
})
