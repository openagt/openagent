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
const { forgetChangesState } = await import('./settings.js')

const context = { files: new Set<string>(), toggle: () => {} }
const changes = {
  'src/app.ts': { status: 'modified', committed: true },
  'src/new.ts': { status: 'untracked', committed: false },
  'old.txt': { status: 'deleted', committed: true },
}

beforeEach(() => {
  forgetRemembered() // what one test read would show at once in the next
  forgetChangesState()
  vi.clearAllMocks()
  readProject.mockResolvedValue({})
  readRun.mockResolvedValue({ source: 'checkout', changes, merged: false, from: 'main', to: 'agent-x' })
  readCommits.mockResolvedValue([])
  readCommit.mockResolvedValue(null)
  readDiff.mockResolvedValue({ path: 'src/app.ts', status: 'modified', patch: '@@ -1 +1 @@\n-const b = 2\n+const b = 3', added: 1, removed: 1, truncated: false, binary: false })
})
afterEach(cleanup)

/** A file's row in the list, by its name. */
const list = () => screen.getByRole('list', { name: 'Changed files' })
const row = (name: RegExp) => within(list()).getByRole('button', { name })
const findRow = async (name: RegExp) => within(await screen.findByRole('list', { name: 'Changed files' })).findByRole('button', { name })
const queryRow = (name: RegExp) => screen.queryByRole('list', { name: 'Changed files' }) && within(list()).queryByRole('button', { name })
const NOT_MERGED = 'main → agent-x'

describe('ChangesPanel', () => {
  test('a run’s page lists only the files the run changed, grouped by folder, and its header says between which branches and that they are not merged yet', async () => {
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(screen.getByTestId('pane-title').textContent).toBe(`${NOT_MERGED}· not merged yet`))
    expect(readRun).toHaveBeenCalledWith(expect.anything(), 'p1', 'run-1')
    expect(readProject).not.toHaveBeenCalled()
    expect(within(list()).getAllByRole('button').map(b => [b.textContent, b.title])).toEqual([
      ['app.ts', 'src/app.ts · modified'],
      ['new.ts', 'src/new.ts · new, not committed'],
      ['old.txt', 'old.txt · deleted'],
    ])
    expect(within(list()).getByText('src')).toBeTruthy()
    expect(screen.queryByText('README.md')).toBeNull()
  })

  test('every file’s diff shows, one under another; the first file is picked; a click on another picks it and scrolls to its diff', async () => {
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    const first = await findRow(/app\.ts/)
    expect(first.getAttribute('aria-pressed')).toBe('true')
    for (const path of ['old.txt', 'src/app.ts', 'src/new.ts']) await waitFor(() => expect(readDiff).toHaveBeenCalledWith(expect.anything(), 'p1', path, 'run-1', undefined, false))
    expect(screen.getAllByRole('region').filter(r => r.closest('[aria-label=Diffs]')).map(r => r.getAttribute('aria-label'))).toEqual(['src/app.ts', 'src/new.ts', 'old.txt'])
    const row = within(list()).getByRole('button', { name: /new\.ts/ })
    expect(row.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(row)
    await waitFor(() => expect(row.getAttribute('aria-pressed')).toBe('true'))
    expect(scrolled.mock.contexts.at(-1)).toBe(screen.getByRole('region', { name: 'src/new.ts' }))
    expect(first.getAttribute('aria-pressed')).toBe('false')
    await waitFor(() => expect(screen.getAllByText('const b = 3').length).toBe(3))
  })

  test('when the picked file leaves the list, the first file is picked again', async () => {
    const { rerender } = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} activity={1} />)
    fireEvent.click(await findRow(/new\.ts/))
    readRun.mockResolvedValue({ source: 'checkout', changes: { 'src/app.ts': changes['src/app.ts'], 'old.txt': changes['old.txt'] }, merged: false })
    rerender(<ChangesPanel projectId="p1" agentId="run-1" context={context} activity={2} />)
    await waitFor(() => expect(queryRow(/new\.ts/)).toBeNull())
    expect(row(/app\.ts/).getAttribute('aria-pressed')).toBe('true')
  })

  test('a click counts for the run it was made on: another run with the same file starts at its own first file', async () => {
    const { rerender } = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    fireEvent.click(await findRow(/new\.ts/))
    rerender(<ChangesPanel projectId="p1" agentId="run-2" context={context} />)
    await waitFor(() => expect(readRun).toHaveBeenCalledWith(expect.anything(), 'p1', 'run-2'))
    await waitFor(() => expect(row(/app\.ts/).getAttribute('aria-pressed')).toBe('true'))
    expect(row(/new\.ts/).getAttribute('aria-pressed')).toBe('false')
  })

  test('a merged run keeps its list, and says it is merged', async () => {
    readRun.mockResolvedValue({ source: 'landed', changes: { 'src/app.ts': { status: 'modified', committed: true } }, merged: true, from: 'main', to: 'agent-x' })
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(screen.getByText('· merged')).toBeTruthy())
    expect(row(/app\.ts/)).toBeTruthy()
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
    await waitFor(() => expect(readDiff).toHaveBeenCalledWith(expect.anything(), 'p1', 'README.md', undefined, undefined, false))
    cleanup()
    readProject.mockResolvedValue({})
    render(<ChangesPanel projectId="p2" context={context} />)
    await waitFor(() => expect(screen.getByText('Nothing is changed in the project’s folder.')).toBeTruthy())
  })
})

