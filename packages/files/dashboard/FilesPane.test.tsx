import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '@openagt/dashboard/module'
import { renderWithHost as render } from './test-host.js'

const readProject = vi.fn(async () => [] as unknown)
const readTree = vi.fn(async () => ({ source: 'checkout', files: [] }) as unknown)
const readContent = vi.fn(async (_host: unknown, _projectId: string, path: string) => ({ path, text: `the text of ${path}`, truncated: false, binary: false }) as unknown)
vi.mock('./reads.js', () => ({ readProject, readTree, readContent }))

const { FilesPane } = await import('./FilesPane.js')
const { forgetOpenFiles } = await import('./open-files.js')

/** The Context with these files in it; toggling one calls `toggle`. */
const context = (files: string[] = [], toggle: (path: string) => void = () => {}) => ({ files: new Set(files), toggle })
/** A folder's clickable row. */
const folder = (name: string) => screen.getByText(name).closest('summary')!
/** The header's tabs: name, shown, preview or kept. */
const tabs = () => screen.queryAllByRole('tab').map(tab => [tab.textContent, tab.getAttribute('aria-selected'), tab.querySelector('.italic') ? 'preview' : 'kept'])
const files = ['src/app.ts', 'README.md']

beforeEach(() => {
  forgetRemembered() // what one test read would show at once in the next
  forgetOpenFiles()
  vi.clearAllMocks()
  readProject.mockResolvedValue(files)
  readTree.mockResolvedValue({ source: 'checkout', files })
})
afterEach(cleanup)

// The tree's own region, for queries that must not meet the header's tabs.
const treeOf = () => screen.getByLabelText('Filter files').closest('div.flex-col') as HTMLElement
const fileRow = (path: string) => within(treeOf()).getByTitle(path)

