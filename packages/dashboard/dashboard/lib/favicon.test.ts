import { afterEach, describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { faviconHref, useFavicon, IDLE_FAVICON, WORKING_FAVICON } from './favicon.js'

afterEach(() => {
  document.head.innerHTML = ''
})

const icon = () => document.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute('href')

// #875: the tab is the half of the signal you see while the dashboard is in the background.
describe('useFavicon', () => {
  test('swaps the link the shell emitted rather than adding a second one', () => {
    document.head.innerHTML = `<link rel="icon" href="${IDLE_FAVICON}" />`
    const { rerender } = renderHook(({ working }) => useFavicon(working), { initialProps: { working: true } })
    expect(icon()).toBe(WORKING_FAVICON)
    expect(document.querySelectorAll('link[rel~="icon"]').length).toBe(1)
    rerender({ working: false })
    expect(icon()).toBe(IDLE_FAVICON)
  })

  test('adds a link when the page has none', () => {
    renderHook(() => useFavicon(true))
    expect(icon()).toBe(WORKING_FAVICON)
  })

  test('names the two icon files', () => {
    expect(faviconHref(true)).toBe(WORKING_FAVICON)
    expect(faviconHref(false)).toBe(IDLE_FAVICON)
  })
})
