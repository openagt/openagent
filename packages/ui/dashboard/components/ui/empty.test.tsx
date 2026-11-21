import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Empty } from './empty.js'

afterEach(cleanup)

describe('Empty', () => {
  test('says what is missing and what fills it in one paragraph, its press under them', () => {
    render(
      <Empty title="No runs yet." action={<button type="button">New agent session</button>}>
        A run shows here from the moment an agent starts.
      </Empty>,
    )
    const words = screen.getByText(/^No runs yet\./)
    expect(words.tagName).toBe('P')
    expect(words.textContent).toBe('No runs yet. A run shows here from the moment an agent starts.')
    // The page's own words on the column's edge: not centred, not set apart as a heading.
    expect(words.closest('.text-center')).toBeNull()
    expect(words.className).toBe('text-sm text-muted-foreground')
    const press = screen.getByRole('button', { name: 'New agent session' })
    expect(words.compareDocumentPosition(press) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('a single sentence stands alone, with no press', () => {
    render(<Empty title="Nothing queued." />)
    expect(screen.getByText('Nothing queued.').textContent).toBe('Nothing queued.')
    expect(screen.queryByRole('button')).toBeNull()
  })
})
