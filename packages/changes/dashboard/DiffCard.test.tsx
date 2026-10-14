import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { renderWithHost as render } from './test-host.js'

const readDiff = vi.fn(async () => null as unknown)
vi.mock('./reads.js', () => ({ readDiff }))

const { DiffCard } = await import('./DiffCard.js')

const DIFF = {
  path: 'src/a.ts',
  status: 'modified',
  patch: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-const b = 2\n+const b = 3',
  added: 1,
  removed: 1,
  truncated: false,
  binary: false,
}

beforeEach(() => {
  readDiff.mockClear()
  readDiff.mockResolvedValue(DIFF)
})
afterEach(cleanup)

describe('DiffCard (#816)', () => {
  test("reads the selected run's worktree and renders the diff", async () => {
    render(<DiffCard projectId="p1" agentId="run-1" path="src/a.ts" />)
    await waitFor(() => expect(readDiff).toHaveBeenCalledWith(expect.anything(), 'p1', 'src/a.ts', 'run-1', undefined))
    await waitFor(() => expect(screen.getByText('+const b = 3')).toBeTruthy())
    expect(screen.getByText('-const b = 2')).toBeTruthy()
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('−1')).toBeTruthy()
  })

  test('on the project home it reads the project checkout', async () => {
    render(<DiffCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(readDiff).toHaveBeenCalledWith(expect.anything(), 'p1', 'src/a.ts', undefined, undefined))
  })

  test('a file with nothing to show says so instead of sitting on the spinner', async () => {
    readDiff.mockResolvedValue(null)
    render(<DiffCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(screen.getByText('No change to show.')).toBeTruthy())
  })

  test('a failed read is not an unhandled rejection', async () => {
    readDiff.mockRejectedValue(new Error('daemon restarted'))
    render(<DiffCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(readDiff).toHaveBeenCalled())
    expect(screen.getByText('Reading the diff…')).toBeTruthy()
  })

  test('a binary file says so rather than rendering bytes', async () => {
    readDiff.mockResolvedValue({ ...DIFF, path: 'logo.png', patch: '', added: 0, removed: 0, binary: true })
    render(<DiffCard projectId="p1" path="logo.png" />)
    await waitFor(() => expect(screen.getByText('Binary file, nothing to show.')).toBeTruthy())
  })

  test('a cut diff says it was cut', async () => {
    readDiff.mockResolvedValue({ ...DIFF, truncated: true })
    render(<DiffCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(screen.getByText('Cut here. The rest is in the worktree.')).toBeTruthy())
  })
})
