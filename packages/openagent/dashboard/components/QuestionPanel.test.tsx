import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const sendChoice = vi.hoisted(() => vi.fn())
const sendMessage = vi.hoisted(() => vi.fn())
vi.mock('../rpc/control.js', () => ({ sendChoice, sendMessage }))

const { QuestionPanel, SKIP_MESSAGE } = await import('./QuestionPanel.js')

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
  test('it shows the title, a row per option with its description and number key, an "Other" row, Skip and Submit', () => {
    render(panel())
    expect(screen.getByRole('region', { name: 'Which database?' })).toBeTruthy()
    expect(option(/Postgres/).textContent).toBe('PostgresRecommendedWhat production runs1')
    expect(option(/SQLite/).textContent).toBe('SQLite2')
    expect(screen.getByLabelText('Other').closest('label')!.textContent).toBe('3')
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

  test('a sent answer parks the panel: its controls are off and it says it waits for the agent', async () => {
    sendChoice.mockResolvedValue({ ok: true })
    render(panel())
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Answer sent/))
    for (const name of ['Submit', 'Skip']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    expect((option(/SQLite/) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Other') as HTMLInputElement).disabled).toBe(true)
  })

  test("a refused answer says why in the daemon's words, and the question stays answerable", async () => {
    sendChoice.mockResolvedValue({ ok: false, error: 'this project has no resume hook' })
    render(panel())
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('this project has no resume hook'))
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(false)
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
    expect(document.activeElement).toBe(screen.getByLabelText('Other'))
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

  test('"Other" is picked by typing in it, cannot be sent empty, and goes as the person\'s own message', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    const onSaid = vi.fn()
    render(panel({ onSaid }))
    const other = screen.getByLabelText('Other')
    fireEvent.focus(other)
    expect(option(/Postgres/).getAttribute('aria-checked')).toBe('false')
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(other, { target: { value: '  MySQL, we already pay for it  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'MySQL, we already pay for it', 'r1'))
    expect(sendChoice).not.toHaveBeenCalled()
    await waitFor(() => expect(onSaid).toHaveBeenCalledWith('MySQL, we already pay for it'))
    expect(screen.getByRole('status').textContent).toMatch(/Answer sent/)
  })

  test('Enter in the "Other" row submits it', async () => {
    sendMessage.mockResolvedValue({ ok: true })
    render(panel())
    const other = screen.getByLabelText('Other')
    fireEvent.focus(other)
    fireEvent.change(other, { target: { value: 'MySQL' } })
    fireEvent.keyDown(other, { key: 'Enter' })
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'MySQL', 'r1'))
  })

  test('Skip says so to the agent as the person\'s own message, and a refused one is not shown as said', async () => {
    sendMessage.mockResolvedValue({ ok: false, error: 'unknown session' })
    const onSaid = vi.fn()
    render(panel({ onSaid }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('unknown session'))
    expect(sendMessage).toHaveBeenCalledWith('p1', SKIP_MESSAGE, 'r1')
    expect(onSaid).not.toHaveBeenCalled()
    sendMessage.mockResolvedValue({ ok: true })
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(onSaid).toHaveBeenCalledWith(SKIP_MESSAGE))
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
    fireEvent.change(screen.getByLabelText('Other'), { target: { value: 'and the type check' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith('p1', 'Lint, and the type check', 'r1'))
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
      await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Answer sent/))
      expect(send.mock.calls).toEqual([['lite']])
      usualCallsNotMade()
    })

    test('the checked options', async () => {
      const send = vi.fn(async () => undefined)
      render(panel({ choice: several, send }))
      fireEvent.click(screen.getByRole('checkbox', { name: /Tests/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
      await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Answer sent/))
      expect(send.mock.calls).toEqual([[['lint', 'tests']]])
      usualCallsNotMade()
    })

    test('only the options are offered: no "Other" row and no Skip, which are there without `send`', () => {
      const { unmount } = render(panel({ send: vi.fn(), active: true }))
      expect(screen.getAllByRole('listitem')).toHaveLength(2)
      expect(screen.queryByLabelText('Other')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
      expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy()
      // The key that would reach "Other" is no key of this panel.
      expect(fireEvent.keyDown(window, { key: '3' })).toBe(true)
      unmount()
      render(panel())
      expect(screen.getAllByRole('listitem')).toHaveLength(3)
      expect(screen.getByLabelText('Other')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Skip' })).toBeTruthy()
    })

    test('the card folds away and is put aside by hand, and neither answers the question', () => {
      render(panel({ active: true }))
      expect(screen.getAllByRole('radio')).toHaveLength(2)
      fireEvent.click(screen.getByRole('button', { name: 'Hide the options' }))
      expect(screen.queryByRole('radio')).toBeNull()
      // The question itself stays, and so do Skip and Submit.
      expect(screen.getByRole('region', { name: 'Which database?' })).toBeTruthy()
      expect(screen.getByRole('button', { name: /Submit/ })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Show the options' }))
      expect(screen.getAllByRole('radio')).toHaveLength(2)
      fireEvent.click(screen.getByRole('button', { name: 'Put this question away' }))
      expect(screen.queryByRole('region')).toBeNull()
      // Nothing was sent by either: the agent is still waiting.
      expect(sendChoice).not.toHaveBeenCalled()
      expect(sendMessage).not.toHaveBeenCalled()
    })

    test('the key that submits is on the button, not written out under the options', () => {
      const { unmount } = render(panel({ active: true }))
      expect(screen.queryByText(/Number keys pick/)).toBeNull()
      expect(screen.getByRole('button', { name: /Submit/ }).textContent).toBe('Submit⌃⏎')
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
