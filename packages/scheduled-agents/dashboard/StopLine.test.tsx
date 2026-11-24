import { useState } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ModuleHostContext, forgetRemembered, type ModuleHost, type UiActionResult, type UiProject } from '@openagt/ui/module'
import { StopLine } from './StopLine.js'
import { STATUS, hostAnswering } from './fixtures.js'

const GEMSTACK = { id: 'p1', name: 'gemstack', remote: 'github.com/me/project' }
const OTHER = { id: 'p2', name: 'other' }

/** The usage bar, stood in: where its handle rests, the handle as a button that moves it to 12, and what the save answered. */
function Bar({ offset, onChangeOffset }: { offset?: number; onChangeOffset?: (points: number) => Promise<UiActionResult> }) {
  const [answer, setAnswer] = useState<UiActionResult | undefined>()
  return (
    <p>
      {offset === undefined ? 'no handle' : `handle at ${offset}`}
      {onChangeOffset && <button onClick={() => void onChangeOffset(12).then(setAnswer)}>move</button>}
      {answer && !answer.ok && <span role="alert">{answer.error}</span>}
    </p>
  )
}

function show(host: ModuleHost, projects: UiProject[] = [GEMSTACK, OTHER]) {
  return render(
    <ModuleHostContext.Provider value={host}>
      <StopLine projects={projects} Bar={Bar} />
    </ModuleHostContext.Provider>,
  )
}

afterEach(() => {
  cleanup()
  forgetRemembered()
  localStorage.clear()
})

describe("the scheduler's stop line on the usage bar", () => {
  test('the handle rests at the loosest offset the projects keep, and a move saves it in every project', async () => {
    const { host, runCommand } = hostAnswering((projectId, args) => (args[0] === 'status' ? { ok: true, output: { ...STATUS, spendOffset: projectId === 'p1' ? 7 : -3 } } : { ok: true, output: { ok: true } }))
    show(host)
    expect(await screen.findByText('handle at 7')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'move' }))
    await waitFor(() => expect(runCommand).toHaveBeenCalledWith('p2', ['offset', '--', '12']))
    expect(runCommand).toHaveBeenCalledWith('p1', ['offset', '--', '12'])
  })

  test('with no project that keeps an offset, the bar has no handle', async () => {
    const { host, call } = hostAnswering(() => ({ ok: true, output: { ...STATUS, spendOffset: undefined } }))
    show(host)
    await waitFor(() => expect(call).toHaveBeenCalledTimes(2))
    expect(screen.getByText('no handle')).toBeTruthy()
  })

  test('a save that fails answers why, naming the project, for the bar to say', async () => {
    const { host } = hostAnswering((projectId, args) => (args[0] === 'status' ? { ok: true, output: STATUS } : projectId === 'p2' ? { ok: false, error: 'exit 2' } : { ok: true, output: { ok: true } }))
    show(host)
    fireEvent.click(await screen.findByRole('button', { name: 'move' }))
    expect((await screen.findByRole('alert')).textContent).toBe('other: exit 2')
  })
})
