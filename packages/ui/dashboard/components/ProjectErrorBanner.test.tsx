import { afterEach, describe, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ProjectError } from '../../src/index.js'
import { ProjectErrorBanner } from './ProjectErrorBanner.js'

afterEach(cleanup)

const DATA_SYNC: ProjectError = {
  code: 'data-sync',
  message: 'the data branch could not be pushed: Permission denied (publickey)',
  since: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
}

describe('ProjectErrorBanner (#1500)', () => {
  test('a project with no errors gets no banner at all', () => {
    const { container } = render(<ProjectErrorBanner errors={undefined} />)
    expect(container.textContent).toBe('')
    render(<ProjectErrorBanner errors={[]} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('a data-sync error reads as an alert: headline, the emitter’s own words, and since when (#1599)', () => {
    render(<ProjectErrorBanner errors={[DATA_SYNC]} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Not syncing with the remote')
    expect(alert.textContent).toContain('Permission denied (publickey)')
    expect(alert.textContent).toContain('since 3h ago')
  })
})
