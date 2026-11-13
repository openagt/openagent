import { afterEach, describe, expect, test, vi } from 'vitest'
import { createRef } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
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

test('with autoFocus the box takes the caret as soon as it exists; without, it leaves the focus where it is', async () => {
  const editor = (autoFocus: boolean) => <PromptEditor key={String(autoFocus)} onChange={vi.fn()} onSubmit={vi.fn()} projects={[]} commands={[]} autoFocus={autoFocus} />
  const { rerender } = render(editor(false))
  await waitFor(() => expect(document.querySelector('[role="textbox"]')).toBeTruthy())
  // Long past the moment Tiptap would focus a box made with autoFocus.
  await act(() => new Promise(resolve => setTimeout(resolve, 100)))
  expect(document.activeElement).toBe(document.body)
  rerender(editor(true))
  await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('textbox'))
})

test('a text the box opens with takes the caret, unless it is told not to', async () => {
  const editor = (initialFocus: boolean) => <PromptEditor key={String(initialFocus)} onChange={vi.fn()} onSubmit={vi.fn()} projects={[]} commands={[]} initialText="a kept draft" initialFocus={initialFocus} />
  const { rerender } = render(editor(false))
  await waitFor(() => expect(document.querySelector('[role="textbox"]')?.textContent).toBe('a kept draft'))
  await act(() => new Promise(resolve => setTimeout(resolve, 100)))
  expect(document.activeElement).toBe(document.body)
  rerender(editor(true))
  await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('textbox'))
  expect(document.activeElement?.textContent).toBe('a kept draft')
})

test('a text the box opens with over a draft: one undo brings the draft back', async () => {
  render(<PromptEditor onChange={vi.fn()} onSubmit={vi.fn()} projects={[]} commands={[]} initialText="the handed prompt" replacedText="my own draft" />)
  const box = await waitFor(() => {
    const el = document.querySelector<HTMLElement>('[role="textbox"]')
    if (el?.textContent !== 'the handed prompt') throw new Error('not seeded yet')
    return el
  })
  fireEvent.keyDown(box, { key: 'z', ctrlKey: true })
  expect(box.textContent).toBe('my own draft')
  fireEvent.keyDown(box, { key: 'z', ctrlKey: true })
  expect(box.textContent).toBe('my own draft')
})

test('the box is called what it takes: a prompt unless told otherwise', async () => {
  const { rerender } = render(<PromptEditor key="a" onChange={vi.fn()} onSubmit={vi.fn()} projects={[]} commands={[]} />)
  await waitFor(() => expect(document.querySelector('[role="textbox"]')?.getAttribute('aria-label')).toBe('Prompt'))
  rerender(<PromptEditor key="b" onChange={vi.fn()} onSubmit={vi.fn()} projects={[]} commands={[]} label="Message" />)
  await waitFor(() => expect(document.querySelector('[role="textbox"]')?.getAttribute('aria-label')).toBe('Message'))
})

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

  test('Cmd/Ctrl+Enter submits for later, as Claude Code\'s "queue for later"; Enter does not', async () => {
    const { box, onSubmit } = await renderEditor()
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    expect(onSubmit.mock.calls).toEqual([[true], [true]])
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onSubmit.mock.calls[2]).toEqual([])
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

describe('words given back after the draft (append)', () => {
  async function renderDraft() {
    const ref = createRef<PromptEditorHandle>()
    const onChange = vi.fn()
    const onMentionRemoved = vi.fn()
    render(<PromptEditor ref={ref} onChange={onChange} onSubmit={vi.fn()} onMentionRemoved={onMentionRemoved} projects={[]} commands={[]} />)
    const box = await waitFor(() => {
      const el = document.querySelector('[role="textbox"]')
      if (!el) throw new Error('editor not mounted yet')
      return el as HTMLElement & { editor: Editor }
    })
    return { box, editor: box.editor, handle: ref.current!, onChange, onMentionRemoved }
  }
  const said = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls.at(-1)![0]

  test('they go after the draft as lines of their own, and a caret in its middle stays where it was', async () => {
    const { editor, handle, onChange } = await renderDraft()
    act(() => void editor.commands.insertContent('first draft words'))
    act(() => void editor.commands.setTextSelection(4))
    act(() => handle.append('the words it never read'))
    expect(said(onChange)).toBe('first draft words\n\nthe words it never read')
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([4, 4])
  })

  test('a range selected in the draft stays selected', async () => {
    const { editor, handle } = await renderDraft()
    act(() => void editor.commands.insertContent('first draft words'))
    act(() => void editor.commands.setTextSelection({ from: 2, to: 8 }))
    act(() => handle.append('the words it never read'))
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([2, 8])
  })

  test('a chip in the draft stays a chip, and what it added to the Context stays', async () => {
    const { box, editor, handle, onChange, onMentionRemoved } = await renderDraft()
    act(() => void editor.commands.insertContent([{ type: 'text', text: 'look at ' }, { type: 'token', attrs: { kind: 'file', label: '#src/a.ts', text: '#src/a.ts' } }, { type: 'text', text: ' first' }]))
    act(() => handle.append('the words it never read'))
    expect(box.querySelectorAll('[data-token]').length).toBe(1)
    expect(onMentionRemoved).not.toHaveBeenCalled()
    expect(said(onChange)).toBe('look at #src/a.ts first\n\nthe words it never read')
  })

  test('one undo takes them out again; in an empty box they are all there is', async () => {
    const { box, editor, handle, onChange } = await renderDraft()
    act(() => void editor.commands.insertContent('first draft words'))
    act(() => handle.append('the words it never read'))
    fireEvent.keyDown(box, { key: 'z', ctrlKey: true })
    expect(box.textContent).toBe('first draft words')
    act(() => void editor.commands.clearContent(true))
    act(() => handle.append('the words it never read'))
    expect(said(onChange)).toBe('the words it never read')
  })
})
