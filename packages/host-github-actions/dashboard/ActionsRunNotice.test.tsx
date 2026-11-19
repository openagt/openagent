import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { ActionsRunNotice } from './ActionsRunNotice.js'

// The strip above the chat of a run on GitHub Actions, its Actions run as the module's server part answers it.

afterEach(cleanup)

const RUN = { projectId: 'shop', agentId: '2026-11-19T10-00-00-000Z' }

function shown(working: boolean, answer: ModuleCallResult) {
  const call = vi.fn(async (): Promise<ModuleCallResult> => answer)
  renderWithHost(<ActionsRunNotice {...RUN} working={working} host="actions" />, fakeHost('@openagt/host-github-actions', { call }))
  return call
}

describe('the strip of a run on GitHub Actions', () => {
  test('while it works, it says its chat comes when its turn ends, and links to the Actions run once GitHub made it (#2394)', async () => {
    const call = shown(true, { ok: true, output: { address: 'https://github.com/o/r/actions/runs/77' } })
    expect(screen.getByRole('status').textContent).toContain('Running on GitHub Actions: what it does comes when its turn ends.')
    const link = await screen.findByRole('link', { name: 'View the Actions run' })
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/actions/runs/77')
    expect(call).toHaveBeenCalledWith('shop', 'run', { agentId: RUN.agentId })
  })

  test('once it has ended it says where it ran; with no Actions run known, there is no link (#2394)', async () => {
    const call = shown(false, { ok: true, output: {} })
    expect(screen.getByRole('status').textContent).toContain('Ran on GitHub Actions.')
    await vi.waitFor(() => expect(call).toHaveBeenCalled())
    expect(screen.queryByRole('link')).toBeNull()
  })
})

test("a run of another host has no strip of this module's (#2394)", () => {
  const { container } = render(<ActionsRunNotice {...RUN} working={true} />)
  expect(container.innerHTML).toBe('')
  render(<ActionsRunNotice {...RUN} working={true} host="web" />)
  expect(container.innerHTML).toBe('')
})