describe('ChangesPanel remembered', () => {
  test('opened again for the same run, the pane shows what was read last at once, with no "Looking…" line, and reads again', async () => {
    const first = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(screen.getByText(NOT_MERGED)).toBeTruthy())
    first.unmount()
    // The read is out and does not answer: the list is there all the same.
    readRun.mockReturnValue(new Promise(() => {}) as never)
    readCommits.mockReturnValue(new Promise(() => {}) as never)
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    expect(screen.queryByText('Looking for this run’s changes…')).toBeNull()
    expect(screen.getByText(NOT_MERGED)).toBeTruthy()
    expect(readRun).toHaveBeenCalledTimes(2)
  })

  test('a run never seen shows the "Looking…" line until its own read answers: never another run’s list', async () => {
    const first = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(screen.getByText(NOT_MERGED)).toBeTruthy())
    first.unmount()
    readRun.mockReturnValue(new Promise(() => {}) as never)
    render(<ChangesPanel projectId="p1" agentId="run-2" context={context} />)
    // Its commits have answered; its files have not.
    await waitFor(() => expect(readCommits).toHaveBeenCalledWith(expect.anything(), 'p1', 'run-2'))
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(screen.getByText('Looking for this run’s changes…')).toBeTruthy()
    expect(queryRow(/app\.ts/)).toBeNull()
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
    await waitFor(() => expect(within(list()).getAllByRole('button').map(b => b.textContent)).toEqual(['app.ts']))
    expect(screen.getByText('bbbbbbb Change the app')).toBeTruthy()
        await waitFor(() => expect(readDiff).toHaveBeenCalledWith(expect.anything(), 'p1', 'src/app.ts', 'run-1', NEW.sha, false))
    expect(commitRows().map(row => row.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])

    fireEvent.click(commitRows()[0]!)
    await waitFor(() => expect(screen.getByText(NOT_MERGED)).toBeTruthy())
    expect(within(list()).getAllByRole('button')).toHaveLength(3)
    await waitFor(() => expect(screen.getAllByRole('region').filter(r => r.closest('[aria-label=Diffs]')).map(r => r.getAttribute('aria-label'))).toEqual(['src/app.ts', 'src/new.ts', 'old.txt']))
  })

  test('a picked commit that is no longer one of the run’s gives way to "All changes"', async () => {
    const { rerender } = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} activity={1} />)
    await waitFor(() => expect(commitRows()).toHaveLength(3))
    fireEvent.click(commitRows()[2]!)
    await waitFor(() => expect(screen.getByText('aaaaaaa Add old.txt')).toBeTruthy())
    readCommits.mockResolvedValue([NEW])
    rerender(<ChangesPanel projectId="p1" agentId="run-1" context={context} activity={2} />)
    await waitFor(() => expect(commitRows()).toHaveLength(2))
    expect(screen.getByText(NOT_MERGED)).toBeTruthy()
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
  const pressed = () => within(list()).getAllByRole('button').filter(row => row.getAttribute('aria-pressed') === 'true').map(row => row.textContent)

  test('the file asked for is the one picked, not the first; a later click in the list stands; a new ask picks again', async () => {
    const first = ask('src/app.ts')
    const { rerender } = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={first} />)
    await waitFor(() => expect(row(/app\.ts/).getAttribute('aria-pressed')).toBe('true'))
    await waitFor(() => expect(readDiff).toHaveBeenCalledWith(expect.anything(), 'p1', 'src/app.ts', 'run-1', undefined, false))
    fireEvent.click(row(/new\.ts/))
    rerender(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={first} activity={1} />)
    expect(row(/new\.ts/).getAttribute('aria-pressed')).toBe('true')
    rerender(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={ask('src/app.ts')} activity={1} />)
    await waitFor(() => expect(row(/app\.ts/).getAttribute('aria-pressed')).toBe('true'))
  })

  test('an ask already taken is not taken again by a pane opened later', async () => {
    const taken = ask('src/new.ts')
    const first = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={taken} />)
    await waitFor(() => expect(row(/new\.ts/).getAttribute('aria-pressed')).toBe('true'))
    first.unmount()
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={taken} />)
    await waitFor(() => expect(row(/app\.ts/).getAttribute('aria-pressed')).toBe('true'))
  })

  test('with a commit picked, the ask goes back to "All changes" and picks the file there', async () => {
    const commit = { sha: 'b'.repeat(40), short: 'bbbbbbb', subject: 'Change the app', at: '2026-10-04T10:00:00.000Z' }
    readCommits.mockResolvedValue([commit])
    readCommit.mockResolvedValue({ 'src/app.ts': { status: 'modified', committed: true } })
    const { rerender } = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    fireEvent.click(await screen.findByRole('button', { name: /Change the app/ }))
    await waitFor(() => expect(screen.getByText('bbbbbbb Change the app')).toBeTruthy())
    rerender(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={ask('src/new.ts')} />)
    await waitFor(() => expect(screen.getByText(NOT_MERGED)).toBeTruthy())
    expect(pressed().some(text => text?.includes('new.ts'))).toBe(true)
  })

  test('a file asked for that the list does not hold leaves the first file picked', async () => {
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={ask('gone.md')} />)
    await waitFor(() => expect(row(/app\.ts/).getAttribute('aria-pressed')).toBe('true'))
  })

  test('a file asked for by its whole path on disk is the listed file that path ends with', async () => {
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={ask('/repo/.branches/agent-1/src/app.ts')} />)
    await waitFor(() => expect(row(/app\.ts/).getAttribute('aria-pressed')).toBe('true'))
  })
})

