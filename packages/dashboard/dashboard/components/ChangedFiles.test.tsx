import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ChangedFiles } from './ChangedFiles.js'

afterEach(cleanup)

const files = [
  { path: 'docs/DESCRIPTION.md', name: 'DESCRIPTION.md', added: 11, removed: 0, created: true },
  { path: 'src/app.ts', name: 'app.ts', added: 2, removed: 5, created: false },
]

describe('ChangedFiles', () => {
  test('a row for each file: its name, the lines added and removed, and its whole path on hover', () => {
    render(<ChangedFiles files={files} onOpen={() => {}} />)
    const rows = within(screen.getByRole('list', { name: 'Files changed' })).getAllByRole('listitem')
    expect(rows.map(row => row.textContent)).toEqual(['DESCRIPTION.md+11 −0', 'app.ts+2 −5'])
    expect(screen.getByText('DESCRIPTION.md').getAttribute('title')).toBe('docs/DESCRIPTION.md')
  })

  test('the files are one card, a row each, with no arrow, as Claude Code lists them', () => {
    render(<ChangedFiles files={files} onOpen={() => {}} />)
    const list = screen.getByRole('list', { name: 'Files changed' })
    expect(list.parentElement?.className).toContain('ring-1')
    for (const row of within(list).getAllByRole('button')) {
      expect(row.className).not.toContain('border')
      expect(row.querySelectorAll('svg')).toHaveLength(1)
    }
  })

  test('a click on a row asks for that file, by its path', () => {
    const onOpen = vi.fn()
    render(<ChangedFiles files={files} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show the change to app.ts' }))
    expect(onOpen.mock.calls).toEqual([['src/app.ts']])
  })

  test('with nothing to open a change in, the rows are no buttons, and no "See all"', () => {
    render(<ChangedFiles files={files} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('app.ts')).toBeTruthy()
    expect(screen.getByText('Edited 2 files')).toBeTruthy()
    expect(screen.queryByText('See all')).toBeNull()
  })

  test('two files: "Edited 2 files" over the rows, "See all" with the lines of both under them', () => {
    render(<ChangedFiles files={files} onOpen={() => {}} />)
    const card = screen.getByRole('list', { name: 'Files changed' }).parentElement!
    expect(card.textContent).toBe('Edited 2 filesDESCRIPTION.md+11 −0app.ts+2 −5See all+13 −5')
  })

  test('a click on "See all" asks for all of them: no path', () => {
    const onOpen = vi.fn()
    render(<ChangedFiles files={files} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /See all/ }))
    expect(onOpen.mock.calls).toEqual([[]])
  })

  test('one file: its row alone, as Claude Code shows it', () => {
    render(<ChangedFiles files={files.slice(1)} onOpen={() => {}} />)
    const card = screen.getByRole('list', { name: 'Files changed' }).parentElement!
    expect(card.textContent).toBe('app.ts+2 −5')
  })
})
