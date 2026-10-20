import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { RunPrLink } from './RunPrLink.js'

afterEach(cleanup)

describe('the run\'s pull request under its box', () => {
  test('its number and how it stands, a link to the request', () => {
    render(<RunPrLink pr={{ number: 2, url: 'https://x/pull/2', state: 'MERGED' }} />)
    const link = screen.getByRole('link', { name: 'PR #2 merged, on the git host' })
    expect(link.getAttribute('href')).toBe('https://x/pull/2')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.textContent).toBe('PR #2 merged')
    expect(link.querySelector('svg')!.getAttribute('class')).toContain('text-merged')
  })

  test('a state not read yet: the number, a plain mark, no word', () => {
    render(<RunPrLink pr={{ number: 7, url: 'https://x/pull/7', state: 'UNKNOWN' }} />)
    expect(screen.getByRole('link').textContent).toBe('PR #7')
  })
})
