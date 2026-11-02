import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ModuleHostContext, type ModuleCommandResult, type ModuleHost } from '@openagt/dashboard/module'
import { AskPopup } from './Pairing.js'

// The popup over every page: a computer on this Wi-Fi asks to connect.

const ok = (output: unknown): ModuleCommandResult => ({ ok: true, output })
const ASK = { id: 'a1b2c3d4e5f6', name: "Ada's MacBook", number: '482913', expires: new Date(Date.now() + 120_000).toISOString() }

/** A host whose `devices asks` answers `asks` at once the first time, and then waits until `change` is called. */
function host(first: object[]) {
  let asks = first
  let changed: (() => void) | undefined
  const runComputerCommand = vi.fn(async (args: string[]): Promise<ModuleCommandResult> => {
    if (args[0] === 'asks') {
      if (args.includes('--wait')) await new Promise<void>(resolve => (changed = resolve))
      return ok({ asks })
    }
    if (args[0] === 'allow' || args[0] === 'deny') {
      asks = []
      return ok({ asks })
    }
    return { ok: false, error: 'not here' }
  })
  return {
    // A whole host: one with no runCommand would be taken for the shell's services, and bound to the real calls.
    host: { package: '@openagt/dashboard-devices', runCommand: vi.fn(), runComputerCommand } as unknown as ModuleHost,
    runComputerCommand,
    change(next: object[]) {
      asks = next
      changed?.()
    },
  }
}

const show = (h: ModuleHost) =>
  render(
    <ModuleHostContext.Provider value={h}>
      <AskPopup />
    </ModuleHostContext.Provider>,
  )

afterEach(cleanup)

describe('A computer wants to connect', () => {
  test('nothing is drawn while nobody asks; an ask that comes shows with its number, and Allow lets it in', async () => {
    const h = host([])
    show(h.host)
    await waitFor(() => expect(h.runComputerCommand).toHaveBeenCalledWith(['asks', '--wait', '25', '--seen', '']))
    expect(screen.queryByRole('dialog')).toBeNull()
    h.change([ASK])
    expect(await screen.findByText(/asks to start runs on this computer/)).toBeTruthy()
    expect(screen.getByText("Ada's MacBook")).toBeTruthy()
    expect(screen.getByLabelText('The number').textContent).toBe('482 913')
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(h.runComputerCommand).toHaveBeenCalledWith(['allow', ASK.id]))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('Deny says no; an ask answered elsewhere or run out goes from the page by itself', async () => {
    const h = host([ASK])
    show(h.host)
    fireEvent.click(await screen.findByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(h.runComputerCommand).toHaveBeenCalledWith(['deny', ASK.id]))
    cleanup()

    const other = host([ASK])
    show(other.host)
    await screen.findByLabelText('The number')
    await waitFor(() => expect(other.runComputerCommand).toHaveBeenCalledWith(['asks', '--wait', '25', '--seen', ASK.id]))
    other.change([])
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

  test('a read that failed is tried again later, and draws nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const runComputerCommand = vi.fn(async (): Promise<ModuleCommandResult> => ({ ok: false, error: 'devices has no command asks' }))
      show({ package: '@openagt/dashboard-devices', runCommand: vi.fn(), runComputerCommand } as unknown as ModuleHost)
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
})