describe('the Files pane’s reads (#815)', () => {
  test('the project home reads the project checkout', async () => {
    render(<FilesPane projectId="p1" context={context()} />)
    await waitFor(() => expect(readProject).toHaveBeenCalledWith(expect.anything(), 'p1'))
    expect(readTree).not.toHaveBeenCalled()
  })

  test("a session's tree is the session's own, not the project's", async () => {
    readTree.mockResolvedValue({ source: 'checkout', files: ['only-in-run.ts'] })
    render(<FilesPane projectId="p1" agentId="run-1" context={context()} />)
    await waitFor(() => expect(screen.getByText('only-in-run.ts')).toBeTruthy())
    expect(readTree).toHaveBeenCalledWith(expect.anything(), 'p1', 'run-1')
    expect(readProject).not.toHaveBeenCalled()
    expect(screen.queryByText('README.md')).toBeNull()
  })

  test('opened again for the same run, the tree is there at once, with no "Looking…" line, while it is read again', async () => {
    readTree.mockResolvedValue({ source: 'checkout', files: ['notes.md'] })
    const first = render(<FilesPane projectId="p1" agentId="run-1" context={context()} />)
    await waitFor(() => expect(screen.getByText('notes.md')).toBeTruthy())
    first.unmount()
    readTree.mockReturnValue(new Promise(() => {}) as never)
    render(<FilesPane projectId="p1" agentId="run-1" context={context()} />)
    expect(screen.queryByText('Looking for this run’s files…')).toBeNull()
    expect(screen.getByText('notes.md')).toBeTruthy()
  })

  test('switching session re-reads, rather than keeping the previous one’s tree', async () => {
    const { rerender } = render(<FilesPane projectId="p1" agentId="run-1" context={context()} />)
    await waitFor(() => expect(readTree).toHaveBeenCalledWith(expect.anything(), 'p1', 'run-1'))
    rerender(<FilesPane projectId="p1" agentId="run-2" context={context()} />)
    await waitFor(() => expect(readTree).toHaveBeenCalledWith(expect.anything(), 'p1', 'run-2'))
  })

  test('no file is marked changed, and a run’s tree says where it was read from', async () => {
    render(<FilesPane projectId="p1" agentId="run-1" context={context()} />)
    await waitFor(() => expect(screen.getByText('From the run’s checkout')).toBeTruthy())
    expect(fileRow('README.md').textContent).toBe('README.md')
  })

  test('a finished run with no checkout is read from its branch, then its merge, and says which', async () => {
    readTree.mockResolvedValue({ source: 'branch', branch: 'agent-fix', files })
    const { rerender } = render(<FilesPane projectId="p1" agentId="run-1" context={context()} />)
    await waitFor(() => expect(screen.getByText('From branch agent-fix')).toBeTruthy())
    readTree.mockResolvedValue({ source: 'merge', number: 42, files })
    rerender(<FilesPane projectId="p1" agentId="run-2" context={context()} />)
    await waitFor(() => expect(screen.getByText('From the merge of #42')).toBeTruthy())
  })

  test('a run that changed nothing shows the project’s files, and says so in the caption', async () => {
    readTree.mockResolvedValue({ source: 'unchanged', files })
    render(<FilesPane projectId="p1" agentId="run-1" context={context()} />)
    await waitFor(() => expect(screen.getByText('This run changed no files')).toBeTruthy())
    expect(screen.getByText('README.md')).toBeTruthy()
    expect(screen.queryByText(/gone from this machine/)).toBeNull()
  })

  test('a run that is starting says so, and is read again within seconds until its checkout is there', async () => {
    readTree.mockResolvedValue({ source: 'pending' })
    render(<FilesPane projectId="p1" agentId="run-1" context={context()} />)
    await waitFor(() => expect(screen.getByText('Looking for this run’s files…')).toBeTruthy())
    readTree.mockResolvedValue({ source: 'checkout', files: ['made-by-run.ts'] })
    // Well before the 8s poll: the starting run's own, sooner read.
    await waitFor(() => expect(screen.getByText('made-by-run.ts')).toBeTruthy(), { timeout: 3_000 })
  })

  test('a run starting here shows the project’s files, captioned so, until its checkout is there', async () => {
    readTree.mockResolvedValue({ source: 'starting', files })
    render(<FilesPane projectId="p1" agentId="run-1" context={context()} />)
    await waitFor(() => expect(screen.getByText('Starting from the project’s files')).toBeTruthy())
    expect(screen.getByText('README.md')).toBeTruthy()
    readTree.mockResolvedValue({ source: 'checkout', files: ['made-by-run.ts'] })
    await waitFor(() => expect(screen.getByText('made-by-run.ts')).toBeTruthy(), { timeout: 3_000 })
  })

  test('the agent doing something reads the tree again at once, not on the next poll', async () => {
    const { rerender } = render(<FilesPane projectId="p1" agentId="run-1" activity={3} context={context()} />)
    await waitFor(() => expect(screen.getByText('README.md')).toBeTruthy())
    readTree.mockResolvedValue({ source: 'checkout', files: [...files, 'hello.txt'] })
    rerender(<FilesPane projectId="p1" agentId="run-1" activity={4} context={context()} />)
    await waitFor(() => expect(screen.getByText('hello.txt')).toBeTruthy(), { timeout: 1_500 })
  })

  test('a run whose files are moving (pending after a tree) keeps showing the tree it had, never a blank', async () => {
    readTree.mockResolvedValue({ source: 'checkout', files: [...files, 'hello.txt'] })
    const { rerender } = render(<FilesPane projectId="p1" agentId="run-1" activity={1} context={context()} />)
    await waitFor(() => expect(screen.getByText('hello.txt')).toBeTruthy())
    readTree.mockResolvedValue({ source: 'pending' })
    rerender(<FilesPane projectId="p1" agentId="run-1" activity={2} context={context()} />)
    await waitFor(() => expect(readTree.mock.calls.length).toBeGreaterThan(1))
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(screen.getByText('hello.txt')).toBeTruthy()
    expect(screen.queryByText('Looking for this run’s files…')).toBeNull()
  })

  test('a run whose files are gone says so, instead of showing the project’s own', async () => {
    readTree.mockResolvedValue({ source: 'gone' })
    render(<FilesPane projectId="p1" agentId="run-1" context={context()} />)
    await waitFor(() => expect(screen.getByText(/This run’s files are gone from this machine/)).toBeTruthy())
    expect(screen.queryByText('README.md')).toBeNull()
  })

  test('a folder’s contents are built only while it is open', async () => {
    // A repository's whole tree was ~18,000 page elements, closed folders included: the tab was
    // slow to open and every re-render of the page walked all of it.
    readProject.mockResolvedValue(['src/app.ts', 'src/lib/util.ts'])
    render(<FilesPane projectId="p1" context={context()} />)
    await waitFor(() => expect(folder('src')).toBeTruthy())
    expect(screen.queryByText('app.ts')).toBeNull()
    expect(screen.queryByText('lib')).toBeNull()
    fireEvent.click(folder('src'))
    await waitFor(() => expect(screen.getByText('app.ts')).toBeTruthy())
    expect(screen.queryByText('util.ts')).toBeNull()
    fireEvent.click(folder('src'))
    await waitFor(() => expect(screen.queryByText('app.ts')).toBeNull())
  })
})

