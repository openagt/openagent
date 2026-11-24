import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { KeyboardEvent, ReactElement } from 'react'
import { continuationPrompt, skipPrompt } from '@openagt/hooks'
import { fakeHost, OpenAgentDown, renderWithHost, type FakeHost } from '@openagt/ui/module/testing'
import { QuestionCard } from './QuestionCard.js'

// The question's card: what it offers, how it is answered (through the module's own server part,
// whose call the host fakes here), and its keys.

let host: FakeHost
beforeEach(() => {
  host = fakeHost('@openagt/ask')
})
afterEach(() => cleanup())

/** The server part answers the call so: what the agent was told, or why nothing was. */
const answers = (answered: { ok: true; said: string } | { ok: false; error: string }) => host.call.mockResolvedValue({ ok: true, output: answered })
/** The answer the card sent, as its call of the server part carried it. */
const sent = (answer: object, question = choice.id) => ['p1', 'answer', { agentId: 'r1', question, ...answer }]
const render = (ui: ReactElement) => renderWithHost(ui, host)

const choice = {
  id: 'q1',
  title: 'Which database?',
  options: [
    { id: 'pg', label: 'Postgres', detail: 'What production runs' },
    { id: 'lite', label: 'SQLite' },
  ],
  recommended: 'pg',
}
const several = { id: 'q2', title: 'Which checks?', multi: true, options: [{ id: 'lint', label: 'Lint', default: true }, { id: 'tests', label: 'Tests' }] }
const panel = (over: Partial<Parameters<typeof QuestionCard>[0]> = {}) => <QuestionCard projectId="p1" agentId="r1" question={choice} {...over} />
const option = (name: RegExp) => screen.getByRole('radio', { name })

