import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { openMenu } from '../test-utils.js'

const MACBOOK = { id: 'http://127.0.0.1:4210', url: 'http://127.0.0.1:4210', label: 'Suleimans-MacBook-Pro' }
vi.mock('../lib/machines.js', () => ({ useMachines: () => [MACBOOK] }))

const { ProjectSelect } = await import('./ProjectSelect.js')

afterEach(cleanup)

describe('the project pick', () => {
  test("another computer's project says which computer it is on, by that computer's name; one of this computer's says nothing of it", async () => {
    const own = { id: 'gemstack-1', path: '/home/me/gemstack', name: 'gemstack', activated: true, gitHost: true }
    const there = { id: 'test-project-2~abc', path: '/Users/me/test-project', name: 'test-project', activated: true, gitHost: true, machine: MACBOOK.id }
    render(<ProjectSelect projects={[own, there]} scope={null} onScope={() => {}} />)
    await openMenu(screen.getByRole('button', { name: 'Project: All projects' }))
    const line = within(screen.getByRole('menuitem', { name: /test-project/ })).getByText('on Suleimans-MacBook-Pro')
    expect(line.parentElement!.className).toContain('text-muted-foreground')
    expect(within(screen.getByRole('menuitem', { name: /gemstack/ })).queryByText(/^on /)).toBeNull()
  })
})
