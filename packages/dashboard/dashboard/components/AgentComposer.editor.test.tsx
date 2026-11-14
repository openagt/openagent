import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'

// A session's box over the real composer, Tiptap editor and Context: what a refused message gives
// back, which AgentComposer.test.tsx, with its stand-in composer, cannot see. The daemon's reads
// and the session's other menus are stubbed as in those two files.
const sendMessage = vi.hoisted(() => vi.fn())
vi.mock('../rpc/control.js', () => ({ sendMessage, sendStop: vi.fn() }))
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
vi.mock('../lib/use-project-launcher.js', async importOriginal => ({ ...(await importOriginal<object>()), useProjectLauncher: () => ({ gitHost: true, remote: true }) }))
vi.mock('./AutoMenu.js', () => ({ AutoMenu: () => null }))
vi.mock('./ContextMenu.js', () => ({ ProjectContextMenu: ({ context }: { context: Set<string> }) => <span data-testid="context">{[...context].join(', ')}</span> }))
vi.mock('./AgentMenu.js', () => ({ AgentOff: () => null }))
vi.mock('./SkillsMenu.js', () => ({ SkillsOff: () => null }))
vi.mock('./GitHosts.js', () => ({ GitHostOff: () => null }))
import { saveMachines } from '../test-machines.js'

const { AgentComposer } = await import('./AgentComposer.js')
const { useContextSet } = await import('../lib/use-context-set.js')

beforeEach(async () => {
  localStorage.clear()
  sendMessage.mockReset()
  await saveMachines()
})
afterEach(cleanup)

// The page's Context, as App holds it: the test picks into it as the `#` picker does.
let context: ReturnType<typeof useContextSet>
function Session() {
  const contextSet = useContextSet()
  context = contextSet
  return <AgentComposer projectId="p1" agentId="run-1" live={false} files={['README.md']} contextSet={contextSet} />
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
