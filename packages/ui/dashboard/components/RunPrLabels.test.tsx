import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RunPrLabels } from './RunPrLabels.js'

afterEach(cleanup)

describe('the run\'s pull requests under its box', () => {
  test('one label each, oldest first: its number and how it stands, a link to the request', () => {
    render(<RunPrLabels prs={[{ number: 4, url: 'https://x/pull/4', state: 'merged' }, { number: 5, url: 'https://x/pull/5', state: 'OPEN' }]} />)
    const links = screen.getAllByRole('link')
    expect(links.map(link => link.getAttribute('aria-label'))).toEqual(['PR #4 merged, on the git host', 'PR #5 open, on the git host'])
    expect(links.map(link => link.textContent)).toEqual(['#4merged', '#5open'])
    expect(links[0]!.getAttribute('href')).toBe('https://x/pull/4')
    expect(links[0]!.getAttribute('target')).toBe('_blank')
    expect(links[0]!.querySelector('svg')!.getAttribute('class')).toContain('text-merged')
  })

  test('a state not read yet: the number, a plain mark, no word', () => {
    render(<RunPrLabels prs={[{ number: 7, url: 'https://x/pull/7', state: 'UNKNOWN' }, { number: 8, url: 'https://x/pull/8' }]} />)
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['#7', '#8'])
  })

  test('no request, no labels', () => {
    const { container } = render(<RunPrLabels prs={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
