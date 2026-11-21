import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { NotFound } from './NotFound.js'

afterEach(cleanup)

describe('a page that is not found', () => {
  test('says why at every width, and its way back is a link a plain click follows in the page', () => {
    const onAction = vi.fn()
    render(<NotFound title="No such session" detail="It may have been deleted." actionLabel="Back to the project" href="/shop" onAction={onAction} />)
    expect(screen.getByRole('heading', { level: 1, name: 'No such session' })).toBeTruthy()
    // The sentence is the page: a phone, which says a page's description to a screen reader only, shows this one.
    expect(screen.getByText('It may have been deleted.').closest('.max-md\\:sr-only')).toBeNull()
    const back = screen.getByRole('link', { name: 'Back to the project' })
    expect(back.getAttribute('href')).toBe('/shop')
    expect(fireEvent.click(back, { ctrlKey: true })).toBe(true)
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(back)
    expect(onAction).toHaveBeenCalledOnce()
  })
})