describe('ChangesPanel, as Claude Code on the web draws it', () => {
  test('each file shows its lines added and removed, in the list and over its diff', async () => {
    readRun.mockResolvedValue({ source: 'checkout', changes: { 'src/app.ts': { status: 'modified', committed: true, added: 3, removed: 1 } }, merged: false, from: 'main', to: 'agent-x' })
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(row(/app\.ts/).textContent).toBe('app.ts+3 −1'))
    expect(within(screen.getByRole('region', { name: 'src/app.ts' })).getAllByText('+3')).toHaveLength(1)
  })

  test('a diff numbers its lines and says how many unchanged lines it leaves out; a click shows the whole file', async () => {
    readRun.mockResolvedValue({ source: 'checkout', changes: { 'src/app.ts': { status: 'modified', committed: true } }, merged: false })
    readDiff.mockResolvedValue({ path: 'src/app.ts', status: 'modified', patch: '@@ -10,2 +10,2 @@\n a = 1\n-b = 2\n+b = 3', added: 1, removed: 1, truncated: false, binary: false, lines: 30 })
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(screen.getByText('9 unmodified lines')).toBeTruthy())
    const diff = screen.getByRole('region', { name: 'src/app.ts' })
    expect(within(diff).getByText('b = 3').parentElement!.textContent).toBe('11+b = 3')
    expect(within(diff).getByText('b = 2').parentElement!.textContent).toBe('11−b = 2')
    expect(screen.getByText('Show more lines')).toBeTruthy()
    fireEvent.click(screen.getByText('9 unmodified lines'))
    await waitFor(() => expect(readDiff).toHaveBeenCalledWith(expect.anything(), 'p1', 'src/app.ts', 'run-1', undefined, true))
  })

  test('a file’s header folds its diff away; the ⋮ menu folds them all and shows them all again', async () => {
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    const header = await within(await screen.findByRole('region', { name: 'old.txt' })).findByRole('button', { expanded: true })
    fireEvent.click(header)
    await waitFor(() => expect(header.getAttribute('aria-expanded')).toBe('false'))
    fireEvent.click(screen.getByLabelText('The pane’s settings'))
    fireEvent.click(await screen.findByText('Collapse all files'))
    const folded = (expanded: boolean) => screen.getAllByRole('button', { expanded }).filter(b => b.closest('[aria-label=Diffs]'))
    await waitFor(() => expect(folded(false)).toHaveLength(3))
    fireEvent.click(screen.getByLabelText('The pane’s settings'))
    fireEvent.click(await screen.findByText('Expand all files'))
    await waitFor(() => expect(folded(true)).toHaveLength(3))
  })

  test('with grouping off in the ⋮ menu, the list shows each file’s whole path', async () => {
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await findRow(/old\.txt/)
    fireEvent.click(screen.getByLabelText('The pane’s settings'))
    fireEvent.click(await screen.findByText('Group files by folder'))
    await waitFor(() => expect(within(list()).getAllByRole('button').map(b => b.textContent)).toEqual(['old.txt', 'src/app.ts', 'src/new.ts']))
  })

  test('search finds a changed file and goes to its diff', async () => {
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await findRow(/old\.txt/)
    fireEvent.click(screen.getByLabelText('Search changed files'))
    const box = await screen.findByPlaceholderText('Search changed files')
    fireEvent.change(box, { target: { value: 'new' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(row(/new\.ts/).getAttribute('aria-pressed')).toBe('true'))
  })

  test('"Show more lines" stands only while the file has lines under its last change', async () => {
    readRun.mockResolvedValue({ source: 'checkout', changes: { 'src/app.ts': { status: 'modified', committed: true } }, merged: false })
    readDiff.mockResolvedValue({ path: 'src/app.ts', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b', added: 1, removed: 1, truncated: false, binary: false, lines: 1 })
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(screen.getByText('b')).toBeTruthy())
    expect(screen.queryByText('Show more lines')).toBeNull()
  })

  test('a binary, an empty, a cut, a missing and a failed diff each say so', async () => {
    readRun.mockResolvedValue({ source: 'checkout', changes: { 'a.bin': { status: 'modified', committed: true } }, merged: false })
    const say = async (diff: unknown, words: string) => {
      readDiff.mockImplementation(async () => (diff instanceof Error ? Promise.reject(diff) : diff) as never)
      render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
      await waitFor(() => expect(screen.getByText(words)).toBeTruthy())
      cleanup()
      forgetRemembered()
    }
    const base = { path: 'a.bin', status: 'modified', added: 0, removed: 0, truncated: false, binary: false }
    await say({ ...base, patch: '', binary: true }, 'Binary file, nothing to show.')
    await say({ ...base, status: 'untracked', patch: '' }, 'Empty file.')
    await say({ ...base, patch: '@@ -1 +1 @@\n-a\n+b', truncated: true }, 'Cut here. The rest is in the worktree.')
    await say(null, 'No change to show.')
    await say(new Error('daemon restarted'), 'Reading the diff…')
  })

  test('a file longer than a diff may be offers no whole view: it would be cut before the change', async () => {
    readRun.mockResolvedValue({ source: 'checkout', changes: { 'pnpm-lock.yaml': { status: 'modified', committed: true } }, merged: false })
    readDiff.mockResolvedValue({ path: 'pnpm-lock.yaml', status: 'modified', patch: '@@ -7000 +7000 @@\n-a\n+b', added: 1, removed: 1, truncated: false, binary: false, lines: 9000 })
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    const gap = await screen.findByText('6999 unmodified lines')
    expect((gap.closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText('Show more lines')).toBeNull()
  })

  test('a diff is read again when "Refresh" is pressed, not on a poll of its own', async () => {
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} />)
    await waitFor(() => expect(readDiff).toHaveBeenCalledTimes(3))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(readDiff).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByLabelText('The pane’s settings'))
    fireEvent.click(await screen.findByText('Refresh'))
    await waitFor(() => expect(readDiff).toHaveBeenCalledTimes(6))
  })

  test('a file asked for from the chat is scrolled to', async () => {
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
    render(<ChangesPanel projectId="p1" agentId="run-1" context={context} reveal={{ path: 'old.txt', at: 99_999 }} />)
    await waitFor(() => expect(scrolled.mock.contexts.at(-1)).toBe(screen.getByRole('region', { name: 'old.txt' })))
  })
})

