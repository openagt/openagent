import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ModuleHostContext, type ModuleCommandResult, type ModuleHost } from '@openagt/ui/module'
import { OpenAgentDown, fakeHost } from '@openagt/ui/module/testing'
import { AskPopup } from './Pairing.js'

// The popup over every page: a computer on this Wi-Fi asks to connect.

const ok = (output: unknown): ModuleCommandResult => ({ ok: true, output })
const ASK = { id: 'a1b2c3d4e5f6', name: "Ada's MacBook", number: '482913', expires: new Date(Date.now() + 120_000).toISOString() }

/** A host whose `devices asks` answers the asks of now, at once. */
function host(first: object[]) {
  let asks = first
  const runComputerCommand = vi.fn(async (args: string[]): Promise<ModuleCommandResult> => {
    if (args[0] === 'asks') return ok({ asks })
    if (args[0] === 'allow' || args[0] === 'deny') {
      asks = []
      return ok({ asks })
    }
    return { ok: false, error: 'not here' }
  })
  return {
    // A whole host: one with no runCommand would be taken for the shell's services, and bound to the real calls.
    host: fakeHost('@openagt/devices', { runComputerCommand }),
    runComputerCommand,
    change(next: object[]) {
      asks = next
    },
    reads: () => runComputerCommand.mock.calls.filter(([args]) => args[0] === 'asks').length,
  }
}

const show = (h: ModuleHost) =>
  render(
    <ModuleHostContext.Provider value={h}>
      <AskPopup />
    </ModuleHostContext.Provider>,
  )

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('A computer wants to connect', () => {
  test('nothing is drawn while nobody asks; an ask that comes shows with its number, and Allow lets it in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const h = host([])
    show(h.host)
    await waitFor(() => expect(h.runComputerCommand).toHaveBeenCalledWith(['asks']))
    expect(screen.queryByRole('dialog')).toBeNull()
    h.change([ASK])
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await screen.findByText(/asks to start runs on this computer/)).toBeTruthy()
    expect(screen.getByText("Ada's MacBook")).toBeTruthy()
    expect(screen.getByLabelText('The number').textContent).toBe('482 913')
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(h.runComputerCommand).toHaveBeenCalledWith(['allow', ASK.id]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('the keyboard starts on Deny: Enter at once lets nothing in', async () => {
    const h = host([ASK])
    show(h.host)
    const deny = await screen.findByRole('button', { name: 'Deny' })
    await waitFor(() => expect(document.activeElement).toBe(deny))
  })

  test('Deny says no; an ask answered elsewhere or run out goes from the page by itself', async () => {
    const h = host([ASK])
    show(h.host)
    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(h.runComputerCommand).toHaveBeenCalledWith(['deny', ASK.id]))
    cleanup()

    vi.useFakeTimers({ shouldAdvanceTime: true })
    const other = host([ASK])
    show(other.host)
    await screen.findByLabelText('The number')
    other.change([])
    await vi.advanceTimersByTimeAsync(5_000)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('closed on this page, the ask stays for another device to answer; the next one shows', async () => {
    const h = host([ASK, { ...ASK, id: 'ffffffffffff', name: 'Studio Mac', number: '111222' }])
    show(h.host)
    await screen.findByText("Ada's MacBook")
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(await screen.findByText('Studio Mac')).toBeTruthy()
    expect(h.runComputerCommand).not.toHaveBeenCalledWith(['deny', ASK.id])
  })

  test('while OpenAgent is not answering, Allow and Deny are off and send nothing; the popup still closes', async () => {
    const h = host([ASK])
    render(
      <OpenAgentDown>
        <ModuleHostContext.Provider value={h.host}>
          <AskPopup />
        </ModuleHostContext.Provider>
      </OpenAgentDown>,
    )
    const deny = (await screen.findByRole('button', { name: 'Deny' })) as HTMLButtonElement
    const allow = screen.getByRole('button', { name: 'Allow' }) as HTMLButtonElement
    expect([deny.disabled, allow.disabled]).toEqual([true, true])
    fireEvent.click(deny)
    fireEvent.click(allow)
    expect(h.runComputerCommand.mock.calls.map(([args]) => args[0])).not.toContain('deny')
    expect(h.runComputerCommand.mock.calls.map(([args]) => args[0])).not.toContain('allow')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('a read that failed is tried again later, and draws nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const runComputerCommand = vi.fn(async (): Promise<ModuleCommandResult> => ({ ok: false, error: 'devices has no command asks' }))
      show(fakeHost('@openagt/devices', { runComputerCommand }))
      await waitFor(() => expect(runComputerCommand).toHaveBeenCalledTimes(1))
      await vi.advanceTimersByTimeAsync(29_000)
      expect(runComputerCommand).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(runComputerCommand).toHaveBeenCalledTimes(2)
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('a page out of sight asks nothing, and reads at once when it is back in sight', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    try {
      const h = host([ASK])
      show(h.host)
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(h.runComputerCommand).not.toHaveBeenCalled()
      hidden.mockReturnValue(false)
      document.dispatchEvent(new Event('visibilitychange'))
      expect(await screen.findByText("Ada's MacBook")).toBeTruthy()
      expect(h.runComputerCommand).toHaveBeenNthCalledWith(1, ['asks'])
    } finally {
      hidden.mockRestore()
    }
  })

  test('no read waits; a page that goes out of sight stops reading, and a popup that is gone reads no more', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    try {
      const h = host([])
      show(h.host)
      await waitFor(() => expect(h.reads()).toBe(1))
      expect(h.runComputerCommand).toHaveBeenNthCalledWith(1, ['asks'])
      await vi.advanceTimersByTimeAsync(5_000)
      expect(h.reads()).toBe(2)

      hidden.mockReturnValue(true)
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(h.reads()).toBe(2)
      hidden.mockReturnValue(false)
      document.dispatchEvent(new Event('visibilitychange'))
      await waitFor(() => expect(h.reads()).toBe(3))

      cleanup()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(h.reads()).toBe(3)
    } finally {
      hidden.mockRestore()
    }
  })
})
