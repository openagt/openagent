import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CommandsMenu } from './CommandsMenu.js'

afterEach(cleanup)

const commands = [
  { name: 'work-queue', description: 'Work the agent queue' },
  { name: 'ux' },
]
const custom = [{ id: 'c1', label: 'My sweep', prompt: 'sweep it' }]
const project = [{ id: 'p1', label: 'Team sweep', prompt: 'team it' }]

function mount(over: Partial<Parameters<typeof CommandsMenu>[0]> = {}) {
  const onLoad = vi.fn()
  const onNew = vi.fn()
  const onDelete = vi.fn()
  const onDeleteProject = vi.fn()
  render(
    <CommandsMenu
      commands={commands}
      customPresets={custom}
      projectPresets={project}
      busy={false}
      onLoad={onLoad}
      onNew={onNew}
      onDelete={onDelete}
      onDeleteProject={onDeleteProject}
      {...over}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
  return { onLoad, onNew, onDelete, onDeleteProject }
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

  test('a saved prompt loads verbatim', () => {
    const { onLoad } = mount()
    fireEvent.click(screen.getByText('My sweep'))
    expect(onLoad).toHaveBeenCalledWith('sweep it', 'My sweep')
  })

  test('the delete button deletes without loading', () => {
    const { onLoad, onDelete } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Delete saved prompt My sweep' }))
    expect(onDelete).toHaveBeenCalledWith('c1')
    expect(onLoad).not.toHaveBeenCalled()
  })

  test('a shared project saved prompt loads verbatim (#1025)', () => {
    const { onLoad } = mount()
    fireEvent.click(screen.getByText('Team sweep'))
    expect(onLoad).toHaveBeenCalledWith('team it', 'Team sweep')
  })

  test('a project saved prompt deletes via its own handler (#1025)', () => {
    const { onDeleteProject, onDelete } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Delete saved prompt Team sweep' }))
    expect(onDeleteProject).toHaveBeenCalledWith('p1')
    expect(onDelete).not.toHaveBeenCalled()
  })

  test('the Project saved prompts group is hidden when there are none (#1025)', () => {
    mount({ projectPresets: [] })
    expect(screen.queryByText('Project saved prompts')).toBeNull()
  })

  test('"Save prompt…" opens the create panel', () => {
    const { onNew } = mount()
    fireEvent.click(screen.getByText('Save prompt…'))
    expect(onNew).toHaveBeenCalled()
  })

  test('no create item where no panel exists', () => {
    mount({ onNew: undefined })
    expect(screen.queryByText('Save prompt…')).toBeNull()
  })
})
