import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { forgetRemembered } from '@openagt/dashboard/module'
import { renderWithHost as render } from './test-host.js'

const readProject = vi.fn(async () => ({}) as unknown)
const readRun = vi.fn(async () => ({ source: 'checkout', changes: {}, merged: false }) as unknown)
const readDiff = vi.fn(async () => null as unknown)
const readCommits = vi.fn(async () => [] as unknown)
const readCommit = vi.fn(async () => null as unknown)
vi.mock('./reads.js', () => ({ readProject, readRun, readDiff, readCommits, readCommit }))

const { ChangesPanel } = await import('./ChangesPanel.js')

const context = { files: new Set<string>(), toggle: () => {} }
const changes = {
  'src/app.ts': { status: 'modified', committed: true },
  'src/new.ts': { status: 'untracked', committed: false },
  'old.txt': { status: 'deleted', committed: true },
}

beforeEach(() => {
  forgetRemembered() // what one test read would show at once in the next
  vi.clearAllMocks()
  readProject.mockResolvedValue({})
  readRun.mockResolvedValue({ source: 'checkout', changes, merged: false })
  readCommits.mockResolvedValue([])
  readCommit.mockResolvedValue(null)
  readDiff.mockResolvedValue({ path: 'src/app.ts', status: 'modified', patch: '@@ -1 +1 @@\n-const b = 2\n+const b = 3', added: 1, removed: 1, truncated: false, binary: false })
})
afterEach(cleanup)

describe('ChangesPanel', () => {
  test('a run’s page lists only the files the run changed, each with what happened to it, and says they are not merged yet', async () => {
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(screen.getByText('What this run changed. Not merged yet.')).toBeTruthy())
    expect(readRun).toHaveBeenCalledWith(expect.anything(), 'p1', 'run-1')
    expect(readProject).not.toHaveBeenCalled()
    expect(within(screen.getByRole('list', { name: 'Changed files' })).getAllByRole('listitem').map(row => row.textContent)).toEqual(['old.txtdeleted', 'src/app.tsmodified', 'src/new.tsnew · not committed'])
    expect(screen.queryByText('README.md')).toBeNull()
  })

  test('the first file is picked by itself and its diff shows beside the list; a click on another file shows that one', async () => {
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    const first = await screen.findByRole('button', { name: /old\.txt/ })
    expect(first.getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(readDiff).toHaveBeenCalledWith(expect.anything(), 'p1', 'old.txt', 'run-1', undefined))
    expect(readDiff).toHaveBeenCalledTimes(1)
    const row = screen.getByRole('button', { name: /app\.ts/ })
    expect(row.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(row)
    await waitFor(() => expect(readDiff).toHaveBeenCalledWith(expect.anything(), 'p1', 'src/app.ts', 'run-1', undefined))
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(first.getAttribute('aria-pressed')).toBe('false')
    await waitFor(() => expect(screen.getByText(/const b = 3/)).toBeTruthy())
  })

  test('when the picked file leaves the list, the first file is picked again', async () => {
    const { rerender } = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} activity={1} />)
    fireEvent.click(await screen.findByRole('button', { name: /new\.ts/ }))
    readRun.mockResolvedValue({ source: 'checkout', changes: { 'src/app.ts': changes['src/app.ts'], 'old.txt': changes['old.txt'] }, merged: false })
    rerender(<ChangesPanel projectId="p1" agentId="run-1" context={context} activity={2} />)
    await waitFor(() => expect(screen.queryByRole('button', { name: /new\.ts/ })).toBeNull())
    expect(screen.getByRole('button', { name: /old\.txt/ }).getAttribute('aria-pressed')).toBe('true')
  })

  test('a click counts for the run it was made on: another run with the same file starts at its own first file', async () => {
    const { rerender } = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    fireEvent.click(await screen.findByRole('button', { name: /app\.ts/ }))
    rerender(<ChangesPanel projectId="p1" agentId="run-2" context={context} />)
    await waitFor(() => expect(readRun).toHaveBeenCalledWith(expect.anything(), 'p1', 'run-2'))
    await waitFor(() => expect(screen.getByRole('button', { name: /old\.txt/ }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByRole('button', { name: /app\.ts/ }).getAttribute('aria-pressed')).toBe('false')
  })

  test('a merged run keeps its list, and says it is merged', async () => {
    readRun.mockResolvedValue({ source: 'landed', changes: { 'src/app.ts': { status: 'modified', committed: true } }, merged: true })
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(screen.getByText('What this run changed. Merged.')).toBeTruthy())
    expect(screen.getByRole('button', { name: /app\.ts/ })).toBeTruthy()
  })

  test('a run that changed nothing, a run whose changes are gone, and a run still being read each say so in one line', async () => {
    readRun.mockResolvedValue({ source: 'unchanged', changes: {} })
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(screen.getByText('This run changed no files.')).toBeTruthy())
    cleanup()
    readRun.mockResolvedValue({ source: 'gone' })
    render(<ChangesPanel projectId="p1" agentId="run-2" context={context} />)
    await waitFor(() => expect(screen.getByText(/gone from this machine/)).toBeTruthy())
    cleanup()
    readRun.mockResolvedValue({ source: 'pending' })
    render(<ChangesPanel projectId="p1" agentId="run-3" context={context} />)
    await waitFor(() => expect(readRun).toHaveBeenCalledWith(expect.anything(), 'p1', 'run-3'))
    expect(screen.getByText('Looking for this run’s changes…')).toBeTruthy()
  })

  test('the project’s own page lists what is changed in its folder and not committed, or says nothing is', async () => {
    readProject.mockResolvedValue({ 'README.md': { status: 'modified', committed: false } })
    render(<ChangesPanel projectId="p1" context={context} />)
    await waitFor(() => expect(screen.getByText('Changed in the project’s folder, not committed.')).toBeTruthy())
    expect(readRun).not.toHaveBeenCalled()
    await waitFor(() => expect(readDiff).toHaveBeenCalledWith(expect.anything(), 'p1', 'README.md', undefined, undefined))
    cleanup()
    readProject.mockResolvedValue({})
    render(<ChangesPanel projectId="p2" context={context} />)
    await waitFor(() => expect(screen.getByText('Nothing is changed in the project’s folder.')).toBeTruthy())
  })
})

