import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary.js'

afterEach(cleanup)

// React logs a caught render error to console.error (twice, plus the boundary's own log). That is
// expected here and only clutters the agent, so swallow it for these cases.
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

/** Throws on demand, so a test can flip it from crashing to healthy between renders. */
function Boom({ crash }: { crash: boolean }) {
  if (crash) throw new Error('kaboom')
  return <div>healthy content</div>
}

describe('ErrorBoundary (#1194)', () => {
  test('renders its children untouched when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom crash={false} />
      </ErrorBoundary>,
    )
    expect(screen.getByText('healthy content')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('shows a recoverable alert instead of a blank screen when a child throws', () => {
    render(
      <ErrorBoundary>
        <Boom crash={true} />
      </ErrorBoundary>,
    )
    // The whole point of #1194: a crash leaves something on screen, not nothing.
    const alert = screen.getByRole('alert')
    expect(alert).toBeTruthy()
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    // The thrown message is surfaced so the crash is diagnosable rather than opaque.
    expect(screen.getByText('kaboom')).toBeTruthy()
    // And the offending subtree is gone, not still trying to render.
    expect(screen.queryByText('healthy content')).toBeNull()
  })

  test('logs the error so a "random" crash leaves a trace in the console', () => {
    const spy = vi.spyOn(console, 'error')
    render(
      <ErrorBoundary>
        <Boom crash={true} />
      </ErrorBoundary>,
    )
    expect(spy.mock.calls.some(call => call[0] === 'Dashboard render error:')).toBe(true)
  })

  test('"Try again" re-mounts the children, recovering once the cause is gone', () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Boom crash={true} />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeTruthy()

    // The next render would no longer throw (the transient cause passed); clearing the boundary
    // then draws the healthy tree rather than the fallback.
    rerender(
      <ErrorBoundary>
        <Boom crash={false} />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(screen.getByText('healthy content')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
