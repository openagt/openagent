import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** The list as a keyboard of `platform` shows it: the keys are read once, as the module loads. */
async function listOn(platform: string): Promise<void> {
  vi.spyOn(Navigator.prototype, 'platform', 'get').mockReturnValue(platform)
  vi.resetModules()
  const { ShortcutList } = await import('./ShortcutList.js')
  render(<ShortcutList />)
}

/** Each row of the group headed `place`: what it does, then its keys. */
function rows(place: string): string[] {
  const group = screen.getByRole('region', { name: place })
  return within(group)
    .getAllByRole('listitem')
    .map(row => `${row.firstChild?.textContent} = ${[...row.querySelectorAll('kbd kbd')].map(cap => cap.textContent).join(' ')}`)
}

test('every shortcut is listed under where it works, with its keys as the keyboard writes them', async () => {
  await listOn('Linux x86_64')
  expect(screen.getAllByRole('heading').map(h => h.textContent)).toEqual(['Anywhere', 'The message box', 'A working agent', 'A question', 'Saved prompts'])
  expect(rows('Anywhere')).toEqual(['Show the keyboard shortcuts = ?', 'Hide or show the sidebar = Ctrl B'])
  expect(rows('The message box')).toEqual(['Send = Enter', 'Start a new line = Shift Enter', 'Send, read by a working agent after its turn = Ctrl Enter'])
  expect(rows('A question')).toEqual(['Pick that answer = 1–9', 'Send the answer = Ctrl Enter'])
})

test('on a Mac the keys are ⌘ and ⇧', async () => {
  await listOn('MacIntel')
  expect(rows('The message box')).toEqual(['Send = Enter', 'Start a new line = ⇧ Enter', 'Send, read by a working agent after its turn = ⌘ Enter'])
})