describe('ChangesPanel remembered', () => {
  test('opened again for the same run, the pane shows what was read last at once, with no "Looking…" line, and reads again', async () => {
    const first = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(screen.getByText('What this run changed. Not merged yet.')).toBeTruthy())
    first.unmount()
    // The read is out and does not answer: the list is there all the same.
    readRun.mockReturnValue(new Promise(() => {}) as never)
    readCommits.mockReturnValue(new Promise(() => {}) as never)
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    expect(screen.queryByText('Looking for this run’s changes…')).toBeNull()
    expect(screen.getByText('What this run changed. Not merged yet.')).toBeTruthy()
    expect(readRun).toHaveBeenCalledTimes(2)
  })

  test('a run never seen shows the "Looking…" line until its own read answers: never another run’s list', async () => {
    const first = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(screen.getByText('What this run changed. Not merged yet.')).toBeTruthy())
    first.unmount()
    readRun.mockReturnValue(new Promise(() => {}) as never)
    render(<ChangesPanel projectId="p1" agentId="run-2" context={context} />)
    // Its commits have answered; its files have not.
    await waitFor(() => expect(readCommits).toHaveBeenCalledWith(expect.anything(), 'p1', 'run-2'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByText('Looking for this run’s changes…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /app\.ts/ })).toBeNull()
  })
})

describe('ChangesPanel commits', () => {
  const NEW = { sha: 'b'.repeat(40), short: 'bbbbbbb', subject: 'Change the app', author: 'Agent', date: new Date(Date.now() - 2 * 3_600_000).toISOString() }
  const OLD = { sha: 'a'.repeat(40), short: 'aaaaaaa', subject: 'Add old.txt', author: 'Agent', date: new Date(Date.now() - 3 * 3_600_000).toISOString() }
  const commitRows = () => within(screen.getByRole('region', { name: 'Commits' })).getAllByRole('button')

  beforeEach(() => {
    readCommits.mockResolvedValue([NEW, OLD])
    readCommit.mockResolvedValue({ 'src/app.ts': { status: 'modified', committed: true } })
  })

  test('the run’s commits are under the file list, newest first, with "All changes" above them and picked', async () => {
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(commitRows()).toHaveLength(3))
    expect(readCommits).toHaveBeenCalledWith(expect.anything(), 'p1', 'run-1')
    expect(commitRows().map(row => row.textContent)).toEqual(['All changes', 'Change the appbbbbbbb · Agent · 2h ago', 'Add old.txtaaaaaaa · Agent · 3h ago'])
    expect(commitRows().map(row => row.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    expect(screen.getByRole('region', { name: 'Commits' }).textContent).toContain('Commits2')
    expect(readCommit).not.toHaveBeenCalled()
  })

  test('a click on a commit shows only that commit: its name, its files, its own diff; "All changes" goes back', async () => {
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(commitRows()).toHaveLength(3))
    fireEvent.click(commitRows()[1]!)
    await waitFor(() => expect(readCommit).toHaveBeenCalledWith(expect.anything(), 'p1', 'run-1', NEW.sha))
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Changed files' })).getAllByRole('listitem').map(row => row.textContent)).toEqual(['src/app.tsmodified']))
    expect(screen.getByText('bbbbbbb Change the app')).toBeTruthy()
    expect(screen.queryByText('What this run changed. Not merged yet.')).toBeNull()
    await waitFor(() => expect(readDiff).toHaveBeenCalledWith(expect.anything(), 'p1', 'src/app.ts', 'run-1', NEW.sha))
    expect(commitRows().map(row => row.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])

    fireEvent.click(commitRows()[0]!)
    await waitFor(() => expect(screen.getByText('What this run changed. Not merged yet.')).toBeTruthy())
    expect(within(screen.getByRole('list', { name: 'Changed files' })).getAllByRole('listitem')).toHaveLength(3)
    await waitFor(() => expect(readDiff).toHaveBeenLastCalledWith(expect.anything(), 'p1', 'old.txt', 'run-1', undefined))
  })

  test('a picked commit that is no longer one of the run’s gives way to "All changes"', async () => {
    const { rerender } = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} activity={1} />)
    await waitFor(() => expect(commitRows()).toHaveLength(3))
    fireEvent.click(commitRows()[2]!)
    await waitFor(() => expect(screen.getByText('aaaaaaa Add old.txt')).toBeTruthy())
    readCommits.mockResolvedValue([NEW])
    rerender(<ChangesPanel projectId="p1" agentId="run-1" context={context} activity={2} />)
    await waitFor(() => expect(commitRows()).toHaveLength(2))
    expect(screen.getByText('What this run changed. Not merged yet.')).toBeTruthy()
    expect(commitRows()[0]!.getAttribute('aria-pressed')).toBe('true')
  })

  test('commits that leave no change still show, and the place of the diff says they cancel out', async () => {
    readRun.mockResolvedValue({ source: 'checkout', changes: {}, merged: false })
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(commitRows()).toHaveLength(3))
    expect(screen.getByText('No change is left: the commits cancel out.')).toBeTruthy()
    expect(screen.queryByText('This run changed no files.')).toBeNull()
  })

  test('while the run’s files move as it ends, the commits last read stay, and so does the picked commit', async () => {
    const { rerender } = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} activity={1} />)
    await waitFor(() => expect(commitRows()).toHaveLength(3))
    fireEvent.click(commitRows()[1]!)
    await waitFor(() => expect(screen.getByText('bbbbbbb Change the app')).toBeTruthy())
    readRun.mockResolvedValue({ source: 'pending' })
    readCommits.mockResolvedValue([])
    rerender(<ChangesPanel projectId="p1" agentId="run-1" context={context} activity={2} />)
    await waitFor(() => expect(readCommits).toHaveBeenCalledTimes(2))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(commitRows()).toHaveLength(3)
    expect(screen.getByText('bbbbbbb Change the app')).toBeTruthy()
  })

  test('"This run changed no files." is not said before the commits are read', async () => {
    readRun.mockResolvedValue({ source: 'checkout', changes: {}, merged: false })
    let answer: (commits: unknown) => void = () => {}
    readCommits.mockReturnValue(new Promise(resolve => (answer = resolve)) as never)
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(readRun).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.queryByText('This run changed no files.')).toBeNull()
    expect(screen.getByText('Looking for this run’s changes…')).toBeTruthy()
    answer([NEW])
    await waitFor(() => expect(screen.getByText('No change is left: the commits cancel out.')).toBeTruthy())
  })

  test('the project’s own page reads and shows no commits', async () => {
    readProject.mockResolvedValue({ 'README.md': { status: 'modified', committed: false } })
    render(<ChangesPanel projectId="p1" context={context} />)
    await waitFor(() => expect(screen.getByText('Changed in the project’s folder, not committed.')).toBeTruthy())
    expect(readCommits).not.toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Commits' })).toBeNull()
  })
})

