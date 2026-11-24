import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'

// A session's box over the real composer, Tiptap editor and Context: what a message leaves in it as it
// goes, lands or is refused, which AgentComposer.test.tsx, with its stand-in composer, cannot see. The daemon's reads
// and the session's other menus are stubbed as in those two files.
const sendMessage = vi.hoisted(() => vi.fn())
vi.mock('../rpc/control.js', () => ({ sendMessage, sendStop: vi.fn() }))
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => ({}),
  usePreferencesLoaded: () => true,
  updatePreferences: vi.fn(),
  useActiveProjectId: () => 'p1',
}))
vi.mock('../lib/editors.js', () => ({ useDetectedEditors: () => [] }))
vi.mock('../rpc/projects.js', () => ({ onProjects: () => Promise.resolve([]), onCommands: vi.fn(async () => ({ commands: [] })) }))
vi.mock('../lib/use-project-launcher.js', async importOriginal => ({ ...(await importOriginal<object>()), useProjectLauncher: () => ({ gitHost: true, remote: true }) }))
vi.mock('./AutoMenu.js', () => ({ AutoMenu: () => null, autoSaid: () => '', autoCovers: () => undefined, useAutoLevels: () => [] }))
vi.mock('./ContextMenu.js', () => ({ SessionContextMenu: ({ context }: { context: Set<string> }) => <span data-testid="context">{[...context].join(', ')}</span> }))
vi.mock('./ProfileMenu.js', () => ({ ProfileOff: () => null }))
vi.mock('./GitHosts.js', () => ({ GitHostOff: () => null }))
import { keptDraft } from '../lib/draft-handoff.js'

const { AgentComposer } = await import('./AgentComposer.js')
const { useContextSet } = await import('../lib/use-context-set.js')

beforeEach(() => {
  localStorage.clear()
  sendMessage.mockReset()
})
afterEach(cleanup)

// The page's Context, as App holds it: the test picks into it as the `#` picker does. Closed, the session's page is
// gone and the shell's Context stays, as when New agent session shows the project's home.
let context: ReturnType<typeof useContextSet>
function Session({ id = 'run-1', open = true }: { id?: string; open?: boolean }) {
  const contextSet = useContextSet()
  context = contextSet
  return open ? <AgentComposer projectId="p1" agentId={id} live={false} files={['README.md']} contextSet={contextSet} /> : null
}

test('a refused message comes back as the same draft, its picked file a chip again and in the Context, after what was typed while it went', async () => {
  let answer: (outcome: unknown) => void = () => {}
  sendMessage.mockReturnValueOnce(new Promise(resolve => (answer = resolve)))
  render(<Session />)
  const box = (await screen.findByRole('textbox', { name: 'Message' })) as HTMLElement & { editor: Editor }
  // The `#` picker's pick: a chip in the box, and the file in the Context.
  act(() => void box.editor.commands.insertContent([{ type: 'text', text: 'look at ' }, { type: 'token', attrs: { kind: 'file', label: '#README.md', text: '#README.md' } }]))
  act(() => context.add('README.md'))
  await waitFor(() => expect(screen.getByTestId('context').textContent).toBe('README.md'))
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'look at #README.md\n\nContext: README.md', 'run-1'))
  // Typed while the message went.
  act(() => void box.editor.commands.insertContent('and then'))
  await act(async () => answer({ ok: false, error: 'resume refused' }))
  expect(box.editor.storage.markdown.getMarkdown()).toBe('and then\n\nlook at #README.md')
  expect(box.querySelectorAll('[data-token]').length).toBe(1)
  expect(screen.getByTestId('context').textContent).toBe('README.md')
})

test('a message refused once its session page closed waits in that session\'s draft, and leaves the shell\'s Context alone', async () => {
  let answer: (outcome: unknown) => void = () => {}
  sendMessage.mockReturnValueOnce(new Promise(resolve => (answer = resolve)))
  const page = render(<Session />)
  const box = (await screen.findByRole('textbox', { name: 'Message' })) as HTMLElement & { editor: Editor }
  act(() => void box.editor.commands.insertContent('do not lose these words'))
  act(() => context.add('README.md'))
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
  page.rerender(<Session open={false} />)
  await act(async () => answer({ ok: false, error: 'resume refused' }))
  expect(keptDraft('p1:run-1')).toBe('do not lose these words\n\nContext: README.md')
  expect([...context.context]).toEqual([])
})

