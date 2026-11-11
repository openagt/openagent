import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const sendChoice = vi.hoisted(() => vi.fn())
const sendMessage = vi.hoisted(() => vi.fn())
vi.mock('../rpc/control.js', () => ({ sendChoice, sendMessage }))

const { QuestionPanel } = await import('./QuestionPanel.js')
const { answerPrompt, skipPrompt } = await import('../lib/answered-question.js')

afterEach(() => {
  cleanup()
  sendChoice.mockReset()
  sendMessage.mockReset()
})

const choice = {
  id: 'await-choices',
  title: 'Which database?',
  options: [
    { id: 'pg', label: 'Postgres', detail: 'What production runs' },
    { id: 'lite', label: 'SQLite' },
  ],
  recommended: 'pg',
}
const several = { id: 'q2', title: 'Which checks?', multi: true, options: [{ id: 'lint', label: 'Lint', default: true }, { id: 'tests', label: 'Tests' }] }
const panel = (over: Partial<Parameters<typeof QuestionPanel>[0]> = {}) => <QuestionPanel projectId="p1" agentId="r1" choice={choice} {...over} />
const option = (name: RegExp) => screen.getByRole('radio', { name })

describe('QuestionPanel', () => {
  test('it shows the title, a row per option with its description, an "Other" row, Skip and Submit; no number is drawn', () => {
    render(panel())
    expect(screen.getByRole('region', { name: 'Which database?' })).toBeTruthy()
    expect(option(/Postgres/).textContent).toBe('PostgresRecommendedWhat production runs')
    expect(option(/SQLite/).textContent).toBe('SQLite')
    expect(option(/Other/).textContent).toBe('Other')
    // Its field opens only once "Other" is picked.
    expect(screen.queryByLabelText('Your own answer')).toBeNull()
    expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy()
  })

  test('the recommended option starts picked; picking a row sends nothing until Submit', async () => {
    sendChoice.mockResolvedValue({ ok: true })
    render(panel())
    expect(option(/Postgres/).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(option(/SQLite/))
    expect(option(/SQLite/).getAttribute('aria-checked')).toBe('true')
    expect(option(/Postgres/).getAttribute('aria-checked')).toBe('false')
    expect(sendChoice).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(sendChoice).toHaveBeenCalledWith('p1', 'await-choices', 'lite', 'r1'))
  })

  test('the recommended option starts picked wherever it stands in the list', () => {
    render(panel({ choice: { ...choice, recommended: 'lite' } }))
    expect(option(/SQLite/).getAttribute('aria-checked')).toBe('true')
    expect(option(/Postgres/).getAttribute('aria-checked')).toBe('false')
  })

  test('with no recommended option the first one starts picked', () => {
    render(panel({ choice: { ...choice, recommended: undefined as never } }))
    expect(option(/Postgres/).getAttribute('aria-checked')).toBe('true')
  })

  test('while the answer goes its controls are off; once it is taken the panel goes and the chat is told the answer', async () => {
    let taken!: (result: { ok: boolean }) => void
    sendChoice.mockReturnValue(new Promise(resolve => (taken = resolve)))
    const onSaid = vi.fn()
    render(panel({ onSaid, active: true }))
    fireEvent.click(option(/SQLite/))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Sending your answer…'))
    for (const name of ['Submit', 'Skip']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    for (const name of [/Postgres/, /Other/]) expect((option(name) as HTMLButtonElement).disabled).toBe(true)
    taken({ ok: true })
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
    expect(onSaid).toHaveBeenCalledWith(answerPrompt('Which database?', 'SQLite'))
    // Its keys went with it: Ctrl+Enter does not send it again.
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(sendChoice).toHaveBeenCalledTimes(1)
  })

  test('answered from the card by the keyboard, the message box has the focus once the answer is taken', async () => {
    sendChoice.mockResolvedValue({ ok: true })
    const Box = () => <textarea aria-label="Message the agent" />
    render(
      <>
        {panel({ active: true, focusNext: () => screen.getByLabelText('Message the agent').focus() })}
        <Box />
      </>,
    )
    option(/SQLite/).focus()
    fireEvent.keyDown(option(/SQLite/), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Which database?' })).toBeNull())
    expect(document.activeElement).toBe(screen.getByLabelText('Message the agent'))
  })

  test('answered while the focus is elsewhere, the focus stays where it is', async () => {
    sendChoice.mockResolvedValue({ ok: true })
    const focusNext = vi.fn()
    render(
      <>
        {panel({ active: true, focusNext })}
        <button type="button">Elsewhere</button>
      </>,
    )
    screen.getByRole('button', { name: 'Elsewhere' }).focus()
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Which database?' })).toBeNull())
    expect(focusNext).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }))
  })

  test("a refused answer says why in the daemon's words, and the question stays answerable", async () => {
    sendChoice.mockResolvedValue({ ok: false, error: 'this project has no resume hook' })
    render(panel())
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('this project has no resume hook'))
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('while OpenAgent is not answering, no answer is sent, by Submit, Skip or the keys, and the pick stays', async () => {
    const { DaemonDown } = await import('../lib/use-daemon-health.js')
    render(
      <DaemonDown.Provider value>
        {panel({ active: true })}
      </DaemonDown.Provider>,
    )
    fireEvent.click(option(/SQLite/))
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Skip' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(sendChoice).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(option(/SQLite/).getAttribute('aria-checked')).toBe('true')
  })

  test('the number keys pick, and Ctrl+Enter submits, on the active question only', async () => {
    sendChoice.mockResolvedValue({ ok: true })
    const { rerender } = render(panel())
    fireEvent.keyDown(window, { key: '2' })
    expect(option(/SQLite/).getAttribute('aria-checked')).toBe('false')
    rerender(panel({ active: true }))
    fireEvent.keyDown(window, { key: '2' })
    expect(option(/SQLite/).getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(window, { key: '3' })
    expect(document.activeElement).toBe(screen.getByLabelText('Your own answer'))
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.click(option(/SQLite/))
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(sendChoice).toHaveBeenCalledWith('p1', 'await-choices', 'lite', 'r1'))
  })

  test('keys typed into another text field are not the question\'s', () => {
    render(
      <>
        <textarea aria-label="message box" />
        {panel({ active: true })}
      </>,
    )
    const box = screen.getByLabelText('message box')
    fireEvent.keyDown(box, { key: '2' })
    fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true })
    expect(option(/SQLite/).getAttribute('aria-checked')).toBe('false')
    expect(sendChoice).not.toHaveBeenCalled()
  })

  test('one pick is a radio group: ArrowDown picks the next choice and takes the focus there, "Other" included', async () => {
    render(panel())
    expect(screen.getByRole('radiogroup', { name: 'Which database?' })).toBeTruthy()
    option(/Postgres/).focus()
    fireEvent.keyDown(option(/Postgres/), { key: 'ArrowDown' })
    await waitFor(() => expect(document.activeElement).toBe(option(/SQLite/)))
    expect(option(/SQLite/).getAttribute('aria-checked')).toBe('true')
    expect(option(/Postgres/).getAttribute('aria-checked')).toBe('false')
    fireEvent.keyDown(option(/SQLite/), { key: 'ArrowDown' })
    await waitFor(() => expect(option(/Other/).getAttribute('aria-checked')).toBe('true'))
  })

  test('ArrowUp picks the previous choice and takes the focus there', async () => {
    render(panel({ choice: { ...choice, recommended: 'lite' } }))
    option(/SQLite/).focus()
    fireEvent.keyDown(option(/SQLite/), { key: 'ArrowUp' })
    await waitFor(() => expect(document.activeElement).toBe(option(/Postgres/)))
    expect(option(/Postgres/).getAttribute('aria-checked')).toBe('true')
    expect(option(/SQLite/).getAttribute('aria-checked')).toBe('false')
  })

  test('the choices are one Tab stop, the picked one: Tab leaves the group; several picks are a stop each', () => {
    // Where Tab goes from an element: the next one the keyboard can reach, in the page's order.
    const afterTab = (from: Element) => {
      const stops = [...document.querySelectorAll<HTMLElement>('button, input, [tabindex]')].filter(e => e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled && e.getAttribute('aria-hidden') !== 'true')
      return stops[stops.indexOf(from as HTMLElement) + 1]
    }
    const { unmount } = render(panel())
    expect(afterTab(option(/Postgres/))).toBe(screen.getByRole('button', { name: 'Skip' }))
    unmount()
    render(panel({ choice: several }))
    expect(afterTab(screen.getByRole('checkbox', { name: 'Lint' }))).toBe(screen.getByRole('checkbox', { name: 'Tests' }))
  })

  test('"Other" picked opens its field with the keys in it, cannot be sent empty, and goes as the person\'s own message', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    const onSaid = vi.fn()
    render(panel({ onSaid }))
    fireEvent.click(option(/Other/))
    const other = screen.getByLabelText('Your own answer')
    expect(document.activeElement).toBe(other)
    expect(option(/Postgres/).getAttribute('aria-checked')).toBe('false')
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(other, { target: { value: '  MySQL, we already pay for it  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', answerPrompt('Which database?', 'MySQL, we already pay for it'), 'r1'))
    expect(sendChoice).not.toHaveBeenCalled()
    await waitFor(() => expect(onSaid).toHaveBeenCalledWith(answerPrompt('Which database?', 'MySQL, we already pay for it')))
    expect(screen.queryByRole('region')).toBeNull()
  })

  test('Enter in the "Other" row submits it', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    render(panel())
    fireEvent.click(option(/Other/))
    const other = screen.getByLabelText('Your own answer')
    fireEvent.change(other, { target: { value: 'MySQL' } })
    fireEvent.keyDown(other, { key: 'Enter' })
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', answerPrompt('Which database?', 'MySQL'), 'r1'))
  })

  test('Skip says so to the agent, in the shape the chat draws as the question skipped, and a refused one is not shown as said', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'unknown session' })
    const onSaid = vi.fn()
    render(panel({ onSaid }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('unknown session'))
    expect(sendMessage).toHaveBeenCalledWith('p1', skipPrompt('Which database?'), 'r1')
    expect(onSaid).not.toHaveBeenCalled()
    sendMessage.mockResolvedValue({ ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(onSaid).toHaveBeenCalledWith(skipPrompt('Which database?')))
  })

  test('a question with several answers: rows are checked on and off, starting from its defaults, and Submit sends the checked ones', async () => {
    sendChoice.mockResolvedValue({ ok: true })
    render(panel({ choice: several }))
    const box = (name: RegExp) => screen.getByRole('checkbox', { name })
    expect(box(/Lint/).getAttribute('aria-checked')).toBe('true')
    expect(box(/Tests/).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(box(/Tests/))
    fireEvent.click(box(/Lint/))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(sendChoice).toHaveBeenCalledWith('p1', 'q2', ['tests'], 'r1'))
  })

  test('several answers with words in "Other": the checked labels and the words go together as one message', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    render(panel({ choice: several }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Other/ }))
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Your own answer'), { target: { value: 'and the type check' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', answerPrompt('Which checks?', 'Lint, and the type check'), 'r1'))
    expect(sendChoice).not.toHaveBeenCalled()
  })

  describe('with `send`, the pick goes through it and the usual calls are not made', () => {
    const usualCallsNotMade = () => {
      expect(sendChoice).not.toHaveBeenCalled()
      expect(sendMessage).not.toHaveBeenCalled()
    }

    test('a picked option', async () => {
      const send = vi.fn(async () => undefined)
      render(panel({ send }))
      fireEvent.click(option(/SQLite/))
      expect(send).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
      expect(send.mock.calls).toEqual([['lite']])
      usualCallsNotMade()
    })

    test('the checked options', async () => {
      const send = vi.fn(async () => undefined)
      render(panel({ choice: several, send }))
      fireEvent.click(screen.getByRole('checkbox', { name: /Tests/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
      expect(send.mock.calls).toEqual([[['lint', 'tests']]])
      usualCallsNotMade()
    })

    test('only the options are offered: no "Other" row and no Skip, which are there without `send`', () => {
      const { unmount } = render(panel({ send: vi.fn(), active: true }))
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
      expect(screen.queryByRole('radio', { name: /Other/ })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy()
      // The key that would reach "Other" is no key of this panel.
      expect(fireEvent.keyDown(window, { key: '3' })).toBe(true)
      unmount()
      render(panel())
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
      expect(option(/Other/)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy()
    })

    test('the key that submits is on the button, not written out under the options', () => {
      const { unmount } = render(panel({ active: true }))
      expect(screen.queryByText(/Number keys pick/)).toBeNull()
      expect(screen.getByRole('button', { name: /Submit/ }).textContent).toMatch(/^Submit(⌘|Ctrl)Enter$/)
      unmount()
      // Not the question the keys answer: no key is promised on it.
      render(panel())
      expect(screen.getByRole('button', { name: 'Submit' }).textContent).toBe('Submit')
    })

    test('a send that fails says why, and the question stays answerable', async () => {
      const send = vi.fn(async () => {
        throw new Error('that session has no parked question')
      })
      render(panel({ send }))
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('that session has no parked question'))
      expect(screen.queryByRole('status')).toBeNull()
      expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(false)
    })
  })
})
