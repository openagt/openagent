import { describe, expect, test } from 'vitest'
import { useEffect, useState } from 'react'
import { act, render } from '@testing-library/react'
import { HostServicesContext, INERT_HOST_SERVICES, useSteadyServices } from './host-services.js'
import { ModuleSlot } from '../components/ModulePageView.js'
import { useModuleHost, type ModuleHost } from '../module/index.js'

// A module keys an effect on its host: the shell's own renders must not start that effect over.

describe('the host a module is given', () => {
  test('is the same object at every render of the shell, and calls what the shell gave last', async () => {
    let rerender = (): void => {}
    let started = 0
    const opened: string[] = []
    let given: ModuleHost | undefined
    function Module() {
      const host = useModuleHost()
      given = host
      useEffect(() => {
        started++
      }, [host])
      return null
    }
    function Shell() {
      const [renders, setRenders] = useState(0)
      rerender = () => setRenders(n => n + 1)
      const services = useSteadyServices({ ...INERT_HOST_SERVICES, openPage: segment => opened.push(`${segment} at render ${renders}`) })
      return (
        <HostServicesContext.Provider value={services}>
          <ModuleSlot package="@openagt/devices" label="test">
            <Module />
          </ModuleSlot>
        </HostServicesContext.Provider>
      )
    }
    render(<Shell />)
    await act(async () => rerender())
    await act(async () => rerender())
    expect(started).toBe(1)
    given!.openPage('tickets')
    expect(opened).toEqual(['tickets at render 2'])
  })
})
