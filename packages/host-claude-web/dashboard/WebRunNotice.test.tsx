import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ModuleCallResult, UiQuestionProps } from '@openagt/ui/module'
import { fakeHost, mountedOf, renderWithHost, type MountedModules } from '@openagt/ui/module/testing'
import type { BridgeAnswer } from '../src/bridge-store.js'
import type { BridgeEvent } from '../src/bridge-endpoints.js'
import type { WebRunView } from '../src/server.js'
import { WebRunNotice, scrubMirrorText } from './WebRunNotice.js'

// The strip above the chat of a run handed to Claude Code on the web, as the module's server part
// answers it: the session, the question it is parked on, the answer on its way, the mirror.

afterEach(cleanup)

const RUN = { projectId: 'p', agentId: '2026-11-19T10-00-00-000Z' }
const SESSION = { id: 'session_01ABCdefGHIjklMNO', url: 'https://claude.ai/code/session_01ABCdefGHIjklMNO' }
const QUESTION = {
  sessionId: SESSION.id,
  title: 'Where should the tickets page live?',
  options: [{ label: 'One page, both routes', detail: 'lists every project' }, { label: 'Cross-project only' }],
  recommended: 'One page, both routes',
  receivedAt: '2026-11-19T10:05:00.000Z',
}
const ANSWER: BridgeAnswer = {
  id: 'a1',
  sessionId: SESSION.id,
  labels: ['Cross-project only'],
  text: 'You paused to ask: "Where should the tickets page live?". The user chose: Cross-project only. Continue with that decision.',
  queuedAt: '2026-11-19T10:06:00.000Z',
  state: 'queued',
}

/** The card of the module that asks, a stand-in, on in `projects`: what it was given, the last last. */
function questionCard(projects: string[]): { given: UiQuestionProps[]; modules: MountedModules } {
  const given: UiQuestionProps[] = []
  function Render(props: UiQuestionProps) {
    given.push(props)
    return (
      <section role="region" aria-label={props.question.title}>
        {props.question.options.map(option => (
          <button key={option.id} type="button" onClick={() => void props.send?.(option.id)}>
            {option.label}
          </button>
        ))}
      </section>
    )
  }
  return { given, modules: mountedOf({ renders: [{ kind: 'question', Render, package: '@openagt/skill-ask', projects }] }) }
}

/**
 * The strip of a run on the web, its server part answering `run` with `view` and an answer with
 * `answered`; the module that asks on in `projects`. What was asked is the spy's.
 */
function shown(view: WebRunView | null, opts: { working?: boolean; projects?: string[]; answered?: { ok: true } | { ok: false; error: string } } = {}) {
  const card = questionCard(opts.projects ?? ['p'])
  const call = vi.fn(async (_projectId: string, name: string, _input: object): Promise<ModuleCallResult> => {
    if (name === 'run') return { ok: true, output: view }
    if (name === 'answer') return { ok: true, output: opts.answered ?? { ok: true } }
    if (name === 'cancel') return { ok: true, output: { ok: true } }
    return { ok: false, error: `no ${name} in this test` }
  })
  renderWithHost(<WebRunNotice {...RUN} working={opts.working ?? true} host="web" />, fakeHost('@openagt/host-claude-web', { call }), card.modules)
  return { call, given: card.given, asked: (name: string) => call.mock.calls.filter(([, called]) => called === name).map(([projectId, , input]) => [projectId, input]) }
}

const event = (seq: number, role: BridgeEvent['role'], text: string): BridgeEvent => ({ sessionId: SESSION.id, seq, role, text, receivedAt: '2026-11-19T10:05:00.000Z' })