describe('rowsOf', async () => {
  const { rowsOf } = await import('./DiffView.js')
  test('numbers each line by the new file, a removed one by the old, and counts the unchanged lines left out', () => {
    expect(rowsOf('@@ -3,3 +3,3 @@\n a\n-b\n+c\n d\n@@ -20 +20,2 @@\n e\n+f\n\\ No newline at end of file')).toEqual([
      { kind: 'gap', hidden: 2 },
      { kind: 'same', text: 'a', number: 3 },
      { kind: 'del', text: 'b', number: 4 },
      { kind: 'add', text: 'c', number: 4 },
      { kind: 'same', text: 'd', number: 5 },
      { kind: 'gap', hidden: 14 },
      { kind: 'same', text: 'e', number: 20 },
      { kind: 'add', text: 'f', number: 21 },
    ])
  })

  test('a new file’s lines, with no hunk header, are all added from line 1; a deleted file’s are all removed', () => {
    expect(rowsOf('+one\n+@@ two')).toEqual([
      { kind: 'add', text: 'one', number: 1 },
      { kind: 'add', text: '@@ two', number: 2 },
    ])
    expect(rowsOf('@@ -1,2 +0,0 @@\n-x\n-y')).toEqual([
      { kind: 'del', text: 'x', number: 1 },
      { kind: 'del', text: 'y', number: 2 },
    ])
  })})

describe('ChangesPanel, diffs kept up to date', () => {
  test('the agent doing something reads the diffs again, though their counts did not change', async () => {
    const { rerender } = render(<ChangesPanel projectId="p1" agentId="run-1" context={context} activity={1} />)
    await waitFor(() => expect(readDiff).toHaveBeenCalledTimes(3))
    rerender(<ChangesPanel projectId="p1" agentId="run-1" context={context} activity={2} />)
    await waitFor(() => expect(readDiff).toHaveBeenCalledTimes(6), { timeout: 2_000 })
  })
})