describe('opening files, as Claude Code on the web does', () => {
  test('with no file open, the header says "Files" and the right side says where files appear', async () => {
    render(<FilesPane projectId="p1" context={context()} />)
    await screen.findByText('README.md')
    expect(within(screen.getByTestId('pane-title')).getByText('Files')).toBeTruthy()
    expect(screen.getByText('Open files appear here')).toBeTruthy()
    expect(within(screen.getByTestId('pane-actions')).getByLabelText('Search files')).toBeTruthy()
  })

  test('one click opens a file as a preview, in italics; the next click takes its place; a double click keeps it', async () => {
    render(<FilesPane projectId="p1" context={context()} />)
    fireEvent.click(await screen.findByTitle('README.md'))
    await waitFor(() => expect(screen.getByText('the text of README.md')).toBeTruthy())
    expect(readContent).toHaveBeenCalledWith(expect.anything(), 'p1', 'README.md', undefined)
    expect(tabs()).toEqual([['README.md', 'true', 'preview']])
    expect(within(screen.getByTestId('pane-title')).queryByText('Files')).toBeNull()
    fireEvent.click(folder('src'))
    fireEvent.click(await within(treeOf()).findByTitle('src/app.ts'))
    await waitFor(() => expect(tabs()).toEqual([['app.ts', 'true', 'preview']]))
    fireEvent.doubleClick(fileRow('src/app.ts'))
    fireEvent.click(fileRow('README.md'))
    await waitFor(() => expect(tabs()).toEqual([['app.ts', 'false', 'kept'], ['README.md', 'true', 'preview']]))
  })

  test('a click no longer touches the Context', async () => {
    const toggle = vi.fn()
    render(<FilesPane projectId="p1" context={context([], toggle)} />)
    fireEvent.click(await screen.findByTitle('README.md'))
    expect(toggle).not.toHaveBeenCalled()
  })

  test('a tab shows its file, and its cross closes it, the tab beside it shown then', async () => {
    render(<FilesPane projectId="p1" context={context()} />)
    fireEvent.doubleClick(await screen.findByTitle('README.md'))
    fireEvent.click(folder('src'))
    fireEvent.doubleClick(await within(treeOf()).findByTitle('src/app.ts'))
    await waitFor(() => expect(tabs()).toEqual([['README.md', 'false', 'kept'], ['app.ts', 'true', 'kept']]))
    fireEvent.click(within(screen.getAllByRole('tab')[0]!).getByTitle('README.md'))
    await waitFor(() => expect(screen.getByText('the text of README.md')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('Close README.md'))
    await waitFor(() => expect(tabs()).toEqual([['app.ts', 'true', 'kept']]))
    fireEvent.click(screen.getByLabelText('Close app.ts'))
    await waitFor(() => expect(screen.getByText('Open files appear here')).toBeTruthy())
  })

  test('the button in the header hides the tree, and the file fills the pane', async () => {
    render(<FilesPane projectId="p1" context={context()} />)
    fireEvent.click(await screen.findByTitle('README.md'))
    fireEvent.click(screen.getByLabelText('Hide the file tree'))
    await waitFor(() => expect(screen.queryByLabelText('Filter files')).toBeNull())
    expect(screen.getByText('the text of README.md')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Show the file tree'))
    await waitFor(() => expect(screen.getByLabelText('Filter files')).toBeTruthy())
  })

  test('a Markdown file is shown rendered, and a button shows its source', async () => {
    readContent.mockResolvedValue({ path: 'README.md', text: '# Hello\n\nSome **bold** words.', truncated: false, binary: false })
    render(<FilesPane projectId="p1" context={context()} />)
    fireEvent.click(await screen.findByTitle('README.md'))
    await waitFor(() => expect(screen.getByText('bold').tagName).toBe('STRONG'))
    expect(screen.queryByText('# Hello')).toBeNull()
    fireEvent.click(screen.getByLabelText('Show the source'))
    await waitFor(() => expect(screen.getByText('# Hello')).toBeTruthy())
    expect(screen.queryByText('bold')).toBeNull()
    fireEvent.click(screen.getByLabelText('Show it rendered'))
    await waitFor(() => expect(screen.getByText('bold').tagName).toBe('STRONG'))
  })

  test('a right click on a file attaches it to the Context, and a file in it is ticked', async () => {
    const toggle = vi.fn()
    const { rerender } = render(<FilesPane projectId="p1" context={context([], toggle)} />)
    fireEvent.contextMenu(await screen.findByTitle('README.md'))
    fireEvent.click(await screen.findByText('Attach as context'))
    expect(toggle).toHaveBeenCalledWith('README.md')
    rerender(<FilesPane projectId="p1" context={context(['README.md'], toggle)} />)
    expect(within(fileRow('README.md')).getByLabelText('In the Context')).toBeTruthy()
    fireEvent.contextMenu(fileRow('README.md'))
    expect(await screen.findByText('Remove from context')).toBeTruthy()
  })

  test('the right-click menu copies a file’s path or its name', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<FilesPane projectId="p1" context={context()} />)
    await screen.findByText('src')
    fireEvent.click(folder('src'))
    fireEvent.contextMenu(await within(treeOf()).findByTitle('src/app.ts'))
    fireEvent.click(await screen.findByText('Copy'))
    fireEvent.click(await screen.findByText('Relative path'))
    expect(writeText).toHaveBeenCalledWith('src/app.ts')
    fireEvent.contextMenu(fileRow('src/app.ts'))
    fireEvent.click(await screen.findByText('Copy'))
    fireEvent.click(await screen.findByText('Filename'))
    expect(writeText).toHaveBeenCalledWith('app.ts')
  })

  test('search finds a file by its name and opens it', async () => {
    render(<FilesPane projectId="p1" context={context()} />)
    await screen.findByText('README.md')
    fireEvent.click(screen.getByLabelText('Search files'))
    const box = await screen.findByPlaceholderText('Search files')
    fireEvent.change(box, { target: { value: 'app' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(tabs()).toEqual([['app.ts', 'true', 'preview']]))
  })

  test('with previews off in the ⋮ menu, one click keeps the file', async () => {
    render(<FilesPane projectId="p1" context={context()} />)
    await screen.findByText('README.md')
    fireEvent.click(screen.getByLabelText('The pane’s settings'))
    fireEvent.click(await screen.findByText('Preview tabs'))
    fireEvent.click(screen.getByTitle('README.md'))
    await waitFor(() => expect(tabs()).toEqual([['README.md', 'true', 'kept']]))
  })

  test('on a run’s page the run’s copy is read, and the file shows with its lines numbered', async () => {
    render(<FilesPane projectId="p1" agentId="run-1" context={context()} />)
    fireEvent.click(await screen.findByTitle('README.md'))
    await waitFor(() => expect(readContent).toHaveBeenCalledWith(expect.anything(), 'p1', 'README.md', 'run-1'))
    readContent.mockResolvedValue({ path: 'a.ts', text: 'const a = 1\nconst b = 2', truncated: false, binary: false })
    fireEvent.click(folder('src'))
    fireEvent.click(await within(treeOf()).findByTitle('src/app.ts'))
    await waitFor(() => expect(screen.getByText('const b = 2')).toBeTruthy())
    expect(screen.getByText('2')).toBeTruthy()
  })

  test('nothing is read before a file is opened', async () => {
    render(<FilesPane projectId="p1" context={context()} />)
    await screen.findByText('README.md')
    expect(readContent).not.toHaveBeenCalled()
  })

  test('an empty, a binary, a cut and a missing file each say so, rendered Markdown too', async () => {
    const say = async (content: unknown, path: string, words: string) => {
      readContent.mockResolvedValue(content)
      render(<FilesPane projectId="p1" context={context()} />)
      fireEvent.click(await screen.findByTitle(path))
      await waitFor(() => expect(screen.getByText(words)).toBeTruthy())
      cleanup()
      forgetRemembered()
      forgetOpenFiles()
    }
    await say({ path: 'README.md', text: '', truncated: false, binary: false }, 'README.md', 'Empty file.')
    await say({ path: 'README.md', text: '', truncated: false, binary: true }, 'README.md', 'Binary file, nothing to show.')
    await say({ path: 'README.md', text: '# Long', truncated: true, binary: false }, 'README.md', 'Cut here. The rest is in the worktree.')
    await say(null, 'README.md', 'This file is not here: it was deleted or moved, or it cannot be read.')
  })

  test('a failed read is not an unhandled rejection: the file is still being read', async () => {
    readContent.mockRejectedValue(new Error('daemon restarted'))
    render(<FilesPane projectId="p1" context={context()} />)
    fireEvent.click(await screen.findByTitle('README.md'))
    await waitFor(() => expect(readContent).toHaveBeenCalled())
    expect(screen.getByText('Reading the file…')).toBeTruthy()
  })

  test('a tab shown again shows its file at once, and a Markdown file shown as its source stays so', async () => {
    readContent.mockImplementation(async (_host: unknown, _projectId: string, path: string) => ({ path, text: path === 'README.md' ? '# Hello\n\nSome **bold** words.' : 'const a = 1', truncated: false, binary: false }))
    render(<FilesPane projectId="p1" context={context()} />)
    fireEvent.doubleClick(await screen.findByTitle('README.md'))
    fireEvent.click(await screen.findByLabelText('Show the source'))
    fireEvent.click(folder('src'))
    fireEvent.doubleClick(await within(treeOf()).findByTitle('src/app.ts'))
    await waitFor(() => expect(screen.getByText('const a = 1')).toBeTruthy())
    readContent.mockReturnValue(new Promise(() => {}) as never)
    fireEvent.click(within(screen.getAllByRole('tab')[0]!).getByTitle('README.md'))
    expect(screen.queryByText('Reading the file…')).toBeNull()
    expect(screen.getByText('# Hello')).toBeTruthy()
  })

  test('closing the last tab while it is shown shows the one before it', async () => {
    render(<FilesPane projectId="p1" context={context()} />)
    fireEvent.doubleClick(await screen.findByTitle('README.md'))
    fireEvent.click(folder('src'))
    fireEvent.doubleClick(await within(treeOf()).findByTitle('src/app.ts'))
    fireEvent.click(screen.getByLabelText('Close app.ts'))
    await waitFor(() => expect(tabs()).toEqual([['README.md', 'true', 'kept']]))
  })

  test('each page has its own tabs', async () => {
    const { rerender } = render(<FilesPane projectId="p1" agentId="run-1" context={context()} />)
    fireEvent.doubleClick(await screen.findByTitle('README.md'))
    await waitFor(() => expect(tabs()).toEqual([['README.md', 'true', 'kept']]))
    rerender(<FilesPane projectId="p1" agentId="run-2" context={context()} />)
    await waitFor(() => expect(tabs()).toEqual([]))
    rerender(<FilesPane projectId="p1" agentId="run-1" context={context()} />)
    await waitFor(() => expect(tabs()).toEqual([['README.md', 'true', 'kept']]))
  })

  test('Shift+F10 on a focused file opens its right-click menu', async () => {
    render(<FilesPane projectId="p1" context={context()} />)
    fireEvent.keyDown(await screen.findByTitle('README.md'), { key: 'F10', shiftKey: true })
    expect(await screen.findByText('Attach as context')).toBeTruthy()
  })
})
