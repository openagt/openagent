import type { AgentMeta, OpenAgentEvent } from '../../src/index.js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// The session line names the model as the daemon lists it; no daemon here, so the list never answers.
vi.mock('../rpc/models.js', () => ({ onModels: () => new Promise(() => {}) }))

const { EventList, askedReplies, quietEnds, withoutQuestionBlock } = await import('./EventList.js')

afterEach(cleanup)

// The conversation view: the user's prompt is a grey box on the right, the agent's reply renders
// as Markdown, no row wears a label saying its kind, and a long prompt is cut short behind "Show more".
describe('EventList conversation rows', () => {
  test('a quota reading is a row only when the quota is running low or used up', () => {
    const quota = (status: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'rate-limit', limit: { status, window: 'five_hour', resetsAt: Date.UTC(2026, 8, 30, 11, 30) } } })
    render(<EventList events={[{ kind: 'driver', event: { type: 'start', prompt: 'hello' } }, quota('allowed'), quota('allowed_warning'), quota('rejected')]} stick={false} />)
    expect(screen.queryByText(/quota allowed/)).toBeNull()
    expect(screen.getByText(/quota running low/)).toBeTruthy()
    expect(screen.getByText(/quota exhausted/)).toBeTruthy()
  })

  test('the name the session was given is no row: it is the name, not a step the agent took', () => {
    const events: OpenAgentEvent[] = [
      { kind: 'driver', event: { type: 'start', prompt: 'make readme.md shorter' } },
      { kind: 'title', text: 'README.md condensing' },
      { kind: 'driver', event: { type: 'text', text: 'done' } },
    ]
    render(<EventList events={events} stick={false} />)
    expect(screen.queryByText(/Named the session/)).toBeNull()
    expect(screen.queryByText('README.md condensing')).toBeNull()
    expect(screen.getByText('done')).toBeTruthy()
  })

  test("the agent's session id is not a row: it is plumbing, read by the run's menu", () => {
    const events: OpenAgentEvent[] = [
      { kind: 'driver', event: { type: 'start', prompt: 'hello' } },
      { kind: 'session-update', sessionId: '88cd200f-6f76-4e3e-b694-b161ea9b5e3e' },
      { kind: 'driver', event: { type: 'text', text: 'hi' } },
    ]
    render(<EventList events={events} stick={false} />)
    expect(screen.queryByText(/88cd200f/)).toBeNull()
    expect(screen.queryByText('resume')).toBeNull()
  })

  test('a message just sent shows at once as the last prompt, a box of its own', () => {
    const events: OpenAgentEvent[] = [
      { kind: 'driver', event: { type: 'start', prompt: 'first' } },
      { kind: 'driver', event: { type: 'text', text: 'done' } },
    ]
    render(<EventList events={events} sending="second" stick={false} />)
    const boxes = screen.getAllByLabelText('Your message')
    expect(boxes).toHaveLength(2)
    expect(boxes[1]!.textContent).toBe('second')
  })

  test('a prompt is a grey box on the right, and neither it nor the reply wears a label', () => {
    const events: OpenAgentEvent[] = [
      { kind: 'driver', event: { type: 'start', prompt: 'what is your name?' } },
      { kind: 'driver', event: { type: 'text', text: 'I am **Claude**.' } },
    ]
    render(<EventList events={events} stick={false} />)
    const box = screen.getByLabelText('Your message')
    expect(box.textContent).toBe('what is your name?')
    expect(box.className).toContain('bg-muted')
    expect(box.parentElement!.className).toContain('items-end')
    expect(box.closest('.font-sans')).toBeTruthy()
    expect(screen.queryByText('you')).toBeNull()
    expect(screen.queryByText('agent')).toBeNull()
  })

  test('no row wears a label saying its kind, and the rows sit in one centered column', () => {
    const events: OpenAgentEvent[] = [
      { kind: 'driver', event: { type: 'start', prompt: 'go' } },
      { kind: 'driver', event: { type: 'text', text: 'On it.' } },
      { kind: 'log', message: 'A note.' },
      { kind: 'choice', id: 'g1', title: 'Proceed?', options: [{ id: 'a', label: 'Yes' }] },
      { kind: 'end', ok: true },
    ]
    render(<EventList events={events} stick={false} />)
    for (const label of ['agent', 'log', 'choice', 'end']) expect(screen.queryByText(label)).toBeNull()
    const column = screen.getByText('On it.').closest('[data-slot="message-scroller-content"]')!
    expect(column.className).toContain('mx-auto')
    expect(column.className).toContain('max-w-3xl')
  })

  test("a prompt's time sits under its box, shown while the pointer is on the message, and is no column beside it", () => {
    const at = '2026-09-25T10:04:05.000Z'
    render(<EventList events={[{ kind: 'driver', event: { type: 'start', prompt: 'hello' }, at }]} stick={false} />)
    const time = screen.getByText(new Date(at).toLocaleTimeString())
    expect(time.tagName).toBe('TIME')
    expect(time.className).toContain('opacity-0')
    expect(time.className).toContain('group-hover/prompt:opacity-100')
    expect(time.getAttribute('title')).toBe(new Date(at).toLocaleString())
    expect(screen.getByLabelText('Your message').parentElement!.contains(time)).toBe(true)
  })

  test('a message with no time keeps the empty line under its box, so nothing moves when its time comes', () => {
    render(<EventList events={[]} sending="hello" stick={false} />)
    const time = screen.getByLabelText('Your message').parentElement!.querySelector('time')!
    expect(time.textContent).toBe('')
    expect(time.className).toContain('h-4')
  })

  test('the first of a run of rows holds the time its line was written, shown while the pointer is on the row; a line with no time holds none', () => {
    const at = '2026-09-25T10:04:05.000Z'
    const events: OpenAgentEvent[] = [
      { kind: 'driver', event: { type: 'start', prompt: 'hello' }, at },
      { kind: 'driver', event: { type: 'text', text: 'hi' } },
    ]
    render(<EventList events={events} stick={false} />)
    expect(screen.getAllByText(new Date(at).toLocaleTimeString())).toHaveLength(1)
    cleanup()
    render(<EventList events={[{ kind: 'driver', event: { type: 'text', text: 'hi' }, at }, { kind: 'driver', event: { type: 'text', text: 'there' }, at }]} stick={false} />)
    const times = screen.getAllByText(new Date(at).toLocaleTimeString())
    expect(times).toHaveLength(1)
    expect(times[0]!.className).toContain('opacity-0')
    expect(times[0]!.className).toContain('group-hover/row:opacity-100')
    expect(times[0]!.closest('[data-message-id]')!.className).toContain('group/row')
  })

  test('a prompt renders its text inline', () => {
    render(<EventList events={[{ kind: 'driver', event: { type: 'start', prompt: 'what is your name?' } }]} stick={false} />)
    expect(screen.getByText('what is your name?')).toBeTruthy()
  })

  test('a reply renders Markdown (bold, not raw asterisks)', () => {
    render(<EventList events={[{ kind: 'driver', event: { type: 'text', text: 'I am **Claude**.' } }]} stick={false} />)
    const strong = document.querySelector('strong')
    expect(strong?.textContent).toBe('Claude')
  })

  test('a long prompt is cut short and offers "Show more", which opens it and turns to "Show less"', () => {
    render(<EventList events={[{ kind: 'driver', event: { type: 'start', prompt: 'word '.repeat(150) + 'end' } }]} stick={false} />)
    const cut = () => screen.getByText(/end$/).closest('[class*="max-h"]')
    expect(cut()).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(cut()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(cut()).toBeTruthy()
  })

  test('a prompt of many short lines is cut short too', () => {
    render(<EventList events={[{ kind: 'driver', event: { type: 'start', prompt: Array.from({ length: 9 }, (_, n) => `line ${n}`).join('\n') } }]} stick={false} />)
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy()
  })

  test('a prompt of a few lines renders whole, with no "Show more"', () => {
    render(<EventList events={[{ kind: 'driver', event: { type: 'start', prompt: 'word '.repeat(40) + 'do it' } }]} stick={false} />)
    expect(screen.queryByRole('button', { name: /Show more|Show less/ })).toBeNull()
    expect(screen.getByText(/do it$/).closest('[class*="max-h"]')).toBeNull()
  })

  test('a reply is shown whole however long, with no collapse control, in the page\'s font', () => {
    render(<EventList events={[{ kind: 'driver', event: { type: 'text', text: 'word '.repeat(40) + 'end' } }]} stick={false} />)
    expect(screen.queryByLabelText(/Expand message|Collapse message/)).toBeNull()
    const reply = screen.getByText(/end$/)
    expect(reply.closest('.font-sans')).toBeTruthy()
    expect(reply.closest('[class*="max-h"]')).toBeNull()
  })

  test('the message being written and the finished message are drawn the same, so one takes the other\'s place without a jump', () => {
    const text = 'word '.repeat(40) + 'end'
    const prompt: OpenAgentEvent = { kind: 'driver', event: { type: 'start', prompt: 'go' } }
    const shape = () => screen.getByText(/end$/).closest('.font-sans')!.outerHTML
    const { rerender } = render(<EventList events={[prompt]} writing={text} working stick={false} />)
    const written = shape()
    rerender(<EventList events={[prompt, { kind: 'driver', event: { type: 'text', text } }]} working stick={false} />)
    expect(shape()).toBe(written)
  })

  test('the tail renders inside the scroller, after the last row (#1265)', () => {
    render(
      <EventList
        events={[{ kind: 'driver', event: { type: 'text', text: 'all done' } }]}
        stick={false}
        tail={<div data-testid="tail-box">and then…</div>}
      />,
    )
    const tail = screen.getByTestId('tail-box')
    const viewport = screen.getByLabelText('Agent output')
    expect(viewport.contains(tail)).toBe(true)
    const row = screen.getByText('all done')
    // The tail follows the log rather than floating over it: document order puts it after the rows.
    expect(row.compareDocumentPosition(tail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// The agent's steps between two messages (tool calls, thoughts) are one folded line, as Claude Code
// on the web draws them, and the chat has no thinking row.
describe('EventList tool calls', () => {
  const prompt: OpenAgentEvent = { kind: 'driver', event: { type: 'start', prompt: 'go' } }
  const call = (label: string, detail: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'action', label, detail } })
  const thought = (text: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'thought', text } })
  const said = (text: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'text', text } })
  const ids = () => Array.from(document.querySelectorAll('[data-message-id]')).map(n => n.getAttribute('data-message-id'))

  test('calls in a row are one line, and a message between two runs makes two lines', () => {
    render(<EventList events={[prompt, call('Bash', 'ls'), call('Bash', 'pwd'), said('Now the file.'), call('Read', '/repo/AGENTS.md')]} stick={false} />)
    expect(screen.getByRole('button', { name: 'Ran 2 commands' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Read AGENTS.md' })).toBeTruthy()
    expect(screen.queryByText(/· Bash/)).toBeNull()
  })

  test('the line is known by its first call, so it stays the same row while calls are added', () => {
    const { rerender } = render(<EventList events={[prompt, call('Bash', 'ls')]} stick={false} />)
    expect(ids()).toEqual(['0', '1'])
    rerender(<EventList events={[prompt, call('Bash', 'ls'), thought('next'), call('Bash', 'pwd')]} stick={false} />)
    expect(ids()).toEqual(['0', '1'])
    expect(screen.getByRole('button', { name: 'Ran 2 commands' })).toBeTruthy()
  })

  test('a thought is no row: among calls it is inside their line, and with no call it shows nowhere', () => {
    render(<EventList events={[prompt, thought('plan it'), call('Bash', 'ls'), said('Done.'), thought('all good'), said('Bye.')]} stick={false} />)
    expect(screen.queryByText(/Thinking|Thought|plan it|all good/)).toBeNull()
    expect(ids()).toEqual(['0', '1', '3', '5'])
    // Nor inside: thinking is no step the agent took, and the panel is the steps. Settings turns it on.
    expect(screen.getByRole('button', { name: 'Ran ls' })).toBeTruthy()
    expect(screen.queryByText('plan it')).toBeNull()
  })

  test('the turn that ended closes with a footer: the reply copied, and how long ago it was said', async () => {
    const at = new Date(Date.now() - 5000).toISOString()
    const { rerender } = render(<EventList events={[prompt, { ...said('All done.'), at }]} stick={false} />)
    const copy = screen.getByRole('button', { name: 'Copy this message' })
    expect(screen.getByText('5s ago')).toBeTruthy()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    fireEvent.click(copy)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
    expect(writeText).toHaveBeenCalledWith('All done.')
    // While the agent works there is no footer: it has not finished saying it.
    rerender(<EventList events={[prompt, { ...said('All done.'), at }]} working stick={false} />)
    expect(screen.queryByRole('button', { name: /Copy this message|Copied/ })).toBeNull()
  })

  test('what a call printed is no row: it is inside its call, by the call\'s id, also across a message', () => {
    const run = (id: string, detail: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'action', label: 'Bash', detail, id } })
    const printed = (id: string, text: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'output', id, text } })
    // Two calls at once: their outputs come after both, the second one first, one after a message.
    render(<EventList events={[prompt, run('t1', 'ls'), run('t2', 'pwd'), printed('t2', '/repo'), said('Looking.'), printed('t1', 'a.ts'), printed('gone', 'lost')]} stick={false} />)
    expect(ids()).toEqual(['0', '1', '4'])
    expect(screen.queryByText(/a\.ts|\/repo|lost/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ran 2 commands' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ran ls' }))
    expect(screen.getByLabelText('Output').textContent).toBe('a.ts')
    fireEvent.click(screen.getByRole('button', { name: 'Ran ls' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ran pwd' }))
    expect(screen.getByLabelText('Output').textContent).toBe('/repo')
  })

  test('once a call has printed, it is over: it joins its run and the last line names no step', () => {
    const run: OpenAgentEvent = { kind: 'driver', event: { type: 'action', label: 'Bash', detail: 'ls', id: 't1' } }
    const { rerender } = render(<EventList events={[prompt, run]} working stick={false} />)
    expect(screen.getByRole('status').textContent).toBe('Runningls')
    rerender(<EventList events={[prompt, run, { kind: 'driver', event: { type: 'output', id: 't1', text: 'a.ts' } }]} working stick={false} />)
    expect(screen.getByRole('button', { name: 'Ran ls' })).toBeTruthy()
    // Between two calls there is no step to name: the dots say the agent is at it, as Claude Code's do.
    expect(screen.getByRole('status').textContent).toBe('')
  })

  test('a thought is no step: the moving line names nothing while the agent thinks', () => {
    render(<EventList events={[prompt, thought('hm')]} working stick={false} />)
    expect(screen.getByRole('status').textContent).toBe('')
  })

  test('while the agent works, the last call is the line going on now, not yet in its run', () => {
    const { rerender } = render(<EventList events={[prompt, call('Bash', 'ls'), call('Read', '/repo/AGENTS.md')]} working stick={false} />)
    expect(screen.getByRole('button', { name: 'Ran ls' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('ReadingAGENTS.md')
    // The next event came: the call is over and joins its run; the agent is between calls.
    rerender(<EventList events={[prompt, call('Bash', 'ls'), call('Read', '/repo/AGENTS.md'), thought('next')]} working stick={false} />)
    expect(screen.getByRole('button', { name: 'Ran 2 commands' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('')
  })

  test('the first call of a turn is the line going on now alone: no run line above it yet', () => {
    render(<EventList events={[prompt, call('Bash', 'ls')]} working stick={false} />)
    expect(screen.getByRole('status').textContent).toBe('Runningls')
    expect(screen.queryByRole('button', { name: 'Ran ls' })).toBeNull()
  })

  test('once the agent has ended, or while it writes its message, the last call is in its run', () => {
    const events = [prompt, call('Bash', 'ls')]
    const { rerender } = render(<EventList events={events} stick={false} />)
    expect(screen.getByRole('button', { name: 'Ran ls' })).toBeTruthy()
    expect(screen.queryByRole('status')).toBeNull()
    rerender(<EventList events={events} working writing="So" stick={false} />)
    expect(screen.getByRole('button', { name: 'Ran ls' })).toBeTruthy()
    // The agent is still at it while its reply streams: the dots stay, naming no step.
    expect(screen.getByRole('status').textContent).toBe('')
  })

  test('the line going on now counts from the time of the last event', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-04T10:00:07.000Z'))
    render(<EventList events={[prompt, { ...call('Bash', 'ls'), at: '2026-10-04T10:00:00.000Z' }]} working stick={false} />)
    expect(screen.getByRole('status').textContent).toBe('Runningls7s')
    vi.useRealTimers()
  })

  test('another kind of row between calls ends the run', () => {
    render(<EventList events={[prompt, call('Bash', 'ls'), { kind: 'log', message: 'A note.' }, call('Bash', 'pwd')]} stick={false} />)
    expect(screen.getByRole('button', { name: 'Ran ls' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ran pwd' })).toBeTruthy()
  })
})

// A question in the flow, as Claude Code on the web draws it: a grey "Asking …" line while it
// waits, and, once answered, a small box holding the question and the answer.
describe('EventList question and answer', () => {
  const asked: OpenAgentEvent[] = [
    { kind: 'driver', event: { type: 'start', prompt: 'Ask me which color' } },
    { kind: 'driver', event: { type: 'text', text: 'Which color do you prefer?\n\n```await-choices\n{ "title": "Which color do you prefer?" }\n```' } },
    { kind: 'choice', id: 'await-choices', title: 'Which color do you prefer?', options: [{ id: 'opt:0', label: 'Red' }, { id: 'opt:1', label: 'Blue' }] },
    { kind: 'end', ok: false, waiting: true },
  ] as OpenAgentEvent[]
  const resumed = (prompt: string): OpenAgentEvent[] =>
    [...asked, { kind: 'driver', event: { type: 'start', prompt } }, { kind: 'driver', event: { type: 'text', text: 'Red it is.' } }, { kind: 'end', ok: true }] as OpenAgentEvent[]

  test('a question that waits is one grey line, "Asking" and its title, opening to the choices', () => {
    render(<EventList events={asked} projectId="p1" stick={false} />)
    const line = screen.getByRole('button', { name: 'Asking Which color do you prefer?' })
    expect(line.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Red')).toBeNull()
    fireEvent.click(line)
    expect(screen.getByText('Red')).toBeTruthy()
    expect(screen.getByText('Blue')).toBeTruthy()
  })

  test('answered, the prompt that resumed the agent is a box with the question and the answer, not my message, and the question is said once', () => {
    render(<EventList events={resumed('You paused to ask: "Which color do you prefer?". The user chose: Red. Continue with that decision.')} projectId="p1" stick={false} />)
    const box = screen.getByRole('group', { name: 'Your answer' })
    expect(Array.from(box.children).map(n => n.textContent)).toEqual(['Which color do you prefer?', 'Red'])
    // The sentence the agent was sent is not shown, and only the first prompt is my message.
    expect(screen.queryByText(/You paused to ask/)).toBeNull()
    expect(screen.getAllByRole('group', { name: 'Your message' })).toHaveLength(1)
    // No "Asking" line and no list of the choices any more.
    expect(screen.queryByRole('button', { name: /^Asking/ })).toBeNull()
    expect(screen.queryByText(/○ Red/)).toBeNull()
  })

  test('an agent that asks twice under one id: each answered question is said once, by its box', () => {
    const second: OpenAgentEvent[] = [
      ...resumed('You paused to ask: "Which color do you prefer?". The user chose: Red. Continue with that decision.'),
      { kind: 'choice', id: 'await-choices', title: 'Which size?', options: [{ id: 'opt:0', label: 'Small' }] },
      { kind: 'end', ok: false, waiting: true },
      { kind: 'driver', event: { type: 'start', prompt: 'You paused to ask: "Which size?". The user chose: Small. Continue with that decision.' } },
    ] as OpenAgentEvent[]
    render(<EventList events={second} projectId="p1" stick={false} />)
    expect(screen.getAllByRole('group', { name: 'Your answer' }).map(n => n.textContent)).toEqual(['Which color do you prefer?Red', 'Which size?Small'])
    expect(screen.queryByText(/\? Which/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^Asking/ })).toBeNull()
  })

  test('an answer in my own words stays my message', () => {
    render(<EventList events={resumed('Green, please.')} projectId="p1" stick={false} />)
    expect(screen.queryByRole('group', { name: 'Your answer' })).toBeNull()
    expect(screen.getAllByRole('group', { name: 'Your message' })).toHaveLength(2)
  })
})

// The "Initialized session" line: what was made for the agent before it began, under the first prompt.
describe('EventList session line', () => {
  const setup = { workspace: '/repo/.branches/agent-1', branch: 'agent-1', driver: 'codex' }
  const ids = () => Array.from(document.querySelectorAll('[data-message-id]')).map(n => n.getAttribute('data-message-id'))
  const prompt: OpenAgentEvent = { kind: 'driver', event: { type: 'start', prompt: 'go' } }
  const said: OpenAgentEvent = { kind: 'driver', event: { type: 'text', text: 'Hello.' } }

  test('a prompt with a sentence added after it shows the person\'s words alone; the sentence is in the opened setup line', () => {
    const told: OpenAgentEvent = { kind: 'driver', event: { type: 'start', prompt: 'Fix the typo', added: 'When you finish, if you changed any file, commit your work.' } }
    render(<EventList events={[told, { kind: 'driver', event: { type: 'text', text: 'Fixed.' } }]} setup={{ workspace: '/w', branch: 'agent-1' }} stick={false} />)
    expect(screen.getByText('Fix the typo')).toBeTruthy()
    expect(screen.queryByText(/When you finish/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Initialized session' }))
    expect(screen.getByText('“When you finish, if you changed any file, commit your work.”')).toBeTruthy()
  })

  test('a prompt with a text attached shows the person\'s words alone, and "Sent with this message" under them opens to the text as it was sent; a prompt with none has no such line', () => {
    const found = 'What the check printed is below.\n[{"url":"https://example.test/1"}]'
    const handed: OpenAgentEvent = { kind: 'driver', event: { type: 'start', prompt: '/answer-comments', attached: found, added: 'When you finish, if you changed any file, commit your work.' } }
    const { container } = render(<EventList events={[handed, said, { kind: 'driver', event: { type: 'start', prompt: 'And this one' } }]} setup={{ workspace: '/w', branch: 'agent-1' }} stick={false} />)
    expect(screen.getByText('/answer-comments')).toBeTruthy()
    expect(container.textContent).not.toContain('What the check printed')
    const opens = screen.getAllByRole('button', { name: 'Sent with this message' })
    expect(opens.length).toBe(1)
    expect(opens[0]!.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(opens[0]!)
    expect(opens[0]!.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('pre')?.textContent).toBe(found)
    fireEvent.click(opens[0]!)
    expect(container.querySelector('pre')).toBeNull()
  })

  test('it sits right under the first prompt, and opens to what was set up', () => {
    render(<EventList events={[prompt, said, { ...prompt }]} setup={setup} stick={false} />)
    expect(ids()).toEqual(['0', 'setup', '1', '2'])
    fireEvent.click(screen.getByRole('button', { name: 'Initialized session' }))
    expect(screen.getByText('agent-1')).toBeTruthy()
  })

  test('under a prompt with nothing after it yet, and above everything in a log with no prompt', () => {
    const { rerender } = render(<EventList events={[prompt]} setup={setup} stick={false} />)
    expect(ids()).toEqual(['0', 'setup'])
    rerender(<EventList events={[said]} setup={setup} stick={false} />)
    expect(ids()).toEqual(['setup', '0'])
  })

  test('while the agent works on its first prompt and nothing has come yet, the line names the step going on, and it is the only moving line', () => {
    const { rerender } = render(<EventList events={[prompt]} setup={{}} working stick={false} />)
    expect(screen.getAllByRole('status').map(n => n.textContent)).toEqual(['Starting session'])
    rerender(<EventList events={[prompt]} setup={{ driver: 'codex' }} working stick={false} />)
    expect(screen.getAllByRole('status').map(n => n.textContent)).toEqual(['Making the checkout'])
    rerender(<EventList events={[prompt]} setup={setup} working stick={false} />)
    expect(screen.getAllByRole('status').map(n => n.textContent)).toEqual(['Starting Codex'])
    // The agent's first output: set up, and the usual moving line takes over.
    rerender(<EventList events={[prompt, { kind: 'driver', event: { type: 'thought', text: 'hm' } }]} setup={setup} working stick={false} />)
    expect(screen.getByRole('button', { name: 'Initialized session' })).toBeTruthy()
    expect(screen.getAllByRole('status').map(n => n.textContent)).toEqual([''])
  })

  test('a later prompt is no set-up: the line stays folded and the moving line is the only one', () => {
    render(<EventList events={[prompt, said, { ...prompt }]} setup={setup} working stick={false} />)
    expect(screen.getByRole('button', { name: 'Initialized session' })).toBeTruthy()
    expect(screen.getAllByRole('status').map(n => n.textContent)).toEqual([''])
  })

  test('the agent\'s first row came before its card was read: the line is there with that row, not after it', () => {
    render(<EventList events={[prompt, said]} setup={{}} working stick={false} />)
    expect(ids()).toEqual(['0', 'setup', '1'])
    expect(screen.getByText('Initialized session')).toBeTruthy()
  })

  test('with no setup given there is no line', () => {
    render(<EventList events={[prompt, said]} stick={false} />)
    expect(screen.queryByText('Initialized session')).toBeNull()
  })
})

// Colour carries meaning in the log (#1199): a failure is red, and a stopped agent is not, since
// stopping was asked for.
describe('EventList row colour', () => {
  test('an agent error renders in red (#1199)', () => {
    render(<EventList events={[{ kind: 'driver', event: { type: 'error', message: 'rate limited' } }]} stick={false} />)
    const row = screen.getByText(/agent error: rate limited/)
    expect(row.className).toContain('text-danger')
  })

  test('an error the agent reported itself renders in red (#1500)', () => {
    render(<EventList events={[{ kind: 'error', headline: 'gh is not logged in' }]} stick={false} />)
    expect(screen.getByText(/gh is not logged in/).className).toContain('text-danger')
  })

  test('a failed run renders in red (#1199)', () => {
    render(<EventList events={[{ kind: 'end', ok: false, detail: 'exited 1' }]} stick={false} />)
    expect(screen.getByText(/failed: exited 1/).className).toContain('text-danger')
  })

  test('a stopped run is not an error, so it is not red (#1199)', () => {
    render(<EventList events={[{ kind: 'end', ok: false, stopped: true }]} stick={false} />)
    expect(screen.getByText(/stopped/).className).not.toContain('text-danger')
  })

  test('a run waiting on its question is not a failure, and a finished one is not either: neither has an end line (#1774, #1199)', () => {
    const { unmount } = render(<EventList events={[{ kind: 'end', ok: false, waiting: true }]} stick={false} />)
    expect(screen.queryByText(/waiting for an answer|failed/)).toBeNull()
    unmount()
    render(<EventList events={[{ kind: 'end', ok: true }]} stick={false} />)
    expect(screen.queryByText(/finished|failed/)).toBeNull()
  })
})

// The prompt opens the log (#1170): it is emitted after `session`, so the one line the reader
// wrote used to sit under a row they did not write.
describe('EventList prompt placement', () => {
  const rowText = () => Array.from(document.querySelectorAll('[data-message-id]')).map(n => n.textContent ?? '')

  test('the first prompt is hoisted above the session row (#1170)', () => {
    const events: OpenAgentEvent[] = [
      { kind: 'session', driver: 'claude-code', workspace: '/repo', fake: false },
      { kind: 'driver', event: { type: 'start', prompt: 'add a search box' } },
      { kind: 'driver', event: { type: 'text', text: 'done' } },
    ]
    render(<EventList events={events} stick={false} />)
    expect(rowText()[0]).toContain('add a search box')
  })

  test('a later turn stays where it happened, in the conversation (#1170)', () => {
    const events: OpenAgentEvent[] = [
      { kind: 'session', driver: 'claude-code', workspace: '/repo', fake: false },
      { kind: 'driver', event: { type: 'start', prompt: 'first question' } },
      { kind: 'driver', event: { type: 'text', text: 'first answer' } },
      { kind: 'driver', event: { type: 'start', prompt: 'second question' } },
    ]
    render(<EventList events={events} stick={false} />)
    const rows = rowText()
    expect(rows[0]).toContain('first question')
    // Only the first prompt moves; the second must not be dragged up with it.
    expect(rows.at(-1)).toContain('second question')
  })

  test('a log with no prompt at all is left alone (#1170)', () => {
    const events: OpenAgentEvent[] = [
      { kind: 'session', driver: 'claude-code', workspace: '/repo', fake: false },
      { kind: 'driver', event: { type: 'text', text: 'resumed reply' } },
    ]
    render(<EventList events={events} stick={false} />)
    expect(rowText()[0]).toContain('/repo')
  })
})

// With a projectId, an open `choice` is no row (its page asks it above the message box), and a
// resolved one collapses to the AnsweredChoice ✓ card.
describe('EventList choice rows', () => {
  const gate = (id = 'gate-1'): OpenAgentEvent => ({
    kind: 'choice',
    id,
    title: 'Start the next backlog item?',
    options: [
      { id: 'work', label: 'Work on it' },
      { id: 'stop', label: 'Stop the loop' },
    ],
    recommended: 'work',
  })
  const resolved = (id = 'gate-1'): OpenAgentEvent => ({ kind: 'choice-resolved', id, picked: 'work', by: 'user' })

  test('an open gate is one "Asking" line: its choices are asked above the message box, not in the flow', () => {
    const said: OpenAgentEvent = { kind: 'driver', event: { type: 'text', text: 'Here is the plan.' } }
    render(<EventList events={[said, gate()]} stick={false} projectId="p1" />)
    expect(screen.getByText('Here is the plan.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Asking Start the next backlog item?' })).toBeTruthy()
    expect(screen.queryByText(/Work on it/)).toBeNull()
    expect(document.querySelectorAll('[data-message-id]')).toHaveLength(2)
  })

  test('without a projectId the row keeps the formatter text', () => {
    render(<EventList events={[gate()]} stick={false} />)
    expect(screen.queryByRole('button', { name: /Work on it/ })).toBeNull()
    expect(screen.getByText(/Start the next backlog item\?/)).toBeTruthy()
  })

  test('a resolved gate collapses to a ✓ line and hides its "chose" row', () => {
    render(<EventList events={[gate(), resolved()]} stick={false} projectId="p1" />)
    const line = screen.getByRole('button', { name: /Start the next backlog item\?/ })
    expect(line.getAttribute('aria-expanded')).toBe('false')
    // The card says it better than the "✓ chose" formatter line, which is hidden with it there.
    expect(screen.queryByText(/chose/)).toBeNull()
    // And the gate is no longer answerable.
    expect(screen.queryByRole('region', { name: 'Start the next backlog item?' })).toBeNull()
  })

  test('the collapsed line expands to what was picked', () => {
    render(<EventList events={[gate(), resolved()]} stick={false} projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: /Start the next backlog item\?/ }))
    expect(screen.getByText('Work on it')).toBeTruthy()
    expect(screen.getByText('Stop the loop')).toBeTruthy()
  })

  test('a gate closed by end without an answer stays text — its audience is gone (#1359)', () => {
    render(
      <EventList events={[gate(), { kind: 'end', ok: false, stopped: true }]} stick={false} projectId="p1" />,
    )
    expect(screen.queryByRole('button', { name: /Work on it/ })).toBeNull()
    expect(screen.getByText(/Start the next backlog item\?/)).toBeTruthy()
  })

  test('a run that ended waiting on its question says it in the "Asking" line; once the agent went on with no recorded pick, the question is its text (#1774)', () => {
    const waiting: OpenAgentEvent = { kind: 'end', ok: false, waiting: true }
    const { rerender } = render(<EventList events={[gate(), waiting]} stick={false} projectId="p1" />)
    expect(screen.getByRole('button', { name: 'Asking Start the next backlog item?' })).toBeTruthy()
    expect(screen.queryByText(/\? Start the next backlog item\?/)).toBeNull()
    // The person's own message resumed the run: no pick was recorded, so the question stays as text.
    const next: OpenAgentEvent = { kind: 'driver', event: { type: 'text', text: 'On it.' } }
    rerender(<EventList events={[gate(), waiting, next]} stick={false} projectId="p1" />)
    expect(screen.queryByRole('button', { name: /^Asking/ })).toBeNull()
    expect(screen.getByText(/Start the next backlog item\?/)).toBeTruthy()
  })

  test('of a re-fired gate only the latest firing is the open question: the earlier one keeps its text', () => {
    render(<EventList events={[gate(), gate()]} stick={false} projectId="p1" />)
    // The earlier firing as text, the latest as the one "Asking" line.
    expect(screen.getAllByText(/\? Start the next backlog item\?/)).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Asking Start the next backlog item?' })).toHaveLength(1)
  })
})

// The background wash (#1508): a tint across the whole line for the rows the eye hunts for —
// failures, the clean landing — while the bulk of the log stays plain.
describe('EventList row wash (#1508)', () => {
  test("the reader's own turn gets no wash and no blue: its grey box marks it", () => {
    const { container } = render(
      <EventList events={[{ kind: 'driver', event: { type: 'start', prompt: 'add a search box' } }]} stick={false} />,
    )
    expect(container.querySelector('[class*="bg-info"], [class*="text-info"]')).toBeNull()
  })

  test('an agent-reported error gets the red wash too (#1500)', () => {
    const { container } = render(<EventList events={[{ kind: 'error', headline: 'push rejected' }]} stick={false} />)
    expect(container.querySelector('[class*="bg-danger/10"]')).toBeTruthy()
  })

  test('a failure gets the red wash', () => {
    const { container } = render(<EventList events={[{ kind: 'end', ok: false, detail: 'exited 1' }]} stick={false} />)
    expect(container.querySelector('[class*="bg-danger/10"]')).toBeTruthy()
  })

  test('a stopped end gets no wash', () => {
    const { container: stopped } = render(<EventList events={[{ kind: 'end', ok: false, stopped: true }]} stick={false} />)
    expect(stopped.querySelector('[class*="bg-info"], [class*="bg-danger"], [class*="bg-success"]')).toBeNull()
  })

  test("an agent reply stays plain canvas — the log's bulk must not shout", () => {
    const { container } = render(
      <EventList events={[{ kind: 'driver', event: { type: 'text', text: 'working on it' } }]} stick={false} />,
    )
    expect(container.querySelector('[class*="bg-info"], [class*="bg-danger"], [class*="bg-success"]')).toBeNull()
  })
})

// A screen line (a command the agent ran showing something, e.g. its browser): the newest open one
// is live, and its line opens the pane that shows the screen; an older one, or
// one after the run ended, is a line of text; an `ended` line is hidden. No screen is in the chat.
describe('EventList screen rows', () => {
  const at = (n: number) => `http://127.0.0.1:${n}/?t=x`
  const opens = () => screen.queryAllByRole('button', { name: /^◆ browser/ }).map(row => row.textContent)
  const show = (events: OpenAgentEvent[]) => {
    const onOpenScreen = vi.fn()
    render(<EventList events={events} stick={false} onOpenScreen={onOpenScreen} />)
    return onOpenScreen
  }

  test('the newest screen at an address is live: its line opens the screen; the one before it is text', () => {
    const onOpenScreen = show([
      { kind: 'screen', url: at(1), label: 'browser · http://localhost:3000/' },
      { kind: 'driver', event: { type: 'text', text: 'looking' } },
      { kind: 'screen', url: at(1), label: 'browser · http://localhost:3000/b' },
    ])
    expect(opens()).toEqual(['◆ browser · http://localhost:3000/b'])
    expect(screen.getByText('◆ browser · http://localhost:3000/')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '◆ browser · http://localhost:3000/b' }))
    expect(onOpenScreen).toHaveBeenCalledTimes(1)
    expect(document.querySelector('iframe')).toBeNull()
  })

  test('an ended screen is gone: its line opens nothing, and its ended line is hidden', () => {
    show([
      { kind: 'screen', url: at(1), label: 'browser · http://localhost:3000/' },
      { kind: 'screen', url: at(1), label: 'browser · closed', ended: true },
    ])
    expect(opens()).toEqual([])
    expect(screen.queryByText('◆ browser · closed')).toBeNull()
    expect(screen.getByText('◆ browser · http://localhost:3000/')).toBeTruthy()
  })

  test('the run ending ends every screen', () => {
    show([
      { kind: 'screen', url: at(1), label: 'browser · http://localhost:3000/' },
      { kind: 'end', ok: true },
    ])
    expect(opens()).toEqual([])
  })

  test('a run waiting on an answer keeps its screen live', () => {
    show([
      { kind: 'screen', url: at(1), label: 'browser · http://localhost:3000/' },
      { kind: 'end', ok: true, waiting: true },
    ])
    expect(opens()).toEqual(['◆ browser · http://localhost:3000/'])
  })

  test('with no tab that shows a screen, a live screen is a line of text', () => {
    render(<EventList events={[{ kind: 'screen', url: at(1), label: 'browser · http://localhost:3000/' }]} stick={false} />)
    expect(opens()).toEqual([])
    expect(screen.getByText('◆ browser · http://localhost:3000/')).toBeTruthy()
  })
})

// A run's subagents in its chat: a row where each was started, read off the subagent's card, and
// the prompt that told the run a subagent ended as a row of the subagent's, not the reader's.
describe('EventList subagent rows', () => {
  const sub = (over: Partial<AgentMeta> = {}): AgentMeta => ({
    status: 'running',
    id: '2026-10-01T10-01-00-000Z',
    startedAt: '2026-10-01T10:01:00.000Z',
    updatedAt: '2026-10-01T10:01:00.000Z',
    parent: 'main',
    intent: 'Validate the form\n\nYou are a subagent: another agent started you.',
    ...over,
  })
  const events: OpenAgentEvent[] = [
    { kind: 'driver', event: { type: 'start', prompt: 'split the work' }, at: '2026-10-01T10:00:00.000Z' },
    { kind: 'driver', event: { type: 'action', label: 'Bash', detail: 'npx orchestration start' }, at: '2026-10-01T10:00:59.000Z' },
    { kind: 'driver', event: { type: 'text', text: 'I started one subagent.' }, at: '2026-10-01T10:01:05.000Z' },
  ]

  test('a working subagent has a row where it was started, saying its task and what it is doing now', () => {
    const { container } = render(<EventList events={events} subagents={[sub()]} doing={{ '2026-10-01T10-01-00-000Z': 'Edit login.ts' }} stick={false} />)
    expect(screen.getByText(/Validate the form/)).toBeTruthy()
    expect(screen.getByText('running')).toBeTruthy()
    expect(screen.getByText('Edit login.ts')).toBeTruthy()
    expect(screen.queryByText(/You are a subagent/)).toBeNull()
    // Between the command that started it and what the agent said next.
    const text = container.textContent ?? ''
    expect(text.indexOf('npx orchestration start')).toBeLessThan(text.indexOf('Validate the form'))
    expect(text.indexOf('Validate the form')).toBeLessThan(text.indexOf('I started one subagent.'))
    // The agent's reply after the row holds its time again: the row broke the agent's run of rows.
    expect(screen.getByText(new Date('2026-10-01T10:01:05.000Z').toLocaleTimeString())).toBeTruthy()
  })

  test('the row of an ended subagent says how it ended and how long it took, and a click opens the subagent', () => {
    const opened: string[] = []
    render(<EventList events={events} subagents={[sub({ status: 'failed', endedAt: '2026-10-01T10:03:10.000Z' })]} doing={{ '2026-10-01T10-01-00-000Z': 'stale' }} onOpenAgent={id => opened.push(id)} stick={false} />)
    expect(screen.getByText('failed')).toBeTruthy()
    expect(screen.getByText('2m')).toBeTruthy()
    expect(screen.queryByText('stale')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open the subagent: Validate the form' }))
    expect(opened).toEqual(['2026-10-01T10-01-00-000Z'])
  })

  test('the prompt that told the run its subagent ended is a row about the subagent saying how it ended, not a message the reader wrote', () => {
    const told: OpenAgentEvent = {
      kind: 'driver',
      event: { type: 'start', prompt: 'The run 2026-10-01T10-01-00-000Z, started for this run, ended done.\nIts work is on the branch agent-form.' },
      at: '2026-10-01T10:04:00.000Z',
    }
    render(<EventList events={[...events, told]} subagents={[sub({ status: 'done', endedAt: '2026-10-01T10:03:10.000Z' })]} stick={false} />)
    expect(screen.getAllByLabelText('Your message')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Open the subagent: Validate the form' })).toHaveLength(2)
    expect(screen.getByText('ended done')).toBeTruthy()
    expect(screen.getByText(/Its work is on the branch agent-form/)).toBeTruthy()
    expect(screen.queryByText(/started for this run/)).toBeNull()
  })

  test("right after the reader's own prompt, a subagent's end is still a row of its own, not a second message of the reader's", () => {
    const typed: OpenAgentEvent = { kind: 'driver', event: { type: 'start', prompt: 'and then?' }, at: '2026-10-01T10:03:30.000Z' }
    const told: OpenAgentEvent = { kind: 'driver', event: { type: 'start', prompt: 'The run 2026-10-01T10-01-00-000Z, started for this run, ended done.' }, at: '2026-10-01T10:04:00.000Z' }
    render(<EventList events={[...events, typed, told]} subagents={[sub({ status: 'done', endedAt: '2026-10-01T10:03:10.000Z' })]} stick={false} />)
    expect(screen.getAllByLabelText('Your message')).toHaveLength(2)
    expect(screen.getByText('ended done')).toBeTruthy()
    // It opens its own run of rows: it holds its time.
    expect(screen.getByText(new Date('2026-10-01T10:04:00.000Z').toLocaleTimeString())).toBeTruthy()
  })

  test("a subagent's end right under the row of a subagent just started goes on that run of rows: it holds no time of its own", () => {
    const told: OpenAgentEvent = { kind: 'driver', event: { type: 'start', prompt: 'The run 2026-10-01T10-01-00-000Z, started for this run, ended done.' }, at: '2026-10-01T10:04:00.000Z' }
    const second = sub({ id: '2026-10-01T10-03-59-000Z', startedAt: '2026-10-01T10:03:59.000Z', intent: 'Second task' })
    render(<EventList events={[...events, told]} subagents={[sub({ status: 'done', endedAt: '2026-10-01T10:03:10.000Z' }), second]} stick={false} />)
    expect(screen.getByText('ended done')).toBeTruthy()
    expect(screen.queryByText(new Date('2026-10-01T10:04:00.000Z').toLocaleTimeString())).toBeNull()
  })

  test('the same words about a run that is not a subagent of this one stay a message the reader wrote', () => {
    const typed: OpenAgentEvent = { kind: 'driver', event: { type: 'start', prompt: 'The run 2026-10-01T10-01-00-000Z, started for this run, ended done.' } }
    render(<EventList events={[...events, typed]} stick={false} />)
    expect(screen.getAllByLabelText('Your message')).toHaveLength(2)
    expect(screen.queryByText('ended done')).toBeNull()
  })

  test('a subagent started after the last line is the last row', () => {
    const { container } = render(<EventList events={events} subagents={[sub({ id: 'late', startedAt: '2026-10-01T10:09:00.000Z', intent: 'Late task' })]} stick={false} />)
    const text = container.textContent ?? ''
    expect(text.indexOf('I started one subagent.')).toBeLessThan(text.indexOf('Late task'))
  })
})

// What the run's details already count is not said again in the chat, and a turn that ended
// cleanly or on a question has no end line: only a stopped or failed end is said.
describe('EventList turn ends', () => {
  const prompt = (text: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'start', prompt: text } })
  const reply = (text: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'text', text } })
  const turnEnd = { kind: 'driver', event: { type: 'result', text: '' } } as OpenAgentEvent
  const cost: OpenAgentEvent = { kind: 'usage', costUsd: 0.12 }
  const end = (over: Record<string, unknown> = {}) => ({ kind: 'end', ok: true, ...over }) as OpenAgentEvent

  test("a turn's end and the spend so far are not rows", () => {
    render(<EventList events={[prompt('go'), reply('did it'), turnEnd, cost, end()]} stick={false} />)
    expect(screen.queryByText(/turn complete/)).toBeNull()
    expect(screen.queryByText(/spend/)).toBeNull()
    expect(screen.queryByText('cost')).toBeNull()
  })

  test('a clean end is not a row: not between two turns, and not as the last line', () => {
    render(<EventList events={[prompt('go'), reply('one'), end(), prompt('more'), reply('two'), end()]} stick={false} />)
    expect(screen.queryByText(/finished/)).toBeNull()
    expect(screen.getByText('two')).toBeTruthy()
  })

  test('an end waiting on an answer is not a row, before the answer and after it', () => {
    const asked = end({ ok: false, waiting: true })
    const { unmount } = render(<EventList events={[prompt('go'), asked]} stick={false} />)
    expect(screen.queryByText(/waiting for an answer/)).toBeNull()
    unmount()
    render(<EventList events={[prompt('go'), asked, prompt('Approve'), reply('on it')]} stick={false} />)
    expect(screen.queryByText(/waiting for an answer/)).toBeNull()
  })

  test('a stopped end and a failed end are rows where they happened, also once the run went on', () => {
    const failed = end({ ok: false, detail: 'boom' })
    const stopped = end({ ok: false, stopped: true })
    const clean = end()
    const waiting = end({ ok: false, waiting: true })
    const events = [prompt('go'), failed, prompt('again'), stopped, prompt('once more'), waiting, prompt('yes'), clean]
    expect([...quietEnds(events)]).toEqual([waiting, clean])
    render(<EventList events={events} sending="try again" stick={false} />)
    expect(screen.getByText(/failed: boom/)).toBeTruthy()
    expect(screen.getByText(/stopped/)).toBeTruthy()
    expect(screen.queryByText(/finished|waiting for an answer/)).toBeNull()
  })
})

describe('EventList replies a question follows', () => {
  const long = 'The plan is saved. '.repeat(10)
  const prompt: OpenAgentEvent = { kind: 'driver', event: { type: 'start', prompt: 'plan it' } }
  const reply = (text: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'text', text } })
  const choice = { kind: 'choice', id: 'await-choices', title: 'Start?', options: [{ id: 'a', label: 'Approve' }] } as OpenAgentEvent

  test('the reply a question follows is the last reply before the question in its turn', () => {
    const early = reply(long + 'early')
    const asked = reply(long + 'asked')
    const later = reply(long + 'later')
    const events = [prompt, early, asked, choice, { kind: 'driver', event: { type: 'start', prompt: 'Approve' } } as OpenAgentEvent, later, { kind: 'usage', costUsd: 0.2 } as OpenAgentEvent]
    expect([...askedReplies(events)]).toEqual([asked])
    // A question in a later turn is not about a reply of the turn before.
    expect(askedReplies([prompt, early, { kind: 'driver', event: { type: 'start', prompt: 'go on' } } as OpenAgentEvent, choice]).size).toBe(0)
  })
})

describe('EventList hides the block a question is written in', () => {
  const prompt: OpenAgentEvent = { kind: 'driver', event: { type: 'start', prompt: 'ask me' } }
  const reply = (text: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'text', text } })
  const choice = { kind: 'choice', id: 'await-choices', title: 'Which color?', options: [{ id: 'a', label: 'Blue' }] } as OpenAgentEvent
  const block = '```await-choices\n{ "title": "Which color?", "options": [{ "label": "Blue" }] }\n```'

  test('the reply a question follows shows its words and not the block', () => {
    render(<EventList events={[prompt, reply(`Pick one, please.\n\n${block}\n`), choice]} stick={false} />)
    expect(screen.getByText('Pick one, please.')).toBeTruthy()
    expect(screen.queryByText(/"title"/)).toBeNull()
  })

  test('a reply that is only the block is no row', () => {
    render(<EventList events={[prompt, reply(block), choice]} stick={false} />)
    expect(screen.queryByText(/"title"/)).toBeNull()
    expect(screen.queryByText('agent')).toBeNull()
  })

  test('a block no question came of stays as written: it is how the reader sees it did not parse', () => {
    render(<EventList events={[prompt, reply(`Pick one.\n\n${block}`)]} stick={false} />)
    expect(screen.getByText(/"title"/)).toBeTruthy()
  })

  test('the message being written never shows the block, closed or not, and the words before it stay', () => {
    const { rerender } = render(<EventList events={[prompt]} writing={'Pick one.\n\n```await-choices\n{ "title": "Whi'} working stick={false} />)
    expect(screen.getByText('Pick one.')).toBeTruthy()
    expect(screen.queryByText(/"title"/)).toBeNull()
    rerender(<EventList events={[prompt]} writing={'```await-choices\n{ "title": "Whi'} working stick={false} />)
    expect(screen.queryByText(/"title"/)).toBeNull()
    expect(withoutQuestionBlock(`a\n${block}\nb`)).toBe('a\n\nb')
  })
})