test('a message refused once another session is shown is sent again from its own session with the Context it went with', async () => {
  let answer: (outcome: unknown) => void = () => {}
  sendMessage.mockReturnValueOnce(new Promise(resolve => (answer = resolve))).mockResolvedValue({ ok: true })
  const page = render(<Session />)
  const box = (await screen.findByRole('textbox', { name: 'Message' })) as HTMLElement & { editor: Editor }
  act(() => void box.editor.commands.insertContent('look at this'))
  act(() => context.add('README.md'))
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'look at this\n\nContext: README.md', 'run-1'))
  page.rerender(<Session id="run-2" />)
  await act(async () => answer({ ok: false, error: 'resume refused' }))
  page.rerender(<Session id="run-1" />)
  const again = (await screen.findByRole('textbox', { name: 'Message' })) as HTMLElement & { editor: Editor }
  await waitFor(() => expect(again.editor.storage.markdown.getMarkdown()).not.toBe(''))
  fireEvent.keyDown(again, { key: 'Enter' })
  await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2))
  expect(sendMessage).toHaveBeenLastCalledWith('p1', 'look at this\n\nContext: README.md', 'run-1')
})

test('a file picked while a message went keeps its Context once that message lands, and goes with the next one', async () => {
  let answer: (outcome: unknown) => void = () => {}
  sendMessage.mockReturnValueOnce(new Promise(resolve => (answer = resolve))).mockResolvedValue({ ok: true })
  render(<Session />)
  const box = (await screen.findByRole('textbox', { name: 'Message' })) as HTMLElement & { editor: Editor }
  act(() => void box.editor.commands.insertContent([{ type: 'text', text: 'look at ' }, { type: 'token', attrs: { kind: 'file', label: '#README.md', text: '#README.md' } }]))
  act(() => context.add('README.md'))
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'look at #README.md\n\nContext: README.md', 'run-1'))
  // Picked while the message went: a chip in the box, and the file in the Context.
  act(() => void box.editor.commands.insertContent([{ type: 'text', text: 'then ' }, { type: 'token', attrs: { kind: 'file', label: '#src/b.ts', text: '#src/b.ts' } }]))
  act(() => context.add('src/b.ts'))
  await act(async () => answer({ ok: true }))
  expect(screen.getByTestId('context').textContent).toBe('src/b.ts')
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(sendMessage).toHaveBeenLastCalledWith('p1', 'then #src/b.ts\n\nContext: src/b.ts', 'run-1'))
})

test('repicking the same file while sending keeps its Context', async () => {
  let answer: (outcome: unknown) => void = () => {}
  sendMessage.mockReturnValueOnce(new Promise(resolve => (answer = resolve)))
  render(<Session />)
  const box = (await screen.findByRole('textbox', { name: 'Message' })) as HTMLElement & { editor: Editor }
  const pick = () => {
    act(() => void box.editor.commands.insertContent([{ type: 'token', attrs: { kind: 'file', label: '#README.md', text: '#README.md' } }]))
    act(() => context.add('README.md'))
  }
  pick()
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
  pick()
  await act(async () => answer({ ok: true }))
  expect(box.querySelectorAll('[data-token]').length).toBe(1)
  expect(screen.getByTestId('context').textContent).toBe('README.md')
})

test('a click on Send hands the box back at once, for the next message', async () => {
  sendMessage.mockReturnValueOnce(new Promise(() => {}))
  render(<Session />)
  const box = (await screen.findByRole('textbox', { name: 'Message' })) as HTMLElement & { editor: Editor }
  // The box's own focus as it opens, before the click takes it away.
  await waitFor(() => expect(document.activeElement).toBe(box))
  act(() => void box.editor.commands.insertContent('first'))
  const send = screen.getByRole('button', { name: 'Send' })
  // The click's press takes the focus to the button, as a browser's does.
  send.focus()
  fireEvent.click(send)
  await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(document.activeElement).toBe(box))
})

test('a message landing leaves the caret where it was put in the next one', async () => {
  let answer: (outcome: unknown) => void = () => {}
  sendMessage.mockReturnValueOnce(new Promise(resolve => (answer = resolve)))
  render(<Session />)
  const box = (await screen.findByRole('textbox', { name: 'Message' })) as HTMLElement & { editor: Editor }
  act(() => void box.editor.commands.insertContent('first'))
  fireEvent.keyDown(box, { key: 'Enter' })
  await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1))
  // The next message typed while the first went, then a word put before it: the caret after "prefix ".
  act(() => {
    box.editor.commands.insertContent('new draft')
    box.editor.commands.setTextSelection(1)
    box.editor.commands.insertContent('prefix ')
  })
  expect(box.editor.state.selection.from).toBe(8)
  await act(async () => answer({ ok: true }))
  expect(box.editor.storage.markdown.getMarkdown()).toBe('prefix new draft')
  expect(box.editor.state.selection.from).toBe(8)
})
