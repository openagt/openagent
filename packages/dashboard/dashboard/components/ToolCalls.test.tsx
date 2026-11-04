import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LiveLine, OpenFile, Seconds, ToolCalls, type ToolStep } from './ToolCalls.js'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const bash = (detail: string): ToolStep => ({ type: 'action', label: 'Bash', detail })

describe('ToolCalls', () => {
  test('a lone call is its own line: the verb in grey, what it was done to in dark', () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'Read', detail: '/repo/AGENTS.md' }]} />)
    const line = screen.getByRole('button', { name: 'Read AGENTS.md' })
    expect(line.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText('AGENTS.md').className).toContain('text-foreground')
    expect(screen.getByText('Read').className).not.toContain('text-foreground')
    expect(screen.queryByText(/1 file/)).toBeNull()
  })

  test('a lone call opens to its detail whole, and folds again', () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'Read', detail: '/repo/AGENTS.md' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read AGENTS.md' }))
    expect(screen.getByText('/repo/AGENTS.md').tagName).toBe('PRE')
    fireEvent.click(screen.getByRole('button', { name: 'Read AGENTS.md' }))
    expect(screen.queryByText('/repo/AGENTS.md')).toBeNull()
  })

  test('an opened command shows the command whole with "$" in front and, under it, what it printed', () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'Bash', detail: 'pnpm test --run', whole: 'pnpm test\n  --run', id: 't1', output: { text: '12 passed' } }]} />)
    expect(screen.queryByLabelText('Output')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ran pnpm test --run' }))
    expect(screen.getByLabelText('Command').textContent).toBe('$ pnpm test\n  --run')
    const output = screen.getByLabelText('Output')
    expect(output.textContent).toBe('12 passed')
    // The box scrolls once it is tall.
    expect(output.className).toContain('max-h-64')
    expect(output.className).toContain('overflow-auto')
    expect(screen.queryByText(/Failed/)).toBeNull()
  })

  test('a file that was read opens to its path and its lines, numbered, as Claude Code on the web opens one', () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'Read', detail: '/repo/AGENTS.md', id: 't1', output: { text: '1\t# Agents\n2\n3\tRead the docs.\n4' } }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read AGENTS.md' }))
    expect(screen.getByText('/repo/AGENTS.md')).toBeTruthy()
    expect(screen.queryByText('$')).toBeNull()
    const file = screen.getByLabelText('File')
    // The empty line after the file's last newline is none of its lines.
    expect(Array.from(file.children).map(line => [line.firstElementChild!.textContent, line.lastElementChild!.textContent])).toEqual([
      ['1', '# Agents'],
      ['2', ' '],
      ['3', 'Read the docs.'],
    ])
    expect(screen.queryByLabelText('Output')).toBeNull()
  })

  test("a read's text that is no file's lines shows as what the call gave back", () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'Read', detail: '/repo/gone.md', id: 't1', output: { text: 'File does not exist.', failed: true } }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read gone.md, failed' }))
    expect(screen.getByLabelText('Detail').textContent).toBe('/repo/gone.md')
    expect(screen.getByLabelText('Output').textContent).toBe('File does not exist.')
  })

  test('a failed call says so: on its row in red, and in the line that counts the steps', () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'Read', detail: '/repo/README.md', id: 'r1', output: { text: '1\t# Hi' } }, { type: 'action', label: 'Read', detail: '/repo/index.html', id: 'r2', output: { text: 'File does not exist.', failed: true } }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read 2 files (1 failed)' }))
    const row = screen.getByRole('button', { name: 'Read index.html, failed' }).parentElement!
    expect(row.textContent).toBe('Readindex.htmlFailed')
    expect(row.querySelector('.text-danger')!.textContent).toBe('Failed')
    expect(screen.getByRole('button', { name: 'Read README.md' }).parentElement!.querySelector('.text-danger')).toBeNull()
  })

  test("a step's file name opens the file beside the chat, by the path the agent named it by, and opens nothing else", () => {
    const opened: string[] = []
    render(
      <OpenFile.Provider value={path => opened.push(path)}>
        <ToolCalls steps={[bash('ls'), { type: 'action', label: 'Read', detail: '/repo/src/app.ts', id: 'r1', output: { text: '1\tlet a = 1' } }]} />
      </OpenFile.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Ran a command, read a file' }))
    fireEvent.click(screen.getByRole('button', { name: 'app.ts' }))
    expect(opened).toEqual(['/repo/src/app.ts'])
    expect(screen.getByRole('button', { name: 'Read app.ts' }).getAttribute('aria-expanded')).toBe('false')
    // The rest of the line opens the step; its path opens the file too.
    fireEvent.click(screen.getByRole('button', { name: 'Read app.ts' }).parentElement!.firstElementChild!)
    expect(screen.getByRole('button', { name: 'Read app.ts' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '/repo/src/app.ts' }))
    expect(opened).toEqual(['/repo/src/app.ts', '/repo/src/app.ts'])
  })

  test('without a pane that shows files, a file name is text', () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'Read', detail: '/repo/src/app.ts', id: 'r1', output: { text: '1\tlet a = 1' } }]} />)
    expect(screen.queryByRole('button', { name: 'app.ts' })).toBeNull()
  })

  test('a call that failed says so on its row, and opened, its exit code when it has one, with no empty output box', () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'commandExecution', detail: 'exit 3', output: { text: '', failed: true, exitCode: 3 } }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ran exit 3, failed' }))
    expect(screen.getByText('Exit code 3')).toBeTruthy()
    expect(screen.queryByLabelText('Output')).toBeNull()
    cleanup()
    render(<ToolCalls steps={[{ type: 'action', label: 'Bash', detail: 'pnpm lint', output: { text: 'boom', failed: true } }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ran pnpm lint, failed' }))
    expect(screen.getAllByText('Failed')).toHaveLength(1)
    expect(screen.getByLabelText('Output').textContent).toBe('boom')
  })

  test('a call with no detail opens when it gave something back', () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'TodoWrite', output: { text: 'Todos updated' } }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Updated todos' }))
    expect(screen.getByLabelText('Output').textContent).toBe('Todos updated')
    expect(screen.queryByLabelText('Detail')).toBeNull()
  })

  test('a call with no detail is a line that does not open', () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'TodoWrite' }]} />)
    expect(screen.getByText('Updated todos')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('several calls are one line counting them, folded', () => {
    render(<ToolCalls steps={[bash('pnpm build'), bash('pnpm test')]} />)
    expect(screen.getByRole('button', { name: 'Ran 2 commands' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('pnpm build')).toBeNull()
  })

  test('the line opens to a bordered box with one line per call, in order, each opening further', () => {
    const { container } = render(<ToolCalls steps={[bash('pnpm build'), { type: 'action', label: 'Edit', detail: '/repo/src/app.ts' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ran a command, edited a file' }))
    const box = container.querySelector('.border')!
    expect(Array.from(box.querySelectorAll('[aria-expanded]')).map(b => b.parentElement!.textContent)).toEqual(['Ranpnpm build', 'Editedapp.ts'])
    fireEvent.click(screen.getByRole('button', { name: 'Edited app.ts' }))
    expect(screen.getByText('/repo/src/app.ts')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ran a command, edited a file' }))
    expect(container.querySelector('.border')).toBeNull()
  })

  test("Codex's calls read the same: its item kinds have their own verbs", () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'commandExecution', detail: 'pnpm test' }, { type: 'action', label: 'fileChange', detail: '/repo/a.ts' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ran a command, edited a file' }))
    expect(screen.getByRole('button', { name: 'Ran pnpm test' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edited a.ts' })).toBeTruthy()
  })

  test('what the agent thought is not shown at all: the panel is the steps it took', () => {
    const { container } = render(<ToolCalls steps={[{ type: 'thought', text: 'look at the docs first\nthen the code' }, bash('ls'), bash('pwd')]} />)
    expect(screen.queryByText(/Thought|look at the docs/)).toBeNull()
    // Thinking is no step, and Claude Code on the web's panel has none of it. A person who wants to
    // read it turns it on in Settings, which is what `showThinking` does.
    fireEvent.click(screen.getByRole('button', { name: 'Ran 2 commands' }))
    expect(Array.from(container.querySelectorAll('.border [aria-expanded]')).map(b => b.parentElement!.textContent)).toEqual(['Ranls', 'Ranpwd'])
    expect(screen.queryByText(/look at the docs/)).toBeNull()
  })

  test('a lone call with only thinking beside it is still its own line, not a panel of one', () => {
    render(<ToolCalls steps={[{ type: 'thought', text: 'hm' }, bash('ls')]} />)
    // The thought is not drawn, so what is left is one call: it reads as that call, as a lone one does.
    expect(screen.getByRole('button', { name: 'Ran ls' })).toBeTruthy()
  })

  test('thoughts with no call draw nothing', () => {
    const { container } = render(<ToolCalls steps={[{ type: 'thought', text: 'hm' }]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('an opened call', () => {
  test('is one card: the tool named, the command in a box of its own with a copy button, and what it printed under it in grey', () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'Bash', detail: 'sleep 1 && ls', summary: 'List files', output: { text: 'README.md' } }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Listed files' }))
    const command = screen.getByLabelText('Command')
    expect(command.textContent).toBe('$ sleep 1 && ls')
    const card = command.closest('.rounded-xl')!
    expect(card.firstElementChild?.textContent).toBe('Bash')
    expect(screen.getByRole('button', { name: 'Copy the command' })).toBeTruthy()
    const output = screen.getByLabelText('Output')
    expect(output.textContent).toBe('README.md')
    expect(output.className).toContain('text-muted-foreground')
    expect(output.className).not.toContain('border')
  })

  test('opened inside a box of steps it has no card of its own and does not name the tool', () => {
    render(<ToolCalls steps={[bash('ls'), { type: 'action', label: 'Bash', detail: 'pwd', summary: 'Print the folder', output: { text: '/repo' } }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ran 2 commands' }))
    fireEvent.click(screen.getByRole('button', { name: 'Printed the folder' }))
    const command = screen.getByLabelText('Command')
    expect(command.closest('.rounded-xl')).toBeNull()
    expect(screen.queryByText('Bash')).toBeNull()
  })
})

describe('a steps row with its call going on', () => {
  const live = (call: { label: string; detail?: string; summary?: string; id?: string }, since?: string) => <ToolCalls steps={[]} live={{ call, ...(since !== undefined ? { since } : {}) }} />

  test('the call going on now reads in the present, shimmering, behind moving dots', () => {
    const { container } = render(live({ label: 'Read', detail: '/repo/AGENTS.md' }))
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('ReadingAGENTS.md')
    expect(screen.getByText('Reading').className).toContain('text-shimmer')
    expect(screen.getByText('AGENTS.md').className).toContain('text-shimmer')
    expect(container.querySelectorAll('.dot-wave > span')).toHaveLength(3)
  })

  test('it opens to its detail like any call', () => {
    render(live({ label: 'Bash', detail: 'pnpm test' }))
    fireEvent.click(screen.getByRole('button', { name: 'Running pnpm test' }))
    expect(screen.getByText('pnpm test', { selector: 'pre' })).toBeTruthy()
  })

  test('the seconds since the turn began count up after its words, and turn to minutes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T10:00:09.500Z'))
    render(live({ label: 'Bash', detail: 'pnpm test' }, '2026-10-04T10:00:00.000Z'))
    expect(screen.getByText('9s')).toBeTruthy()
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.getByText('10s')).toBeTruthy()
    act(() => void vi.advanceTimersByTime(55_000))
    expect(screen.getByText('1m 5s')).toBeTruthy()
  })

  test('a call that does not say when it began counts nothing', () => {
    render(live({ label: 'Bash', detail: 'pnpm test' }))
    expect(screen.queryByText(/^\d+s$/)).toBeNull()
  })

  test('once the call is done the same row says the steps it took, the call\u2019s words fading out as those come in', () => {
    const call = { label: 'Bash', detail: 'git log -3', summary: 'Show the last commits', id: 'c1' }
    const { rerender, container } = render(<ToolCalls steps={[bash('ls')]} live={{ call }} />)
    expect(screen.getByRole('status').textContent).toContain('Showing the last commits')
    rerender(<ToolCalls steps={[bash('ls'), { type: 'action', ...call, output: { text: 'abc' } }]} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: 'Ran 2 commands' })).toBeTruthy()
    const leaving = container.querySelector('.cross-fade-out')
    expect(leaving?.textContent).toContain('Showing the last commits')
    expect(container.querySelector('.cross-fade-in')?.textContent).toContain('Ran 2 commands')
  })

  test('as the call ends its dots shrink away with the fade, so the words glide into their place, and then they are gone', () => {
    vi.useFakeTimers()
    const call = { label: 'Bash', detail: 'git log -3', id: 'c1' }
    const { rerender, container } = render(<ToolCalls steps={[]} live={{ call }} />)
    expect(container.querySelector('.dot-wave')?.parentElement?.className).not.toContain('dots-leave')
    rerender(<ToolCalls steps={[{ type: 'action', ...call }]} />)
    expect(container.querySelector('.dot-wave')?.parentElement?.className).toContain('dots-leave')
    act(() => void vi.advanceTimersByTime(250))
    expect(container.querySelector('.dot-wave')).toBeNull()
  })

  test('a row drawn done has no dots at all', () => {
    const { container } = render(<ToolCalls steps={[bash('ls')]} />)
    expect(container.querySelector('.dot-wave')).toBeNull()
  })
})

describe('LiveLine', () => {
  test('with no call going on, the line is the word, shimmering, with its seconds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T10:00:03.000Z'))
    const { container } = render(<LiveLine word="Working…" since="2026-10-04T10:00:00.000Z" />)
    expect(screen.getByText('Working…').className).toContain('text-shimmer')
    expect(screen.getByText('3s')).toBeTruthy()
    expect(container.querySelector('.dot-wave')).toBeTruthy()
  })
})

// The files an edit changed, said by its coding agent on the call's output.
describe('ToolCalls, edits whose files are known', () => {
  const made = { path: '/ws/docs/DESCRIPTION.md', added: 11, removed: 0, created: true as const }
  const write: ToolStep = { type: 'action', label: 'Write', detail: made.path, id: 'w1', output: { text: 'ok', changed: [made] } }

  test("the folded line counts the commands and names the file the edits changed, with its size in a pill, as Claude Code's does; the edit's own row has the pill too", () => {
    render(<ToolCalls steps={[bash('a'), bash('b'), bash('c'), write]} />)
    const line = screen.getByRole('button', { name: 'Ran 3 commands, created DESCRIPTION.md' }).parentElement!
    expect(line.textContent).toBe('Ran 3 commands, created DESCRIPTION.md+11−011 added, 0 removed')
    expect(line.querySelector('.text-success')!.textContent).toBe('+11')
    expect(line.querySelector('.text-success')!.className).toContain('bg-success/20')
    fireEvent.click(line)
    const inside = screen.getByRole('button', { name: 'Created DESCRIPTION.md' }).parentElement!
    expect(inside.querySelector('.text-success')!.className).toContain('bg-success/20')
  })

  test('a lone edit is its own line: "Created", the file\'s name, its size', () => {
    render(<ToolCalls steps={[write]} />)
    const line = screen.getByRole('button', { name: 'Created DESCRIPTION.md' }).parentElement!
    expect(line.textContent).toBe('CreatedDESCRIPTION.md+11−011 added, 0 removed')
  })

  test('an edit whose file its coding agent did not say is still an edit, with no size', () => {
    render(<ToolCalls steps={[bash('a'), { type: 'action', label: 'Edit', detail: '/ws/a.ts', id: 'e1', output: { text: 'ok' } }]} />)
    const line = screen.getByRole('button', { name: 'Ran a command, edited a file' })
    expect(line.querySelector('.text-success')).toBeNull()
  })
})

describe('the live line counter', () => {
  test('the first two seconds say nothing, then it counts', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-03T10:00:01.000Z'))
    const { container, rerender } = render(<Seconds since="2026-11-03T10:00:00.000Z" />)
    expect(container.textContent).toBe('')
    vi.setSystemTime(new Date('2026-11-03T10:00:02.500Z'))
    act(() => void vi.advanceTimersByTime(1000))
    rerender(<Seconds since="2026-11-03T10:00:00.000Z" />)
    expect(container.textContent).toBe('3s')
    vi.useRealTimers()
  })
})

describe('the live line says what is being done', () => {
  test('a command\u2019s description, as going on; once done the row keeps it as written', () => {
    const command = { label: 'Bash', detail: 'find . -name "*.md"', summary: 'Find all markdown files', id: 'b1' }
    render(<ToolCalls steps={[]} live={{ call: command, since: '2026-11-03T10:00:00.000Z' }} />)
    expect(screen.getByRole('status').textContent).toContain('Finding all markdown files')
    cleanup()
    render(<ToolCalls steps={[{ type: 'action', ...command, output: { text: 'a.md' } }]} />)
    expect(screen.queryByText('Finding all markdown files')).toBeNull()
  })

  test('a subagent\u2019s task, as going on, in place of "Starting agent"', () => {
    render(<ToolCalls steps={[]} live={{ call: { label: 'Agent', detail: 'Summarize README', id: 'a1' }, since: '2026-11-03T10:00:00.000Z' }} />)
    expect(screen.getByRole('status').textContent).toContain('Summarizing README')
    expect(screen.getByRole('status').textContent).not.toContain('Starting agent')
  })

  test('words that are no command to turn are shown as written, and a call with none keeps its own words', () => {
    render(<ToolCalls steps={[]} live={{ call: { label: 'Bash', detail: 'git status', summary: 'Git status of the repo', id: 'b2' }, since: '2026-11-03T10:00:00.000Z' }} />)
    expect(screen.getByRole('status').textContent).toContain('Git status of the repo')
    cleanup()
    render(<ToolCalls steps={[]} live={{ call: { label: 'Read', detail: '/ws/README.md', id: 'r1' }, since: '2026-11-03T10:00:00.000Z' }} />)
    expect(screen.getByRole('status').textContent).toContain('Reading')
    expect(screen.getByRole('status').textContent).toContain('README.md')
  })
})