// The scroller brings its anchor to the top; only the newest prompt may be one.
describe('EventList scroll anchor', () => {
  const prompt = (text: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'start', prompt: text } })
  const reply = (text: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'text', text } })
  const anchors = (container: HTMLElement) => [...container.querySelectorAll('[data-scroll-anchor="true"]')].map(el => el.textContent)

  test('no row is the anchor: a message sent lands under the last answer, sliding in, and the page is not lifted to it', () => {
    const events = [prompt('first'), reply('one'), { kind: 'end', ok: true } as OpenAgentEvent, prompt('second'), reply('two')]
    const { container, rerender } = render(<EventList events={events} stick={false} />)
    expect(anchors(container)).toEqual([])
    rerender(<EventList events={events} sending="third" stick={false} />)
    expect(anchors(container)).toEqual([])
    const mine = screen.getAllByLabelText('Your message')
    expect(mine.at(-1)!.textContent).toBe('third')
    expect(mine.at(-1)!.parentElement!.className).toContain('bubble-in')
    // A message already in the log does not slide in again.
    expect(mine[0]!.parentElement!.className).not.toContain('bubble-in')
  })

  test('a row keeps its identity when a row above it stops being shown', () => {
    const events = [prompt('first'), reply('one'), { kind: 'end', ok: true } as OpenAgentEvent]
    const { container, rerender } = render(<EventList events={events} stick={false} />)
    const ids = () => [...container.querySelectorAll('[data-message-id]')].map(el => el.getAttribute('data-message-id'))
    expect(ids()).toEqual(['0', '1'])
    // The run goes on: the new rows are known by their own place in the log, past the end's.
    rerender(<EventList events={[...events, prompt('second'), reply('two')]} stick={false} />)
    expect(ids()).toEqual(['0', '1', '3', '4'])
  })

  test('the live line keeps its place when it has nothing to say: nothing under it moves when the turn ends', () => {
    const events = [prompt('first'), reply('one')]
    const { rerender } = render(<EventList events={events} working stick={false} />)
    expect(screen.getByTestId('live-line').querySelector('[role="status"]')).toBeTruthy()
    rerender(<EventList events={[...events, { kind: 'end', ok: true } as OpenAgentEvent]} stick={false} />)
    expect(screen.getByTestId('live-line').querySelector('[role="status"]')).toBeNull()
  })
})

