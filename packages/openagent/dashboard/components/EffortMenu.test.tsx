import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { openMenu } from '../test-utils.js'
import { EffortMenu, effortLabel } from './EffortMenu.js'

afterEach(cleanup)

// How hard the model may think, beside the model: the levels are the agent's own, so this control
// invents none of them and is not there at all for a model that offers none.
describe('the effort menu', () => {
  test('a model that offers no level has no control', () => {
    const { container } = render(<EffortMenu efforts={[]} onChange={() => {}} />)
    expect(container.textContent).toBe('')
  })

  test("it lists the model's own levels, with the agent's default above them, and says which is picked", async () => {
    const picked = vi.fn()
    render(<EffortMenu efforts={['low', 'medium', 'high']} effort="high" onChange={picked} />)
    expect(screen.getByRole('button', { name: 'Effort: High' }).textContent).toContain('High')
    await openMenu(screen.getByRole('button', { name: 'Effort: High' }))
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['The agent’s default', 'Low', 'Medium', 'High'])
    screen.getByRole('menuitem', { name: 'Medium' }).click()
    expect(picked).toHaveBeenCalledWith('medium')
  })

  test('with nothing picked the trigger says Effort, and the first item clears the pick', async () => {
    const picked = vi.fn()
    render(<EffortMenu efforts={['low', 'medium']} onChange={picked} />)
    const trigger = screen.getByRole('button', { name: 'Effort: the agent’s default' })
    expect(trigger.textContent).toContain('Effort')
    await openMenu(trigger)
    screen.getByRole('menuitem', { name: 'The agent’s default' }).click()
    expect(picked).toHaveBeenCalledWith(undefined)
  })

  test("a level reads as the agent writes it, capitalised, and the one id nobody says out loud is spelled", () => {
    expect(effortLabel('medium')).toBe('Medium')
    expect(effortLabel('ultra')).toBe('Ultra')
    expect(effortLabel('xhigh')).toBe('Extra high')
  })
})
