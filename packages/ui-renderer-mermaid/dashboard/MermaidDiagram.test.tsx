import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

// The library as a test draws with it: a diagram's text in an SVG, and no diagram where the text says "oops".
const mermaid = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (_id: string, text: string) => {
    if (text.includes('oops')) throw new Error('Parse error on line 2')
    return { svg: `<svg data-diagram="${text.replace(/\n/g, ' ')}"></svg>` }
  }),
}))
vi.mock('mermaid', () => ({ default: mermaid }))

const { DRAW_AFTER_MS, MermaidDiagram, forgetDiagrams, readKeptDiagrams } = await import('./MermaidDiagram.js')

beforeEach(() => {
  forgetDiagrams()
  vi.useFakeTimers()
  mermaid.initialize.mockClear()
  mermaid.render.mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  document.documentElement.classList.remove('dark')
})

/** Let the text stand still long enough for its diagram to be drawn, and the drawing end. */
const settle = async () => {
  const before = mermaid.render.mock.results.length
  await act(async () => vi.advanceTimersByTimeAsync(DRAW_AFTER_MS))
  await vi.waitFor(() => expect(mermaid.render.mock.results.length).toBeGreaterThan(before))
  await act(async () => void (await Promise.allSettled(mermaid.render.mock.results.map(result => result.value))))
}
const diagram = () => screen.queryByRole('img', { name: 'Diagram' })?.querySelector('svg')?.dataset['diagram']

describe('a mermaid block', () => {
  test('is its diagram once its text stands still, drawn with the strict security in the page light', async () => {
    render(<MermaidDiagram content={'graph TD\n  a --> b'} />)
    expect(document.querySelector('pre')!.textContent).toBe('graph TD\n  a --> b')
    await settle()
    expect(diagram()).toBe('graph TD   a --> b')
    expect(mermaid.initialize).toHaveBeenLastCalledWith({ startOnLoad: false, securityLevel: 'strict', theme: 'default' })
  })

  test('while it is being written, it is its text: each new line waits for the text to stand still', async () => {
    const { rerender } = render(<MermaidDiagram content={'graph TD'} />)
    await settle()
    expect(diagram()).toBe('graph TD')
    rerender(<MermaidDiagram content={'graph TD\n  a --> b'} />)
    expect(diagram()).toBeUndefined()
    expect(document.querySelector('pre')!.textContent).toBe('graph TD\n  a --> b')
    await settle()
    expect(diagram()).toBe('graph TD   a --> b')
  })

  test('a text that is no diagram stays its text, to be read and copied', async () => {
    render(<MermaidDiagram content={'graph TD\n  oops -->'} />)
    await settle()
    expect(diagram()).toBeUndefined()
    expect(document.querySelector('pre')!.textContent).toBe('graph TD\n  oops -->')
    expect(screen.getByRole('button', { name: 'Copy the code' })).toBeTruthy()
  })

  test('shown again, as on a switch back to its session, it is its diagram at once and is not drawn again', async () => {
    const first = render(<MermaidDiagram content={'graph TD\n  a --> b'} />)
    await settle()
    first.unmount()
    render(<MermaidDiagram content={'graph TD\n  a --> b'} />)
    expect(diagram()).toBe('graph TD   a --> b')
    expect(document.querySelector('pre')).toBeNull()
    await act(async () => vi.advanceTimersByTimeAsync(DRAW_AFTER_MS * 2))
    expect(mermaid.render).toHaveBeenCalledTimes(1)
  })

  test('a block is drawn as soon as it is shown: only a text that changes after waits to stand still', async () => {
    render(<MermaidDiagram content={'graph TD\n  a --> b'} />)
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => void (await Promise.allSettled(mermaid.render.mock.results.map(result => result.value))))
    expect(diagram()).toBe('graph TD   a --> b')
  })

  test('after the page is loaded again in the same tab, it is its diagram at once and is not drawn again', async () => {
    const first = render(<MermaidDiagram content={'graph TD\n  a --> b'} />)
    await settle()
    first.unmount()
    readKeptDiagrams()
    render(<MermaidDiagram content={'graph TD\n  a --> b'} />)
    expect(diagram()).toBe('graph TD   a --> b')
    await act(async () => vi.advanceTimersByTimeAsync(DRAW_AFTER_MS * 2))
    expect(mermaid.render).toHaveBeenCalledTimes(1)
  })

  test('the page turning dark draws it again, dark', async () => {
    render(<MermaidDiagram content={'graph TD'} />)
    await settle()
    await act(async () => void document.documentElement.classList.add('dark'))
    await settle()
    expect(mermaid.initialize).toHaveBeenLastCalledWith({ startOnLoad: false, securityLevel: 'strict', theme: 'dark' })
    expect(diagram()).toBe('graph TD')
  })
})
