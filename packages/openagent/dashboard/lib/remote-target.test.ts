import { afterEach, describe, expect, test } from 'vitest'
import { followProjectHome, getSelectedMachineId, runTarget, selectMachine } from './remote-target.js'

afterEach(() => selectMachine(null))

const machines = [{ id: 'laptop' }, { id: 'studio' }]

describe('where a run goes', () => {
  test("another computer's project picks that computer when it is opened, and a project of this computer's lets that pick go", () => {
    followProjectHome('laptop')
    expect(getSelectedMachineId()).toBe('laptop')
    followProjectHome(undefined)
    expect(getSelectedMachineId()).toBeNull()
  })

  test("the person's own pick holds: over another computer's project, and on one of this computer's after it", () => {
    selectMachine('studio')
    followProjectHome('laptop')
    expect(getSelectedMachineId()).toBe('studio')
    followProjectHome(undefined)
    expect(getSelectedMachineId()).toBe('studio')

    // Picked over the project's own pick: that is the person's now.
    selectMachine(null)
    followProjectHome('laptop')
    selectMachine('studio')
    followProjectHome(undefined)
    expect(getSelectedMachineId()).toBe('studio')
  })

  test('a project with no repository address goes only where it is: this computer for its own, its own computer for another\'s', () => {
    const noAddress = {}
    expect(runTarget(machines, 'studio', noAddress, undefined)).toBeUndefined()
    expect(runTarget(machines, 'studio', noAddress, 'laptop')).toBeUndefined()
    expect(runTarget(machines, 'laptop', noAddress, 'laptop')).toEqual({ id: 'laptop' })
    expect(runTarget(machines, 'studio', { address: 'github.com/acme/shop' }, 'laptop')).toEqual({ id: 'studio' })
    // Until the launcher is read, the pick holds; a removed machine is none.
    expect(runTarget(machines, 'studio', null, undefined)).toEqual({ id: 'studio' })
    expect(runTarget(machines, 'gone', null, undefined)).toBeUndefined()
    expect(runTarget(machines, null, null, 'laptop')).toBeUndefined()
  })
})
