import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { MessageScrollerProvider, MessageScrollerViewport } from './message-scroller.js'

afterEach(cleanup)

const viewport = () => {
  render(
    <MessageScrollerProvider>
      <MessageScrollerViewport />
    </MessageScrollerProvider>,
  )
  const el = document.querySelector('[data-slot="message-scroller-viewport"]')
  if (!el) throw new Error('no viewport')
  return el
}

// Read from the dashboard root, which is vitest's cwd (the package's `test` script cds here for
// exactly this reason); `import.meta.url` is not a file URL under jsdom.
const tailwind = readFileSync('tailwind.css', 'utf8')

// #914: the port dropped upstream's viewport styling because those utilities came from a plugin we
// do not have. They are local now, so the pairing is what needs pinning: a class the stylesheet
// does not define is silently nothing, which is exactly how the styling went missing the first time.
describe('MessageScrollerViewport', () => {
  test('asks for a toned scrollbar and a stable gutter', () => {
    const className = viewport().className
    expect(className).toContain('scrollbar-thin')
    expect(className).toContain('scrollbar-gutter-stable')
    // Quiet while the log is chasing the live edge, so the bar is not a twitching distraction.
    expect(className).toContain('data-autoscrolling:scrollbar-quiet')
  })

  test('every utility it asks for is one the stylesheet defines', () => {
    const asked = viewport()
      .className.split(/\s+/)
      .map(token => token.split(':').at(-1) ?? '')
      .filter(token => token.startsWith('scrollbar-'))
    expect(asked.length).toBeGreaterThan(0)
    for (const utility of asked) expect(tailwind, utility).toContain(`@utility ${utility} {`)
  })
})