describe('the strip of a run on Claude Code on the web (#610)', () => {
  test('while its hand-off is under way, it says the session is being made, with nothing to open yet', async () => {
    const { asked } = shown({ mirror: [] })
    expect(screen.getByRole('status').textContent).toMatch(/Starting a Claude Code cloud session/)
    await waitFor(() => expect(asked('run')).toEqual([['p', { agentId: RUN.agentId }]]))
    expect(screen.queryByRole('link')).toBeNull()
  })

  test('once its session is made: a link to it, and the command that brings its work to this computer', async () => {
    shown({ session: SESSION, mirror: [] })
    expect((await screen.findByRole('link', { name: /Open the session/ })).getAttribute('href')).toBe(SESSION.url)
    const strip = screen.getAllByRole('status')[0]!
    expect(strip.textContent).toContain(`claude --teleport ${SESSION.id}`)
    expect(screen.getByRole('button', { name: 'Copy the command that continues this session here' })).toBeTruthy()
  })

  test('says the session opens its own pull request over there, since nothing streams back here', async () => {
    shown({ session: SESSION, mirror: [] })
    await screen.findByRole('link', { name: /Open the session/ })
    expect(screen.getAllByRole('status')[0]!.textContent).toMatch(/opens its own pull request/)
  })

  test('one whose hand-off ended without a session shows nothing: its chat says why', async () => {
    const { asked } = shown({ mirror: [] }, { working: false })
    await waitFor(() => expect(asked('run')).toHaveLength(1))
    expect(screen.queryByRole('status')).toBeNull()
  })

  test("a run of another host has no strip of this module's, and nothing is asked for it", () => {
    const call = vi.fn(async (): Promise<ModuleCallResult> => ({ ok: true, output: null }))
    const host = fakeHost('@openagt/host-claude-web', { call })
    const { rerender } = renderWithHost(<WebRunNotice {...RUN} working={true} host="actions" />, host)
    expect(screen.queryByRole('status')).toBeNull()
    rerender(<WebRunNotice {...RUN} working={true} />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(call).not.toHaveBeenCalled()
  })
})

describe('the question its session is parked on (#1237, #1554)', () => {
  test('shows as the card of the module that asks, the options its labels, and not as the question the keys answer', async () => {
    const { given } = shown({ session: SESSION, question: QUESTION, mirror: [] })
    await screen.findByRole('region', { name: QUESTION.title })
    const last = given.at(-1)!
    // The bridge types nothing but the question's own labels, so a label is an option's id.
    expect(last.question.options.map(option => [option.id, option.label, option.detail])).toEqual([
      ['One page, both routes', 'One page, both routes', 'lists every project'],
      ['Cross-project only', 'Cross-project only', undefined],
    ])
    expect(last.question.recommended).toBe('One page, both routes')
    expect(last.send).toBeTypeOf('function')
    // The keys belong to a question in the chat, and to the message box.
    expect(last.active).toBeFalsy()
    expect(screen.getByRole('link', { name: /Answer it in the session/ }).getAttribute('href')).toBe(SESSION.url)
  })

  test('where no module that asks is on in the project, the question is in words: it is answered in the session', async () => {
    const { given } = shown({ session: SESSION, question: QUESTION, mirror: [] }, { projects: ['another-project'] })
    const asked = await screen.findByRole('region', { name: QUESTION.title })
    expect(asked.textContent).toBe('Where should the tickets page live?One page, both routes — lists every projectCross-project only')
    expect(given).toEqual([])
    expect(screen.getByRole('link', { name: /Answer it in the session/ })).toBeTruthy()
  })

  test('a pick goes to the session by its label, through the run', async () => {
    const { asked } = shown({ session: SESSION, question: QUESTION, mirror: [] })
    fireEvent.click(await screen.findByRole('button', { name: 'Cross-project only' }))
    await waitFor(() => expect(asked('answer')).toEqual([['p', { agentId: RUN.agentId, labels: ['Cross-project only'] }]]))
  })

  test('a question of several answers sends the ones checked', async () => {
    const multi = { ...QUESTION, multi: true, options: [{ label: 'Lint', default: true }, { label: 'Tests' }, { label: 'Docs' }] }
    const { given, asked } = shown({ session: SESSION, question: multi, mirror: [] })
    await screen.findByRole('region', { name: QUESTION.title })
    expect(given.at(-1)!.question.multi).toBe(true)
    await given.at(-1)!.send!(['Lint', 'Tests'])
    expect(asked('answer')).toEqual([['p', { agentId: RUN.agentId, labels: ['Lint', 'Tests'] }]])
  })

  test('a refused pick throws the reason, which the card shows', async () => {
    const { given } = shown({ session: SESSION, question: QUESTION, mirror: [] }, { answered: { ok: false, error: 'That session has no question parked.' } })
    await screen.findByRole('region', { name: QUESTION.title })
    await expect(given.at(-1)!.send!('Cross-project only')).rejects.toThrow('That session has no question parked.')
  })

  test('with no question parked there is nothing to answer, so a run on its way looks as it is', async () => {
    shown({ session: SESSION, mirror: [] })
    await screen.findByRole('link', { name: /Open the session/ })
    expect(screen.queryByRole('link', { name: /Answer it in the session/ })).toBeNull()
  })
})

describe('the answer on its way (#1237)', () => {
  test('a queued answer shows as on its way, in place of the question, and can still be taken back', async () => {
    const { asked } = shown({ session: SESSION, question: QUESTION, answer: ANSWER, mirror: [] })
    expect(await screen.findByText(/Sending .Cross-project only./)).toBeTruthy()
    // The card yields to the sending state, so a second pick cannot race the first.
    expect(screen.queryByRole('region', { name: QUESTION.title })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(asked('cancel')).toEqual([['p', { agentId: RUN.agentId }]]))
  })

  test('a delivered answer reads as answered, with nothing to take back', async () => {
    shown({ session: SESSION, answer: { ...ANSWER, state: 'sent' }, mirror: [] })
    expect(await screen.findByText(/Answered .Cross-project only./)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  })

  test('a failed delivery says so, and offers the question again', async () => {
    shown({ session: SESSION, question: QUESTION, answer: { ...ANSWER, state: 'failed', note: 'no composer on the page' }, mirror: [] })
    expect(await screen.findByText(/failed: no composer on the page/)).toBeTruthy()
    expect(screen.getByRole('region', { name: QUESTION.title })).toBeTruthy()
  })
})

describe('the mirror of its session (#1265)', () => {
  test('what the session said, in order, in one box that says what it is', async () => {
    shown({ session: SESSION, mirror: [event(0, 'agent', 'Reading the repo'), event(1, 'agent', 'Found three packages')] })
    expect(await screen.findByText('Reading the repo')).toBeTruthy()
    expect(screen.getByText('Found three packages')).toBeTruthy()
    // A scrape of a browser tab never reads as the run's own record.
    expect(screen.getByRole('status', { name: 'Cloud session mirror' })).toBeTruthy()
  })

  test("the person's turns are one line each, the session's whole (#1225)", async () => {
    shown({
      session: SESSION,
      mirror: [event(0, 'user', 'Fix the flaky publish job\n\nYou are an agent of OpenAgent.\nProtocol: …'), event(2, 'agent', 'Reading the repo\nFound three packages'), event(3, 'user', 'Go with the first')],
    })
    await screen.findByText(/Found three packages/)
    // The opening turn is the run's whole prompt: its first line shows, the rest is a tooltip.
    const prompt = screen.getByText(/Fix the flaky publish job/)
    expect(prompt.textContent).toBe('you › Fix the flaky publish job')
    expect(prompt.getAttribute('title')).toContain('You are an agent of OpenAgent.')
    expect(screen.queryByText(/Protocol:/)).toBeNull()
    expect(screen.getByText(/Go with the first/).textContent).toBe('you › Go with the first')
    expect(screen.getByText(/Reading the repo/).textContent).toBe('Reading the repo\nFound three packages')
  })

  test('before anything is read off the tab it says it is connecting, so a web run never shows dead air', async () => {
    shown({ session: SESSION, mirror: [] })
    expect(await screen.findByText(/Connecting to the cloud session/)).toBeTruthy()
  })

  test("claude.ai's own lines a scraped turn drags in are left out", async () => {
    shown({ session: SESSION, mirror: [event(0, 'agent', 'Arrow keys move the tile focus\nReading the repo\nShow message actions\nSonnet 4.5\nFound three packages')] })
    expect((await screen.findByText(/Reading the repo/)).textContent).toBe('Reading the repo\nFound three packages')
  })
})

describe('scrubMirrorText (#1265)', () => {
  test('is anchored per line: a message that mentions a model or arrows is untouched', () => {
    expect(scrubMirrorText('We should use Sonnet 4.5 for this\nArrow keys move the tile focus\ndone')).toBe('We should use Sonnet 4.5 for this\ndone')
  })

  test('closes the holes the dropped lines leave', () => {
    expect(scrubMirrorText('a\n\nShow message actions\n\nb')).toBe('a\n\nb')
  })

  test('a turn of nothing but the page’s lines scrubs to nothing, so the mirror skips it', () => {
    expect(scrubMirrorText('Haiku 4.5\nShow message actions')).toBe('')
  })
})
