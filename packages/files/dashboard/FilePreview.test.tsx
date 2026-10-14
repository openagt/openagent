import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { renderWithHost as render } from './test-host.js'

const readContent = vi.fn(async () => null as unknown)
vi.mock('./reads.js', () => ({ readContent }))

const { FilePreviewCard, FilePreviewHover } = await import('./FilePreview.js')

beforeEach(() => {
  readContent.mockClear()
  readContent.mockResolvedValue({ path: 'src/a.ts', text: 'const a = 1\nconst b = 2', truncated: false, binary: false })
})
afterEach(cleanup)

describe('FilePreviewHover (#828)', () => {
  test('nothing is read until the card opens', () => {
    render(
      <FilePreviewHover projectId="p1" agentId="run-1" path="src/a.ts">
        <span>a.ts</span>
      </FilePreviewHover>,
    )
    // A closed PreviewCard does not mount its popup, and the tree renders one of these per file.
    // Fetching on mount would be a read per file for files nobody asked to see.
    expect(readContent).not.toHaveBeenCalled()
  })
})

describe('FilePreviewCard (#828)', () => {
  test('reads the selected run’s copy of the file, and numbers the lines', async () => {
    render(<FilePreviewCard projectId="p1" agentId="run-1" path="src/a.ts" />)
    await waitFor(() => expect(readContent).toHaveBeenCalledWith(expect.anything(), 'p1', 'src/a.ts', 'run-1'))
    await waitFor(() => expect(screen.getByText('const a = 1')).toBeTruthy())
    expect(screen.getByText('const b = 2')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()
    expect(screen.getByText('2')).toBeTruthy()
  })

  test('on the project home it reads the project folder’s file', async () => {
    render(<FilePreviewCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(readContent).toHaveBeenCalledWith(expect.anything(), 'p1', 'src/a.ts', undefined))
  })

  test('a failed read is not an unhandled rejection', async () => {
    readContent.mockRejectedValue(new Error('daemon restarted'))
    render(<FilePreviewCard projectId="p1" path="src/a.ts" />)
    await waitFor(() => expect(readContent).toHaveBeenCalled())
    expect(screen.getByText('Reading the file…')).toBeTruthy()
  })

  test('an empty file says so rather than rendering a blank card', async () => {
    readContent.mockResolvedValue({ path: 'empty.ts', text: '', truncated: false, binary: false })
    render(<FilePreviewCard projectId="p1" path="empty.ts" />)
    await waitFor(() => expect(screen.getByText('Empty file.')).toBeTruthy())
  })

  test('a binary file says so rather than rendering bytes', async () => {
    readContent.mockResolvedValue({ path: 'logo.png', text: '', truncated: false, binary: true })
    render(<FilePreviewCard projectId="p1" path="logo.png" />)
    await waitFor(() => expect(screen.getByText('Binary file, nothing to show.')).toBeTruthy())
  })

  test('a file too long to show says it was cut', async () => {
    readContent.mockResolvedValue({ path: 'big.ts', text: 'a\nb', truncated: true, binary: false })
    render(<FilePreviewCard projectId="p1" path="big.ts" />)
    await waitFor(() => expect(screen.getByText('Cut here. The rest is in the worktree.')).toBeTruthy())
  })

  test('an unreadable file says so instead of sitting on the spinner', async () => {
    readContent.mockResolvedValue(null)
    render(<FilePreviewCard projectId="p1" path="gone.ts" />)
    await waitFor(() => expect(screen.getByText('Nothing to show.')).toBeTruthy())
  })
})
