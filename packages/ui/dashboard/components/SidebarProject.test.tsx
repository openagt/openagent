import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { UiSidebarProjectProps } from '../module/index.js'
import { ModulesContext, mountedOf } from '../lib/use-modules.js'
import { SidebarProject } from './SidebarProject.js'

// The sidebar's project select is a module's (`sidebar.project`): the shell draws the first one's,
// handing it the pick, and holds its place while there is none.

afterEach(cleanup)

test("the sidebar draws the first module's project select with the pick, and holds its place while there is none", () => {
  const said: UiSidebarProjectProps[] = []
  const select = (name: string) => (props: UiSidebarProjectProps) => {
    said.push(props)
    return <button type="button">{name}</button>
  }
  const onPick = () => {}
  const modules = mountedOf({
    views: {
      'sidebar.project': [
        { place: 'sidebar.project', id: 'project', View: select('first'), package: '@openagt/projects', projects: [], computer: true },
        { place: 'sidebar.project', id: 'other', View: select('second'), package: '@openagt/other', projects: [], computer: true },
      ],
    },
  })
  render(
    <ModulesContext.Provider value={modules}>
      <SidebarProject picked="p1" pending={false} onPick={onPick} />
    </ModulesContext.Provider>,
  )
  expect(screen.getByRole('button').textContent).toBe('first')
  expect(said.at(-1)).toEqual({ picked: 'p1', pending: false, onPick })
  cleanup()
  const { container } = render(
    <ModulesContext.Provider value={mountedOf()}>
      <SidebarProject picked={null} pending={false} onPick={onPick} />
    </ModulesContext.Provider>,
  )
  expect(container.firstElementChild!.className).toContain('md:h-9')
})
