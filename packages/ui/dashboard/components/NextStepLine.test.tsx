import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ModulesContext, mountedOf, type MountedView } from '../lib/use-modules.js'
import type { UiWorkProps } from '../module/index.js'
import { WorkRow } from './WorkRow.js'

const { NextStepLine } = await import('./NextStepLine.js')

// The line above the message box: the first repo with a step waiting, with that step's press.

const work: UiWorkProps = { projectId: 'p1', agentId: 'r1', working: false, ended: true, saving: false }

/** The repos' rows as the modules draw them: each with its next step's press, or with none. */
let steps: Record<string, string | undefined> = {}
const Rows = () => (
  <>
    {Object.entries(steps).map(([name, step]) => (
      <WorkRow key={name} name={name} branch="b" actions={step ? <button type="button" data-next-step>{step}</button> : undefined} />
    ))}
  </>
)
const rows: MountedView<'chat.work'> = { place: 'chat.work', id: 'rows', View: Rows, package: '@openagt/git-branches', projects: ['p1'] }
const draw = (props: UiWorkProps = work) => (
  <ModulesContext.Provider value={mountedOf({ views: { 'chat.work': [rows] } })}>
    <NextStepLine work={props} />
  </ModulesContext.Provider>
)

const line = () => screen.getByRole('group', { name: 'Next step', hidden: true }).parentElement!
const shownRows = () => [...line().querySelectorAll<HTMLElement>('[data-work-row]')].filter(row => !row.hidden).map(row => row.getAttribute('aria-label'))

beforeEach(() => localStorage.clear())
afterEach(cleanup)

describe('the line above the message box', () => {
  test('shows the first repo with a step waiting, and that step alone; "N more" says how many others wait', () => {
    steps = { 'test-project': undefined, 'oa-newuser': 'Commit', 'recipe-box': 'Open PR' }
    render(draw())
    expect(line().hidden).toBe(false)
    expect(shownRows()).toEqual(['oa-newuser: its work'])
    expect(screen.getByRole('button', { name: '1 more' })).toBeTruthy()
  })

  test('with no step waiting there is no line', () => {
    steps = { 'test-project': undefined }
    render(draw())
    expect(line().hidden).toBe(true)
  })

  test('its ✕ hides it, and this browser keeps that for the session; the next step waiting brings it back', () => {
    steps = { 'oa-newuser': 'Commit' }
    render(draw())
    fireEvent.click(screen.getByRole('button', { name: 'Hide until the next step' }))
    expect(line().hidden).toBe(true)
    // Back on the session later: still hidden.
    cleanup()
    render(draw())
    expect(line().hidden).toBe(true)
    // Another session's line is its own.
    cleanup()
    render(draw({ ...work, agentId: 'r2' }))
    expect(line().hidden).toBe(false)
    cleanup()
    // The commit made, the next step is another: the line is back.
    steps = { 'oa-newuser': 'Open PR' }
    render(draw())
    expect(line().hidden).toBe(false)
  })

  test('a step that comes after the line was drawn is read as it comes', async () => {
    steps = { 'oa-newuser': undefined }
    const { rerender } = render(draw())
    expect(line().hidden).toBe(true)
    steps = { 'oa-newuser': 'Commit' }
    await act(async () => rerender(draw({ ...work, saving: true })))
    expect(line().hidden).toBe(false)
  })
})
