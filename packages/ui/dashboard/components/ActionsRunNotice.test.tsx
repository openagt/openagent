import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { OpenAgentEvent } from '../../src/index.js'
import { ActionsRunNotice } from './ActionsRunNotice.js'

afterEach(cleanup)

const runAction = (url: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'action', label: `run ${url}` } })

describe('ActionsRunNotice (#1053)', () => {
  test('an Actions run explains the burst wait while it runs', () => {
    render(<ActionsRunNotice target="actions" events={[]} live />)
    expect(screen.getByRole('status').textContent).toMatch(/updates arrive when the run finishes/i)
  })

  test('links through to the live Actions run once the driver reports it', () => {
    render(<ActionsRunNotice target="actions" events={[runAction('https://github.com/o/r/actions/runs/7')]} live />)
    const link = screen.getByRole('link', { name: /Actions run/i })
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/actions/runs/7')
  })

  test('no link before the driver has found the run', () => {
    render(<ActionsRunNotice target="actions" events={[]} live />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  test('a finished Actions run drops the "updates on completion" line but keeps the link', () => {
    render(<ActionsRunNotice target="actions" events={[runAction('https://github.com/o/r/actions/runs/7')]} live={false} />)
    expect(screen.getByRole('status').textContent).not.toMatch(/updates arrive/i)
    expect(screen.getByRole('link', { name: /Actions run/i })).toBeTruthy()
  })

  test('renders nothing for a local run', () => {
    const { container } = render(<ActionsRunNotice target="local" events={[]} live />)
    expect(container.firstChild).toBeNull()
  })

  test('renders nothing when the target is unset (a plain local run)', () => {
    const { container } = render(<ActionsRunNotice events={[]} live />)
    expect(container.firstChild).toBeNull()
  })
})
