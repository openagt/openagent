import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { forgetRemembered, type ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { CopyRepos } from './CopyRepos.js'

// The session's copies of repos in its Activity panel's Environment (`chat.environment`).

const call = vi.fn(async (_projectId: string, name: string): Promise<ModuleCallResult> =>
  name === 'repos' ? { ok: true, output: [{ name: 'oa-newuser', address: 'github.com/suleimansh/oa-newuser' }, { name: 'notes' }] } : { ok: false, error: `no ${name} here` },
)
const host = fakeHost('@openagt/git-branches', { call: call as never })

afterEach(() => {
  cleanup()
  forgetRemembered()
})

test('each copy by the repository it is a copy of, as Claude Code names a repo; one with no remote by its name', async () => {
  renderWithHost(<CopyRepos projectId="p1" agentId="r1" working={false} />, host)
  await waitFor(() => expect(screen.getByText('suleimansh/oa-newuser')).toBeTruthy())
  expect(screen.getByText('notes')).toBeTruthy()
  expect(call).toHaveBeenCalledWith('p1', 'repos', { agentId: 'r1' })
})