// What the chat says in place of the line that was above the message box.
describe('EventList queued messages and the wait for subagents', () => {
  const ids = () => Array.from(document.querySelectorAll('[data-message-id]')).map(n => n.getAttribute('data-message-id'))
  const prompt: OpenAgentEvent = { kind: 'driver', event: { type: 'start', prompt: 'go' } }
  const said: OpenAgentEvent = { kind: 'driver', event: { type: 'text', text: 'Hello.' } }

  test('a message the working agent has not read yet is the last row: my box, dimmed, with "Queued" under it', () => {
    render(<EventList events={[prompt, said]} working queued={['and then this']} stick={false} />)
    expect(ids()).toEqual(['0', '1', 'queued-0'])
    const box = screen.getByLabelText('Your message, queued')
    expect(box.textContent).toBe('and then this')
    expect(box.className).toContain('opacity-60')
    expect(box.parentElement!.textContent).toBe('and then thisQueued')
    // A message that was read is not dimmed and says no such word.
    const read = screen.getByLabelText('Your message')
    expect(read.className).not.toContain('opacity-60')
    expect(read.parentElement!.textContent).toBe('go')
  })

  test('several queued messages are each a row, in the order sent; none queued, none drawn', () => {
    const { rerender } = render(<EventList events={[prompt]} working queued={['one', 'two']} stick={false} />)
    expect(screen.getAllByLabelText('Your message, queued').map(n => n.textContent)).toEqual(['one', 'two'])
    rerender(<EventList events={[prompt]} working stick={false} />)
    expect(screen.queryByLabelText('Your message, queued')).toBeNull()
  })

  test('an agent that ended its turn while subagents work says how many it waits for, as the moving last line', () => {
    const { rerender } = render(<EventList events={[prompt, said]} waitingOn={2} stick={false} />)
    expect(ids()).toEqual(['0', '1', 'waiting-on'])
    expect(screen.getByRole('status').textContent).toBe('Waiting for 2 subagents')
    rerender(<EventList events={[prompt, said]} waitingOn={1} stick={false} />)
    expect(screen.getByRole('status').textContent).toBe('Waiting for 1 subagent')
    rerender(<EventList events={[prompt, said]} stick={false} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('while the agent works the moving line is its own: the wait for subagents is not said too', () => {
    render(<EventList events={[prompt, said]} working waitingOn={2} stick={false} />)
    expect(screen.getAllByRole('status').map(n => n.textContent)).toEqual([''])
  })
})

// A row for each file a turn's edits changed, at the end of the turn.
describe('EventList changed files', () => {
  const ids = () => Array.from(document.querySelectorAll('[data-message-id]')).map(n => n.getAttribute('data-message-id'))
  const prompt = (text: string): OpenAgentEvent => ({ kind: 'driver', event: { type: 'start', prompt: text } })
  const said: OpenAgentEvent = { kind: 'driver', event: { type: 'text', text: 'Done.' } }
  const WS = '/repo/.branches/agent-1'
  const edit = (id: string, path: string, added: number, removed: number): OpenAgentEvent[] => [
    { kind: 'driver', event: { type: 'action', label: 'Edit', detail: path, id } },
    { kind: 'driver', event: { type: 'output', id, text: 'ok', changed: [{ path, added, removed }] } },
  ]
  const rows = () => screen.queryAllByRole('list', { name: 'Files changed' }).map(list => list.textContent)

  test('an ended turn\'s files are a row each right after its last row, before the next prompt; the last turn\'s close the chat', () => {
    const events = [prompt('go'), ...edit('c1', `${WS}/A.md`, 2, 1), { ...said }, prompt('more'), ...edit('c2', `${WS}/src/b.ts`, 5, 0), { ...said }]
    render(<EventList events={events} setup={{ workspace: WS }} stick={false} />)
    // The first turn's work opens with the session's set-up: no row of its own.
    expect(ids()).toEqual(['0', '1', '3', 'changes-4', '4', '5', '7', 'changes-last'])
    expect(rows()).toEqual(['A.md+2 −1', 'b.ts+5 −0'])
  })

  test('while the agent works on a turn, that turn\'s files are not listed yet', () => {
    const events = [prompt('go'), ...edit('c1', `${WS}/A.md`, 2, 1), said]
    const { rerender } = render(<EventList events={events} working stick={false} />)
    expect(rows()).toEqual([])
    rerender(<EventList events={events} stick={false} />)
    expect(rows()).toHaveLength(1)
  })

  test('a message just sent leaves the ended turn\'s files where they were, above it: they do not go and come back', () => {
    const events = [prompt('go'), ...edit('c1', `${WS}/A.md`, 2, 1), said]
    const { rerender } = render(<EventList events={events} stick={false} />)
    expect(ids()).toEqual(['0', '1', '3', 'changes-last'])
    rerender(<EventList events={events} sending="and more" working stick={false} />)
    expect(ids()).toEqual(['0', '1', '3', 'changes-last', 'sending'])
    expect(rows()).toEqual(['A.md+2 −1'])
    // Its own prompt line arrives: the same rows, above it.
    rerender(<EventList events={[...events, prompt('and more')]} working stick={false} />)
    expect(ids()).toEqual(['0', '1', '3', 'changes-4', '4'])
    expect(rows()).toEqual(['A.md+2 −1'])
  })

  test("the folded line of the turn's calls counts them; the file and its size are inside it", () => {
    const events = [prompt('go'), { kind: 'driver', event: { type: 'action', label: 'Bash', detail: 'ls', id: 'b1' } } as OpenAgentEvent, ...edit('c1', `${WS}/A.md`, 2, 1), said]
    render(<EventList events={events} setup={{ workspace: WS }} stick={false} />)
    const line = screen.getByRole('button', { name: 'Ran 2 commands' })
    expect(line.textContent).toBe('Ran 2 commands')
    fireEvent.click(line)
    expect(screen.getByRole('button', { name: 'Edited A.md' }).textContent).toBe('EditedA.md+2 −1')
  })

  test('a turn that edited no file has no such row', () => {
    render(<EventList events={[prompt('go'), said]} stick={false} />)
    expect(rows()).toEqual([])
  })

  test('a click on a file\'s row asks for the file by its path in the checkout; with no way to show it the row is no button', () => {
    const onOpenChange = vi.fn()
    const events = [prompt('go'), ...edit('c1', `${WS}/docs/A.md`, 2, 1), said]
    const { rerender } = render(<EventList events={events} setup={{ workspace: WS }} onOpenChange={onOpenChange} stick={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show the change to A.md' }))
    expect(onOpenChange.mock.calls).toEqual([['docs/A.md']])
    rerender(<EventList events={events} setup={{ workspace: WS }} stick={false} />)
    expect(screen.queryByRole('button', { name: 'Show the change to A.md' })).toBeNull()
  })
})