describe('QuestionCard', () => {
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


  test('Submit names its keys where there is a keyboard, never on a touch screen or at a phone\'s width, as the message box does', () => {
    render(panel({ active: true }))
    const keys = screen.getByRole('button', { name: 'Submit' }).querySelector('kbd')!.parentElement!
    // Each pointer's display by name: a plain `flex` would be put back by a module's own `.flex`, loaded after it.
    expect(keys.className.split(' ')).toEqual(expect.arrayContaining(['md:not-pointer-coarse:flex', 'pointer-coarse:hidden', 'max-md:hidden']))
    expect(keys.className.split(' ')).not.toContain('flex')
  })

  test('the recommended option starts picked; picking a row sends nothing until Submit', async () => {
    answers({ ok: true, said: continuationPrompt('Which database?', 'SQLite') })
    render(panel())
    expect(option(/Postgres/).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(option(/SQLite/))
    expect(option(/SQLite/).getAttribute('aria-checked')).toBe('true')
    expect(option(/Postgres/).getAttribute('aria-checked')).toBe('false')
    expect(host.call).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(host.call).toHaveBeenCalledWith(...sent({ picked: 'lite' })))
  })

  test('the question a session opens on has the focus on its picked option; one asked later leaves the focus where it is', () => {
    render(panel({ question: { ...choice, recommended: 'lite' }, focused: true }))
    expect(document.activeElement).toBe(option(/SQLite/))
    cleanup()
    render(panel())
    expect(document.activeElement).toBe(document.body)
  })

  test('the recommended option starts picked wherever it stands in the list', () => {
    render(panel({ question: { ...choice, recommended: 'lite' } }))
    expect(option(/SQLite/).getAttribute('aria-checked')).toBe('true')
    expect(option(/Postgres/).getAttribute('aria-checked')).toBe('false')
  })

  test('with no recommended option the first one starts picked', () => {
    render(panel({ question: { ...choice, recommended: undefined as never } }))
    expect(option(/Postgres/).getAttribute('aria-checked')).toBe('true')
  })

  test('while the answer goes its controls are off; once it is taken the panel goes and the chat is told the answer', async () => {
    let taken!: (result: { ok: true; output: unknown }) => void
    host.call.mockReturnValue(new Promise(resolve => (taken = resolve)))
    const onSaid = vi.fn()
    render(panel({ onSaid, active: true }))
    fireEvent.click(option(/SQLite/))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Sending your answer…'))
    for (const name of ['Submit', 'Skip']) expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    for (const name of [/Postgres/, /Other/]) expect((option(name) as HTMLButtonElement).disabled).toBe(true)
    // Its keys go with it: Ctrl+Enter pressed the moment it is gone, before anything else runs, does not send it again.
    const watch = new MutationObserver(() => {
      if (screen.queryByRole('region') !== null) return
      watch.disconnect()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }))
    })
    watch.observe(document.body, { childList: true, subtree: true })
    taken({ ok: true, output: { ok: true, said: continuationPrompt('Which database?', 'SQLite') } })
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull())
    expect(onSaid).toHaveBeenCalledWith(continuationPrompt('Which database?', 'SQLite'))
    expect(host.call).toHaveBeenCalledTimes(1)
  })

  test('answered from the card by the keyboard, the message box has the focus once the answer is taken', async () => {
    answers({ ok: true, said: continuationPrompt('Which database?', 'SQLite') })
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
    answers({ ok: true, said: continuationPrompt('Which database?', 'Postgres') })
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
    answers({ ok: false, error: 'this project has no resume hook' })
    render(panel())
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('this project has no resume hook'))
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('while OpenAgent is not answering, no answer is sent, by Submit, Skip or the keys, and the pick stays', async () => {
    render(<OpenAgentDown>{panel({ active: true })}</OpenAgentDown>)
    fireEvent.click(option(/SQLite/))
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Skip' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(host.call).not.toHaveBeenCalled()
    expect(option(/SQLite/).getAttribute('aria-checked')).toBe('true')
  })

  test('the number keys pick, and Ctrl+Enter submits, on the active question only', async () => {
    answers({ ok: true, said: continuationPrompt('Which database?', 'SQLite') })
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
    await waitFor(() => expect(host.call).toHaveBeenCalledWith(...sent({ picked: 'lite' })))
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
    expect(host.call).not.toHaveBeenCalled()
  })

  test('a key the message box took is not the question\'s, though the box stops taking keys as it sends', () => {
    // As the message box does: Ctrl+Enter sends, and the box is off while the message goes.
    const sendFromBox = (e: KeyboardEvent<HTMLDivElement>) => {
      if (!(e.ctrlKey && e.key === 'Enter')) return
      e.preventDefault()
      e.currentTarget.contentEditable = 'false'
    }
    render(
      <>
        <div role="textbox" aria-label="message box" contentEditable onKeyDown={sendFromBox} />
        {panel({ active: true })}
      </>,
    )
    fireEvent.keyDown(screen.getByLabelText('message box'), { key: 'Enter', ctrlKey: true })
    expect(host.call).not.toHaveBeenCalled()
  })

  test('Submit\'s Ctrl+Enter is dimmed while the message box has that key, and keeps its place, so Submit and Skip stand still', () => {
    render(
      <>
        <textarea aria-label="message box" />
        {panel({ active: true })}
      </>,
    )
    const keys = screen.getByRole('button', { name: 'Submit' }).querySelector('kbd')!.parentElement!
    expect(keys.className.split(' ')).not.toContain('opacity-40')
    act(() => screen.getByLabelText('message box').focus())
    expect(keys.isConnected).toBe(true)
    expect(keys.className.split(' ')).toContain('opacity-40')
    act(() => screen.getByLabelText('message box').blur())
    expect(keys.className.split(' ')).not.toContain('opacity-40')
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
    render(panel({ question: { ...choice, recommended: 'lite' } }))
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
    render(panel({ question: several }))
    expect(afterTab(screen.getByRole('checkbox', { name: 'Lint' }))).toBe(screen.getByRole('checkbox', { name: 'Tests' }))
  })

  test('"Other" picked opens its field with the keys in it, cannot be sent empty, and goes as the person\'s own answer', async () => {
    answers({ ok: true, said: continuationPrompt('Which database?', 'MySQL, we already pay for it') })
    const onSaid = vi.fn()
    render(panel({ onSaid }))
    fireEvent.click(option(/Other/))
    const other = screen.getByLabelText('Your own answer')
    expect(document.activeElement).toBe(other)
    expect(option(/Postgres/).getAttribute('aria-checked')).toBe('false')
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(other, { target: { value: '  MySQL, we already pay for it  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(host.call).toHaveBeenCalledWith(...sent({ words: 'MySQL, we already pay for it' })))
    await waitFor(() => expect(onSaid).toHaveBeenCalledWith(continuationPrompt('Which database?', 'MySQL, we already pay for it')))
    expect(screen.queryByRole('region')).toBeNull()
  })

  test('Enter in the "Other" row submits it', async () => {
    answers({ ok: true, said: continuationPrompt('Which database?', 'MySQL') })
    render(panel())
    fireEvent.click(option(/Other/))
    const other = screen.getByLabelText('Your own answer')
    fireEvent.change(other, { target: { value: 'MySQL' } })
    fireEvent.keyDown(other, { key: 'Enter' })
    await waitFor(() => expect(host.call).toHaveBeenCalledWith(...sent({ words: 'MySQL' })))
  })

  test('Skip says so to the agent, in the shape the chat draws as the question skipped, and a refused one is not shown as said', async () => {
    answers({ ok: false, error: 'unknown session' })
    const onSaid = vi.fn()
    render(panel({ onSaid }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('unknown session'))
    expect(host.call).toHaveBeenCalledWith(...sent({ skip: true }))
    expect(onSaid).not.toHaveBeenCalled()
    answers({ ok: true, said: skipPrompt('Which database?') })
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(onSaid).toHaveBeenCalledWith(skipPrompt('Which database?')))
  })

  test('a call the dashboard could not make says why, and the question stays answerable', async () => {
    host.call.mockResolvedValue({ ok: false, error: 'the machine this run works on did not answer' })
    render(panel())
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('the machine this run works on did not answer'))
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('a question with several answers: rows are checked on and off, starting from its defaults, and Submit sends the checked ones', async () => {
    answers({ ok: true, said: continuationPrompt('Which checks?', 'Tests') })
    render(panel({ question: several }))
    const box = (name: RegExp) => screen.getByRole('checkbox', { name })
    expect(box(/Lint/).getAttribute('aria-checked')).toBe('true')
    expect(box(/Tests/).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(box(/Tests/))
    fireEvent.click(box(/Lint/))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(host.call).toHaveBeenCalledWith(...sent({ picked: ['tests'] }, 'q2')))
  })

  test('several answers with words in "Other": the checked options and the words go together as one answer', async () => {
    answers({ ok: true, said: continuationPrompt('Which checks?', 'Lint, and the type check') })
    render(panel({ question: several }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Other/ }))
    expect((screen.getByRole('button', { name: 'Submit' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Your own answer'), { target: { value: 'and the type check' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(host.call).toHaveBeenCalledWith(...sent({ picked: ['lint'], words: 'and the type check' }, 'q2')))
  })

  describe("with `send`, the pick goes through it and the module's own call is not made", () => {
    const usualCallsNotMade = () => expect(host.call).not.toHaveBeenCalled()

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
      render(panel({ question: several, send }))
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
      expect(screen.getByRole('button', { name: /Submit/ }).textContent).toMatch(/^Submit(⌘|Ctrl)↵$/)
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
