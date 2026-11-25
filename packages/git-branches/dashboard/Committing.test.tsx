import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { Committing } from './Committing.js'

// What the project's row says while the agent commits on the Commit press's ask (while the run works).

let asked = true
const call = vi.fn(async (_projectId: string, name: string): Promise<ModuleCallResult> => (name === 'committing' ? { ok: true, output: asked } : { ok: false, error: `no ${name} here` }))
const host = fakeHost('@openagt/git-branches', { call })

afterEach(() => {
  cleanup()
  forgetRemembered()
  call.mockClear()
})

test('says "Committing…" while the run works on the ask; nothing for a run working on anything else, or one that ended', async () => {
  const { rerender } = renderWithHost(<Committing projectId="p" agentId="run1" working />, host)
  await waitFor(() => expect(screen.getByText('Committing…')).toBeTruthy())
  rerender(<Committing projectId="p" agentId="run1" working={false} />)
  expect(screen.queryByText('Committing…')).toBeNull()
  asked = false
  cleanup()
  renderWithHost(<Committing projectId="p" agentId="run2" working />, host)
  await waitFor(() => expect(call).toHaveBeenCalledWith('p', 'committing', { agentId: 'run2' }))
  expect(screen.queryByText('Committing…')).toBeNull()
})
