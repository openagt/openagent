import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import type { Editor } from '@tiptap/core'

// The composer over the real Tiptap editor: what its handle does to what is in the box, which
// Composer.test.tsx, with its stand-in editor, cannot see. The daemon's reads are stubbed as there.
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => ({}),
  usePreferencesLoaded: () => true,
  updatePreferences: vi.fn(),
  useProjectPresets: () => [],
  saveProjectPresetList: vi.fn(),
  useActiveProjectId: () => 'p1',
}))
vi.mock('../lib/editors.js', () => ({ useDetectedEditors: () => [] }))
vi.mock('../rpc/projects.js', () => ({ onProjects: () => Promise.resolve([]), onCommands: vi.fn(async () => ({ commands: [] })) }))
vi.mock('../rpc/machines.js', async () => (await import('../test-machines.js')).machinesRpc)
import { saveMachines } from '../test-machines.js'

const { Composer } = await import('./Composer.js')
type ComposerHandle = import('./Composer.js').ComposerHandle

beforeEach(async () => {
  localStorage.clear()
  await saveMachines()
})
afterEach(cleanup)

async function renderBox() {
  const handle = createRef<ComposerHandle>()
  render(<Composer ref={handle} files={[]} onSubmit={vi.fn()} busy={false} submitLabel="Send" submitBusyLabel="Sending…" inAgent />)
  const box = (await screen.findByRole('textbox', { name: 'Message' })) as HTMLElement & { editor: Editor }
  act(() => void box.editor.commands.insertContent('first draft words'))
  return { handle: handle.current!, box, editor: box.editor }
}

describe('words handed back to the box (append)', () => {
  test.each([
    { from: 4, to: 4 },
    { from: 2, to: 8 },
  ])('go after the draft, and the caret or the selection stays where it was: $from to $to', async selection => {
    const { handle, editor } = await renderBox()
    act(() => void editor.commands.setTextSelection(selection))
    act(() => handle.append('the words it never read'))
    expect(editor.storage.markdown.getMarkdown()).toBe('first draft words\n\nthe words it never read')
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([selection.from, selection.to])
  })

  test('read as they were typed, a "<", ">" or "&" included', async () => {
    const { handle, editor } = await renderBox()
    act(() => handle.append('a < b & c > d'))
    expect(editor.getText()).toBe('first draft words\n\na < b & c > d')
  })
})
