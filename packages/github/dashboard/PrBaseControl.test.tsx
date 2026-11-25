import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { forgetRemembered, type ModuleCallResult, type UiComposerControlProps, type UiControlSaid } from '@openagt/ui/module'
import { GearMenu, fakeHost, gear, openMenu, openSetupLine, renderWithHost, setupLine } from '@openagt/ui/module/testing'
import type { RunOptions } from '@openagt/hooks'
import { PrBaseControl } from './PrBaseControl.js'

// The branch a run's pull request goes into, a line of the gear's menu under the message box, its
// module's calls as a test answers them: `prTarget` says the main branch, and the branch the run
// starts from (git-branches' pick) where origin has it.

let target: { main?: string; start?: string } = {}
const call = vi.fn(async (_projectId: string, name: string): Promise<ModuleCallResult> => (name === 'prTarget' ? { ok: true, output: target } : { ok: false, error: `no ${name} here` }))
const host = fakeHost('@openagt/github', { call })

afterEach(() => {
  cleanup()
  forgetRemembered()
  call.mockClear()
})

/** The control in the gear of a box that keeps the options it picks, as the launcher does; what it says is kept in `told`. */
function draw(over: Partial<UiComposerControlProps> = {}, start: RunOptions = {}) {
  const told: { said?: UiControlSaid | undefined; options: RunOptions } = { options: start }
  function Box() {
    const [options, setOptions] = useState<RunOptions>(start)
    told.options = options
    const props: UiComposerControlProps = { in: 'launcher', projectId: 'p1', options, onChange: setOptions, busy: false, say: said => void (told.said = said), ...over }
    return <GearMenu lines={<PrBaseControl {...props} />} />
  }
  renderWithHost(<Box />, host)
  return told
}

/** No line in the gear's open menu, once the target is read. */
async function noLine() {
  await openMenu(gear())
  await waitFor(() => expect(call).toHaveBeenCalled())
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(screen.queryAllByRole('menuitem')).toEqual([])
}

describe("the launcher's pull request base", () => {
  test('a run started from a branch origin has opens its request into that branch, which goes with the Start; the main branch picked instead sends none and reads so', async () => {
    target = { main: 'main', start: 'feature-x' }
    const told = draw()
    expect((await openSetupLine('Pull request into')).textContent).toBe('Pull request into: feature-x')
    expect(told.options).toEqual({ github: { prBase: 'feature-x' } })
    expect(told.said).toEqual({ words: 'PR into feature-x' })
    expect(screen.getByText('The branch its pull request goes into')).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'main' }))
    await waitFor(() => expect(told.options).toEqual({}))
    expect((await setupLine('Pull request into')).textContent).toBe('Pull request into: main')
    expect(told.said).toEqual({ words: 'PR into main' })
  })

  test("the main branch picked to start from, or a local branch origin does not have: no line, nothing sent, and the request goes into the repository's default branch", async () => {
    target = { main: 'main' }
    const told = draw({}, { github: { prBase: 'old' }, skills: { project: 'none' } })
    await noLine()
    await waitFor(() => expect(told.options).toEqual({ skills: { project: 'none' } }))
    expect(told.said).toBeUndefined()
  })
})

describe('elsewhere', () => {
  test("a session's line says the branch its record keeps, and opens no list; one into the default branch says nothing", async () => {
    const told = draw({ in: 'session', agentId: 'r1', options: { github: { prBase: 'feature-x' } } })
    const line = await setupLine('Pull request into')
    expect(line.textContent).toBe("Pull request into: feature-x. This run's pull request goes into feature-x")
    expect(line.getAttribute('aria-haspopup')).toBeNull()
    expect(told.said).toEqual({ words: 'PR into feature-x' })
    cleanup()
    draw({ in: 'session', agentId: 'r1', options: {} })
    await openMenu(gear())
    expect(screen.queryAllByRole('menuitem')).toEqual([])
    expect(call).not.toHaveBeenCalled()
  })

  test("a profile's editor, for any project, has no line", async () => {
    draw({ in: 'profile' })
    await openMenu(gear())
    expect(screen.queryAllByRole('menuitem')).toEqual([])
    expect(call).not.toHaveBeenCalled()
  })
})
