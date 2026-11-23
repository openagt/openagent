import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { hoverTooltip } from '../test-utils.js'
import { RunPrLabels } from './RunPrLabels.js'

afterEach(cleanup)

describe('the run\'s pull requests above its box', () => {
  test('one label each, oldest first: its mark in the colour of how it stands and its number, a link to the request; the state\'s word is in its name and its hover, not drawn', async () => {
    render(<RunPrLabels prs={[{ number: 4, url: 'https://x/pull/4', state: 'merged' }, { number: 5, url: 'https://x/pull/5', state: 'OPEN' }]} />)
    const links = screen.getAllByRole('link')
    expect(links.map(link => link.getAttribute('aria-label'))).toEqual(['PR #4 merged, on the git host', 'PR #5 open, on the git host'])
    expect(links.map(link => link.textContent)).toEqual(['#4', '#5'])
    expect(links[0]!.getAttribute('href')).toBe('https://x/pull/4')
    expect(links[0]!.getAttribute('target')).toBe('_blank')
    expect(links[0]!.querySelector('svg')!.getAttribute('class')).toContain('text-merged')
    expect(links[1]!.querySelector('svg')!.getAttribute('class')).toContain('text-success')
    expect((await hoverTooltip(links[0]!)).textContent).toBe('PR #4, merged')
  })

  test('a state not read yet: the number, a plain mark, no word in its name or its hover', async () => {
    render(<RunPrLabels prs={[{ number: 7, url: 'https://x/pull/7', state: 'UNKNOWN' }, { number: 8, url: 'https://x/pull/8' }]} />)
    const links = screen.getAllByRole('link')
    expect(links.map(link => link.textContent)).toEqual(['#7', '#8'])
    expect(links.map(link => link.getAttribute('aria-label'))).toEqual(['PR #7, on the git host', 'PR #8, on the git host'])
    expect((await hoverTooltip(links[1]!)).textContent).toBe('PR #8')
  })

  test('no request, no labels', () => {
    const { container } = render(<RunPrLabels prs={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
