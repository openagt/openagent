import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CommandsMenu } from './CommandsMenu.js'

afterEach(cleanup)

const commands = [
  { name: 'work-queue', description: 'Work the agent queue' },
  { name: 'ux' },
]
// The saved prompts a module offers, each group of them a part of the menu.
const mine = { id: 'person:c1', label: 'My sweep', text: 'sweep it', group: 'Your saved prompts', package: '@openagt/saved-prompts' }
const team = { id: 'project:p1', label: 'Team sweep', text: 'team it', group: 'Project saved prompts', package: '@openagt/saved-prompts' }

function mount(over: Partial<Parameters<typeof CommandsMenu>[0]> = {}) {
  const onLoad = vi.fn()
  const onNew = vi.fn()
  const onDelete = vi.fn()
  render(<CommandsMenu commands={commands} prompts={[mine, team]} busy={false} onLoad={onLoad} onNew={onNew} onDelete={onDelete} {...over} />)
  fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
  return { onLoad, onNew, onDelete }
}

// #948: commands used to load only behind typing `/`, and delete lived in the options gear.
describe('CommandsMenu', () => {
  test('lists the project\'s commands, and one loads as its slash line for an argument to follow', () => {
    const { onLoad } = mount()
    expect(screen.getByText('/ux')).toBeTruthy()
    fireEvent.click(screen.getByText('/work-queue'))
    expect(onLoad).toHaveBeenCalledWith('/work-queue ', '/work-queue')
  })

  test('a command whose skill has not reached the branch agents start from says so, and cannot be picked', () => {
    const { onLoad } = mount({ commands: [{ name: 'plan', waiting: 'main' }, { name: 'ux' }] })
    expect(screen.getByText('waiting to reach main')).toBeTruthy()
    fireEvent.click(screen.getByText('/plan'))
    expect(onLoad).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('/ux'))
    expect(onLoad).toHaveBeenCalledWith('/ux ', '/ux')
  })

  test('a project with no commands says so', () => {
    mount({ commands: [] })
    expect(screen.getByText('This project has no commands.')).toBeTruthy()
  })

  test('a saved prompt loads verbatim, each listed under whose it is (#626, #1025)', () => {
    const { onLoad } = mount()
    expect(screen.getAllByRole('group').map(group => group.textContent)).toEqual(['Commands/work-queue/ux', 'Your saved promptsMy sweep', 'Project saved promptsTeam sweep'])
    fireEvent.click(screen.getByText('My sweep'))
    expect(onLoad).toHaveBeenCalledWith('sweep it', 'My sweep')
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
    fireEvent.click(screen.getByText('Team sweep'))
    expect(onLoad).toHaveBeenLastCalledWith('team it', 'Team sweep')
  })

  test('the delete button deletes without loading', () => {
    const { onLoad, onDelete } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Delete saved prompt Team sweep' }))
    expect(onDelete).toHaveBeenCalledWith(team)
    expect(onLoad).not.toHaveBeenCalled()
  })

  test('the Delete key on a highlighted saved prompt deletes it without loading it', () => {
    const { onLoad, onDelete } = mount()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /^My sweep/ }), { key: 'Delete' })
    expect(onDelete).toHaveBeenCalledWith(mine)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /^Team sweep/ }), { key: 'Backspace' })
    expect(onDelete).toHaveBeenLastCalledWith(team)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /^My sweep/ }), { key: 'a' })
    expect(onDelete).toHaveBeenCalledTimes(2)
    expect(onLoad).not.toHaveBeenCalled()
  })

  test('with no saved prompt, the menu has no part for them', () => {
    mount({ prompts: [] })
    expect(screen.queryByText('Your saved prompts')).toBeNull()
    expect(screen.queryByText('Project saved prompts')).toBeNull()
  })

  test('"Save prompt…" opens the panel that saves what the box holds', () => {
    const { onNew } = mount()
    fireEvent.click(screen.getByText('Save prompt…'))
    expect(onNew).toHaveBeenCalled()
  })

  test('no create item where no panel exists', () => {
    mount({ onNew: undefined })
    expect(screen.queryByText('Save prompt…')).toBeNull()
  })
})
