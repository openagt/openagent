import { createElement, type ReactNode } from 'react'
import { configure } from '@testing-library/react'
import { beforeEach, vi } from 'vitest'
import { forgetRemembered } from '@openagt/skill-ui/module'

// Testing Library's async queries (`findBy*`, `waitFor`) give up after 1s by default, which is
// not enough on a loaded machine (#886). Several components here assert through a Base UI menu,
// which portals and then positions itself, so the element under assertion arrives a frame or two
// after the click. That takes ~40ms idle, and CI ran 39 suites at once and blew past the second:
// `PreviewBar.test.tsx:43` failed with "Unable to find an element with the text: api" at 1079ms,
// turning main red for a component that works.
//
// The timeout is a ceiling, not a delay: a passing query still returns as soon as it matches, so
// this costs nothing when things are healthy and only buys patience when the machine is starved.
configure({ asyncUtilTimeout: 5000 })

// The answers `use-async` remembers per key live for the page's life, which in a test run is the
// whole file, and the ones it stores live in the browser's storage: forget both before each test,
// so one test's answer is never another's first frame.
beforeEach(() => {
  forgetRemembered()
  localStorage.clear()
})

// jsdom lays nothing out, and the library behind the shell's resizable panes (`ui/resizable`)
// measures its panels as they come to the page. In its place: plain elements that say what they
// were given. A group keeps the callback it would call after a person dragged a line, as
// `layoutChanged` on its element, for a test to call.
vi.mock('react-resizable-panels', () => {
  type Props = Record<string, unknown> & { children?: ReactNode }
  return {
    Group: ({ children, orientation, className, disabled, onLayoutChanged }: Props) =>
      createElement('div', { 'data-group': '', 'data-orientation': orientation, 'data-disabled': disabled ? '' : undefined, className, ref: (el: HTMLElement | null) => void (el && Object.assign(el, { layoutChanged: onLayoutChanged })) }, children),
    Panel: ({ children, id, defaultSize, className }: Props) => createElement('div', { 'data-panel': '', id, 'data-default-size': defaultSize, className }, children),
    Separator: ({ children, className, 'aria-label': label }: Props) => createElement('div', { role: 'separator', 'data-separator': '', 'aria-label': label, className }, children),
  }
})

// A tooltip opens once the pointer has rested on its trigger a moment (ui/tooltip.tsx), and a
// test's pointer never rests: it only arrives. Here every tooltip opens as the pointer comes.
vi.mock('@base-ui/react/tooltip', async importOriginal => {
  const { Tooltip } = await importOriginal<typeof import('@base-ui/react/tooltip')>()
  const Trigger = (props: Record<string, unknown>) => createElement(Tooltip.Trigger, { ...props, delay: 0 })
  return { Tooltip: { ...Tooltip, Trigger } }
})
