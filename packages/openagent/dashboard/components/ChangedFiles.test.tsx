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
    const card = screen.getByRole('list', { name: 'Files changed' })
    expect(card.className).toContain('ring-1')
    for (const row of within(card).getAllByRole('button')) {
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

  test('with nothing to open a change in, the rows are no buttons', () => {
    render(<ChangedFiles files={files} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('app.ts')).toBeTruthy()
  })
})
