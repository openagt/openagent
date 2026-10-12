import { afterEach, describe, expect, test, vi } from 'vitest'
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { PromptEditor, type PromptEditorHandle } from './PromptEditor.js'

// The real Tiptap editor (no mock): what's under test is the keyboard seam itself — which
// Enter reaches the submit callback and which stays an editing key (#1510).

afterEach(cleanup)

async function renderEditor() {
  const onSubmit = vi.fn()
  const onChange = vi.fn()
  render(<PromptEditor onChange={onChange} onSubmit={onSubmit} projects={[]} commands={[]} />)
  // immediatelyRender: false — the contenteditable appears a tick after mount.
  const box = await waitFor(() => {
    const el = document.querySelector('[role="textbox"]')
    if (!el) throw new Error('editor not mounted yet')
    return el as HTMLElement
  })
  return { box, onSubmit }
}

describe('Enter sends the prompt (#1510)', () => {
  test('switching the editor off and on again is no edit: no change is told', async () => {
    const onChange = vi.fn()
    const editor = (disabled: boolean) => <PromptEditor onChange={onChange} onSubmit={vi.fn()} projects={[]} commands={[]} disabled={disabled} />
    const { rerender } = render(editor(false))
    await waitFor(() => expect(document.querySelector('[role="textbox"]')).toBeTruthy())
    onChange.mockClear()
    rerender(editor(true))
    rerender(editor(false))
    await act(async () => {})
    expect(document.querySelector('[role="textbox"]')!.getAttribute('contenteditable')).toBe('true')
    expect(onChange).not.toHaveBeenCalled()
  })

  test('plain Enter submits; Shift+Enter and Alt+Enter do not', async () => {
    const { box, onSubmit } = await renderEditor()
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })
    fireEvent.keyDown(box, { key: 'Enter', altKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  test('Cmd/Ctrl+Enter still submits', async () => {
    const { box, onSubmit } = await renderEditor()
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })

  test('Enter is left to an open suggestion menu (aria-expanded), which uses it to pick', async () => {
    const { box, onSubmit } = await renderEditor()
    // The suggestion render marks the editor while its menu is visible; the guard reads that mark.
    box.setAttribute('aria-expanded', 'true')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSubmit).not.toHaveBeenCalled()
    box.setAttribute('aria-expanded', 'false')
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  test('Enter during IME composition is not a send', async () => {
    const { box, onSubmit } = await renderEditor()
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('the `/` menu closes once a command is in the box', () => {
  async function renderWithCommands() {
    const ref = createRef<PromptEditorHandle>()
    render(
      <PromptEditor
        ref={ref}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        projects={[]}
        commands={[{ name: 'research' }, { name: 'readability' }]}
      />,
    )
    const box = await waitFor(() => {
      const el = document.querySelector('[role="textbox"]')
      if (!el) throw new Error('editor not mounted yet')
      return el as HTMLElement
    })
    return { box, editor: ref.current! }
  }

  test('a partly typed command opens the menu', async () => {
    const { box, editor } = await renderWithCommands()
    act(() => void editor.loadTemplate('/re'))
    await waitFor(() => expect(box.getAttribute('aria-expanded')).toBe('true'))
  })

  test('a picked command loads with its trailing space, and the menu stays closed', async () => {
    const { box, editor } = await renderWithCommands()
    act(() => void editor.loadTemplate('/research '))
    await new Promise(r => setTimeout(r, 50))
    expect(box.getAttribute('aria-expanded')).not.toBe('true')
    expect(box.textContent).toBe('/research ')
  })

  test('a command typed in full closes the menu', async () => {
    const { box, editor } = await renderWithCommands()
    act(() => void editor.loadTemplate('/re'))
    await waitFor(() => expect(box.getAttribute('aria-expanded')).toBe('true'))
    act(() => void editor.loadTemplate('/research'))
    await waitFor(() => expect(box.getAttribute('aria-expanded')).toBe('false'))
  })
})