// A changed file asked for from the chat (the row of a file at the end of a turn).
describe('ChangesPanel, a file asked for from the chat', () => {
  // Each ask is later than every one before it, across the tests too.
  let asks = 1000
  const ask = (path: string) => ({ path, at: ++asks })
  const pressed = () => screen.getAllByRole('button').filter(row => row.getAttribute('aria-pressed') === 'true').map(row => row.textContent)

  test('the file asked for is the one picked, not the first; a later click in the list stands; a new ask picks again', async () => {
    const first = ask('src/app.ts')
    const { rerender } = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={first} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /app\.ts/ }).getAttribute('aria-pressed')).toBe('true'))
    await waitFor(() => expect(readDiff).toHaveBeenCalledWith(expect.anything(), 'p1', 'src/app.ts', 'run-1', undefined))
    fireEvent.click(screen.getByRole('button', { name: /new\.ts/ }))
    rerender(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={first} activity={1} />)
    expect(screen.getByRole('button', { name: /new\.ts/ }).getAttribute('aria-pressed')).toBe('true')
    rerender(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={ask('src/app.ts')} activity={1} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /app\.ts/ }).getAttribute('aria-pressed')).toBe('true'))
  })

  test('an ask already taken is not taken again by a pane opened later', async () => {
    const taken = ask('src/app.ts')
    const first = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={taken} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /app\.ts/ }).getAttribute('aria-pressed')).toBe('true'))
    first.unmount()
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={taken} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /old\.txt/ }).getAttribute('aria-pressed')).toBe('true'))
  })

  test('with a commit picked, the ask goes back to "All changes" and picks the file there', async () => {
    const commit = { sha: 'b'.repeat(40), short: 'bbbbbbb', subject: 'Change the app', at: '2026-10-04T10:00:00.000Z' }
    readCommits.mockResolvedValue([commit])
    readCommit.mockResolvedValue({ 'src/app.ts': { status: 'modified', committed: true } })
    const { rerender } = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    fireEvent.click(await screen.findByRole('button', { name: /Change the app/ }))
    await waitFor(() => expect(screen.queryByText('What this run changed. Not merged yet.')).toBeNull())
    rerender(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={ask('src/new.ts')} />)
    await waitFor(() => expect(screen.getByText('What this run changed. Not merged yet.')).toBeTruthy())
    expect(pressed().some(text => text?.includes('src/new.ts'))).toBe(true)
  })

  test('a file asked for that the list does not hold leaves the first file picked', async () => {
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={ask('gone.md')} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /old\.txt/ }).getAttribute('aria-pressed')).toBe('true'))
  })

  test('a file asked for by its whole path on disk is the listed file that path ends with', async () => {
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={ask('/repo/.branches/agent-1/src/app.ts')} />)
    await waitFor(() => expect(screen.getByRole('button', { name: /app\.ts/ }).getAttribute('aria-pressed')).toBe('true'))
  })
})
