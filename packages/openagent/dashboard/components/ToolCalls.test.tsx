import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LiveLine, ToolCalls, type ToolStep } from './ToolCalls.js'

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

  test('a file that was read has no "$", and shows what the call gave back', () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'Read', detail: '/repo/AGENTS.md', id: 't1', output: { text: '1→hello' } }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read AGENTS.md' }))
    expect(screen.getByLabelText('Detail').textContent).toBe('/repo/AGENTS.md')
    expect(screen.getByLabelText('Output').textContent).toBe('1→hello')
  })

  test('a call that failed says so: with its exit code when it has one, and with no empty output box', () => {
    render(<ToolCalls steps={[{ type: 'action', label: 'commandExecution', detail: 'exit 3', output: { text: '', failed: true, exitCode: 3 } }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ran exit 3' }))
    expect(screen.getByText('Failed: exit code 3')).toBeTruthy()
    expect(screen.queryByLabelText('Output')).toBeNull()
    cleanup()
    render(<ToolCalls steps={[{ type: 'action', label: 'Bash', detail: 'pnpm lint', output: { text: 'boom', failed: true } }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Ran pnpm lint' }))
    expect(screen.getByText('Failed')).toBeTruthy()
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
    expect(Array.from(box.querySelectorAll('button')).map(b => b.textContent)).toEqual(['Ranpnpm build', 'Editedapp.ts'])
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

  test('a thought is no line of its own: it is inside the opened box, folded, where it was thought', () => {
    const { container } = render(<ToolCalls steps={[{ type: 'thought', text: 'look at the docs first' }, bash('ls')]} />)
    expect(screen.queryByText(/Thought|look at the docs/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ran a command' }))
    expect(Array.from(container.querySelectorAll('.border button')).map(b => b.textContent)).toEqual(['Thought', 'Ranls'])
    expect(screen.queryByText('look at the docs first')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Thought' }))
    expect(screen.getByText('look at the docs first')).toBeTruthy()
  })

  test('thoughts with no call draw nothing', () => {
    const { container } = render(<ToolCalls steps={[{ type: 'thought', text: 'hm' }]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('LiveLine', () => {
  test('the call going on now reads in the present, shimmering, behind moving dots', () => {
    const { container } = render(<LiveLine call={{ label: 'Read', detail: '/repo/AGENTS.md' }} word="Working…" />)
    const status = screen.getByRole('status')
    expect(status.textContent).toBe('ReadingAGENTS.md')
    expect(screen.getByText('Reading').className).toContain('text-shimmer')
    expect(screen.getByText('AGENTS.md').className).toContain('text-shimmer')
    expect(container.querySelectorAll('.dot-wave > span')).toHaveLength(3)
    expect(screen.queryByText('Working…')).toBeNull()
  })

  test('it opens to its detail like any call', () => {
    render(<LiveLine call={{ label: 'Bash', detail: 'pnpm test' }} word="Working…" />)
    fireEvent.click(screen.getByRole('button', { name: 'Running pnpm test' }))
    expect(screen.getByText('pnpm test', { selector: 'pre' })).toBeTruthy()
  })

  test('the seconds since the call began count up, and turn to minutes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T10:00:09.500Z'))
    render(<LiveLine call={{ label: 'Bash', detail: 'pnpm test' }} word="Working…" since="2026-10-04T10:00:00.000Z" />)
    expect(screen.getByText('9s')).toBeTruthy()
    act(() => void vi.advanceTimersByTime(1000))
    expect(screen.getByText('10s')).toBeTruthy()
    act(() => void vi.advanceTimersByTime(55_000))
    expect(screen.getByText('1m 5s')).toBeTruthy()
  })

  test('a call that does not say when it began counts nothing', () => {
    render(<LiveLine call={{ label: 'Bash', detail: 'pnpm test' }} word="Working…" />)
    expect(screen.queryByText(/^\d+s$/)).toBeNull()
  })

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

  test('the folded line names the file and its size, as Claude Code\'s does, the size in its own colors', () => {
    render(<ToolCalls steps={[bash('a'), bash('b'), bash('c'), write]} />)
    const line = screen.getByRole('button', { name: 'Ran 3 commands, created DESCRIPTION.md +11 −0' })
    expect(line.textContent).toBe('Ran 3 commands,created DESCRIPTION.md+11 −0')
    expect(line.querySelector('.text-success')!.textContent).toBe('+11')
    expect(line.querySelector('.text-danger')!.textContent).toBe('−0')
  })

  test('a lone edit is its own line: "Created", the file\'s name, its size', () => {
    render(<ToolCalls steps={[write]} />)
    const line = screen.getByRole('button', { name: 'Created DESCRIPTION.md' })
    expect(line.textContent).toBe('CreatedDESCRIPTION.md+11 −0')
  })

  test('a run with no known file reads as before, with no size', () => {
    render(<ToolCalls steps={[bash('a'), { type: 'action', label: 'Edit', detail: '/ws/a.ts', id: 'e1', output: { text: 'ok' } }]} />)
    const line = screen.getByRole('button', { name: 'Ran a command, edited a file' })
    expect(line.querySelector('.text-success')).toBeNull()
  })
})
