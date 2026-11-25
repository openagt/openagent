import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import type { Preferences } from '../../src/index.js'
import { resetRunHostsForTest } from '../lib/run-hosts.js'
import { hoverTooltip, imageStore, openMenu } from '../test-utils.js'
import { ModulesContext, mountedOf, type MountedView } from '../lib/use-modules.js'
import { forgetRemembered } from '../lib/use-async.js'
import type { UiPrompt, UiPromptSaveProps } from '../module/index.js'

// Preferences are the shared daemon store; stub them so the composer reads a fixed value.
const updatePreferences = vi.hoisted(() => vi.fn())
let prefs: Preferences = {}
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => prefs,
  usePreferencesLoaded: () => true,
  updatePreferences,
  useActiveProjectId: () => 'p1',
}))
// The editor picker (#727) detects installed editors over an RPC; stub it to none in the test.
vi.mock('../lib/editors.js', () => ({ useDetectedEditors: () => [] }))
// Composer loads its own projects for the `@` picker (#743); stub the reads.
const onCommands = vi.hoisted(() => vi.fn())
// The hosts beside this computer the project's modules bring: none unless a test says.
const onRunHosts = vi.hoisted(() => vi.fn(async () => [] as { id: string; label: string }[]))
vi.mock('../rpc/projects.js', () => ({ onProjects: () => Promise.resolve([]), onCommands, onRunHosts }))
// An image dropped or pasted is kept by the dashboard: here the call answers what the test says.

// Stub the Tiptap editor (it needs a real DOM/ProseMirror): a plain input driving onChange, a
// "type-submit" button firing onSubmit, and a ref exposing the same handle the composer calls.
//
// The stub models one thing about the real editor deliberately: `loadTemplate` does NOTHING until
// the editor has resolved. Tiptap runs with `immediatelyRender: false`, so on the first render the
// handle is a no-op that returns false — and a stub that answered it synchronously is exactly why a
// carried draft passed here while arriving as an empty composer in a browser. An opening draft
// therefore has to travel as `initialText`, which the editor applies when it is ready.
// It also holds and renders its own text, so a test can ask what is IN the box rather than only
// what Start would send. The two used to be assertable only together, which hid this exact bug: the
// composer's own `prompt` state was set alongside the editor call, so a dropped `loadTemplate` still
// submitted the right text while the user looked at an empty box and had nothing to edit.
vi.mock('./PromptEditor.js', async () => {
  const { forwardRef, useEffect, useImperativeHandle, useRef, useState } = await import('react')
  const PromptEditor = forwardRef((props: any, ref: any) => {
    const [ready, setReady] = useState(false)
    const [held, setHeld] = useState('')
    useEffect(() => setReady(true), []) // resolves a render late, like useEditor
    const put = (text: string) => {
      setHeld(text)
      props.onChange(text)
    }
    useImperativeHandle(ref, () => ({
      clear: () => put(''),
      focus: () => {},
      // Loading a command puts its text in the box, which is what makes it submittable.
      loadTemplate: (text: string) => {
        if (!ready) return false
        put(text)
        return false
      },
      append: (text: string) => put(held.trim() ? `${held}\n\n${text}` : text),
    }))
    const seeded = useRef(false)
    useEffect(() => {
      if (!ready || seeded.current || !props.initialText) return
      seeded.current = true
      put(props.initialText)
    }, [ready, props.initialText])
    return (
      <div>
        <input aria-label="prompt" value={held} onChange={e => put(e.target.value)} disabled={props.disabled} data-seed-focus={String(props.initialFocus ?? true)} data-replaced={props.replacedText} data-label={props.label} data-commands={(props.commands ?? []).map((c: { name: string }) => c.name).join(' ')} />
        <button type="button" onClick={() => props.onSubmit()}>
          editor-submit
        </button>
        <button type="button" onClick={() => props.onSubmit(true)}>
          editor-submit-later
        </button>
      </div>
    )
  })
  return { PromptEditor }
})

/** The commands the `/` menu offers, as the editor was handed them. */
const editorCommands = (): string[] => ((screen.getByLabelText('prompt') as HTMLInputElement).dataset.commands ?? '').split(' ').filter(Boolean)

/** What the editor is actually holding, as opposed to what Start would submit. */
const editorText = (): string => (screen.getByLabelText('prompt') as HTMLInputElement).value

const { BoxNotes, Composer } = await import('./Composer.js')
type ComposerHandle = import('./Composer.js').ComposerHandle

function renderComposer(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onSubmit = vi.fn()
  render(
    <Composer
      files={[]}
      onSubmit={onSubmit}
      busy={false}
      submitLabel="Send"
      submitBusyLabel="Sending…"
      {...over}
    />,
  )
  return { onSubmit }
}

beforeEach(async () => {
  prefs = {}
  updatePreferences.mockReset()
  sessionStorage.clear()
  localStorage.clear()
  resetRunHostsForTest()
  onRunHosts.mockResolvedValue([])
  onCommands.mockReset()
  onCommands.mockResolvedValue({ gitHost: true, remote: true, address: 'github.com/acme/shop' })
})
afterEach(cleanup)

/** The project's modules bring a host beside this computer: "Run on" offers it. */
const withHost = () => onRunHosts.mockResolvedValue([{ id: 'actions', label: 'GitHub Actions' }])

/** A module's control at the right of the row under the box: the coding agent's model, say. */
const ROW_CONTROL: MountedView<'composer.control'> = { place: 'composer.control', id: 'model', at: 'row', package: 'a-module', projects: [], computer: true, View: () => <button type="button">a-model</button> }
const rowControl = () => screen.getByRole('button', { name: 'a-model' })

/** The composer with {@link ROW_CONTROL} mounted, in a launcher's box. */
function renderWithRowControl(over: Partial<Parameters<typeof Composer>[0]> = {}) {
  render(
    <ModulesContext.Provider value={mountedOf({ views: { 'composer.control': [ROW_CONTROL] } })}>
      <Composer files={[]} onSubmit={vi.fn()} busy={false} submitLabel="Send" submitBusyLabel="Sending…" controlBox={{ in: 'launcher', options: {}, onChange: () => {}, busy: false }} {...over} />
    </ModulesContext.Provider>,
  )
}

describe('Composer (#721)', () => {
  test('renders the commands menu and the submit button; with no host beside this machine, no "Run on"', async () => {
    renderComposer({ submitLabel: 'Start session' })
    // Commands have a visible surface (#948): the `/` menu stays the fast path, the button is
    // the discoverable one.
    expect(screen.getByRole('button', { name: 'Commands' })).toBeTruthy()
    await waitFor(() => expect(onRunHosts).toHaveBeenCalledWith('p1'))
    expect(screen.queryByRole('button', { name: /^Run on: / })).toBeNull()
    // The launcher's send is the session's arrow, named for what it does, shown once the prompt has text.
    expect(screen.queryByRole('button', { name: /Start session/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'x' } })
    expect((screen.getByRole('button', { name: /Start session/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  test(`a host the project's modules bring is offered in "Run on", and picking it or this machine leaves the other unpicked (#2394)`, async () => {
    withHost()
    render(
      <ModulesContext.Provider value={mountedOf()}>
        <Composer files={[]} onSubmit={vi.fn()} busy={false} submitLabel="Send" submitBusyLabel="Sending…" />
      </ModulesContext.Provider>,
    )
    const runOn = await screen.findByRole('button', { name: /^Run on: / })
    expect(onRunHosts).toHaveBeenCalledWith('p1')
    await openMenu(runOn)
    fireEvent.click(screen.getByRole('menuitem', { name: /^GitHub Actions/ }))
    expect(screen.getByRole('button', { name: /^Run on: / }).textContent).toBe('GitHub Actions')
    await openMenu(screen.getByRole('button', { name: /^Run on: / }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^This machine/ }))
    expect(screen.getByRole('button', { name: /^Run on: / }).textContent).toBe('This machine')
  })

  test('in a session (#831) the row stays', () => {
    const { onSubmit } = renderComposer({ inAgent: true })
    expect(screen.getByRole('button', { name: 'Commands' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'follow-up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith('follow-up', { later: false, images: [] })
  })

  test("a session's box is called a message's, the launcher's a prompt's", () => {
    renderComposer({ inAgent: true })
    expect(screen.getByLabelText('prompt').dataset['label']).toBe('Message')
    cleanup()
    renderComposer()
    expect(screen.getByLabelText('prompt').dataset['label']).toBe('Prompt')
  })

  test('a session\'s send is hidden until the editor has text, then appears and fires onSubmit', () => {
    const { onSubmit } = renderComposer({ inAgent: true })
    // Empty prompt: nothing to send, so the button is not in the DOM (#721).
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'ship it' } })
    const submit = screen.getByRole('button', { name: 'Send' })
    expect(submit.hasAttribute('disabled')).toBe(false)
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith('ship it', { later: false, images: [] })
  })

  test('the editor\'s Enter submits, and its Cmd/Ctrl+Enter submits for later', async () => {
    const { onSubmit } = renderComposer()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'go' } })
    fireEvent.click(screen.getByText('editor-submit'))
    expect(onSubmit).toHaveBeenCalledWith('go', { later: false, images: [] })
    // The latch against a double press holds until the first submit settled.
    await new Promise(resolve => setTimeout(resolve, 0))
    fireEvent.click(screen.getByText('editor-submit-later'))
    expect(onSubmit).toHaveBeenLastCalledWith('go', { later: true, images: [] })
  })

  test('while OpenAgent is not answering, nothing is sent, by the button or by the keyboard, and the text stays', async () => {
    const { DaemonDown } = await import('../lib/use-daemon-health.js')
    const onSubmit = vi.fn()
    render(
      <DaemonDown.Provider value>
        <Composer files={[]} onSubmit={onSubmit} busy={false} submitLabel="Send" submitBusyLabel="Sending…" />
      </DaemonDown.Provider>,
    )
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'ship it' } })
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByText('editor-submit'))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(editorText()).toBe('ship it')
  })

  test('mirrors prompt changes out via onPromptChange', () => {
    const onPromptChange = vi.fn()
    renderComposer({ onPromptChange })
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'hi' } })
    expect(onPromptChange).toHaveBeenLastCalledWith('hi')
  })

  /** A module offering the project's commands (`composer.commands`): one ready, one waiting to reach the branch runs start from. */
  function commandsModule() {
    const list = vi.fn(async () => [{ name: 'work-queue', description: 'Work the agent queue' }, { name: 'ship', waiting: 'main' }])
    const entry = { place: 'composer.commands' as const, id: 'commands', list, package: '@acme/skills', module: 'skills', projects: ['p1'] }
    return { list, modules: mountedOf({ options: { 'composer.commands': [entry] } }) }
  }

  test("a command a module offers, picked from the menu, loads as its slash line, and what is sent is that line plus the argument typed after it; one still waiting is said so, and the `/` menu leaves it out", async () => {
    forgetRemembered()
    const onLoaded = vi.fn()
    const onSubmit = vi.fn()
    const { list, modules } = commandsModule()
    render(
      <ModulesContext.Provider value={modules}>
        <Composer files={[]} onSubmit={onSubmit} onLoaded={onLoaded} busy={false} submitLabel="Send" submitBusyLabel="Sending…" />
      </ModulesContext.Provider>,
    )
    await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ package: '@acme/skills' }), 'p1'))
    await waitFor(() => expect(editorCommands()).toEqual(['work-queue']))
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
    expect(await screen.findByText('waiting to reach main')).toBeTruthy()
    fireEvent.click(await screen.findByText('/work-queue'))
    expect(editorText()).toBe('/work-queue ')
    expect(onLoaded).toHaveBeenCalledWith('/work-queue', false)
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: '/work-queue now' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith('/work-queue now', { later: false, images: [] })
  })

  /** A module offering saved prompts, as `offered` holds them: deleting one takes it out; its panel saves at a press. */
  function promptsModule(offered: UiPrompt[], of: Partial<MountedView<'composer.prompts'>> = {}) {
    const list = vi.fn(async () => offered)
    const remove = vi.fn(async (_host: unknown, _projectId: string, id: string) => {
      offered = offered.filter(prompt => prompt.id !== id)
      return { ok: true as const }
    })
    const panels: UiPromptSaveProps[] = []
    const SavePanel = (props: UiPromptSaveProps) => {
      panels.push(props)
      return (
        <button type="button" onClick={() => props.onDone(true)}>
          module-save
        </button>
      )
    }
    const entry: MountedView<'composer.prompts'> = { place: 'composer.prompts', id: 'saved-prompts', list, remove, View: SavePanel, package: '@openagt/saved-prompts', projects: ['p1'], ...of }
    return { entry, list, remove, panels }
  }

  test("the saved prompts the project's module offers are in the Commands menu under whose they are: one loads, one is deleted through the module, and Save prompt opens the module's panel with what the box holds (#2394)", async () => {
    forgetRemembered()
    const { entry, list, remove, panels } = promptsModule([
      { id: 'person:a', label: 'Deep review', text: 'Audit this PR.', group: 'Your saved prompts' },
      { id: 'project:b', label: 'Release notes', text: 'Write the notes.', group: 'Project saved prompts' },
    ])
    const onLoaded = vi.fn()
    render(
      <ModulesContext.Provider value={mountedOf({ views: { 'composer.prompts': [entry] } })}>
        <Composer files={[]} onSubmit={vi.fn()} onLoaded={onLoaded} busy={false} submitLabel="Send" submitBusyLabel="Sending…" />
      </ModulesContext.Provider>,
    )
    await waitFor(() => expect(list).toHaveBeenCalledWith(expect.objectContaining({ package: '@openagt/saved-prompts' }), 'p1'))
    await openMenu(screen.getByRole('button', { name: 'Commands' }))
    expect(await screen.findByText('Project saved prompts')).toBeTruthy()
    fireEvent.click(screen.getByText('Deep review'))
    expect(editorText()).toBe('Audit this PR.')
    expect(onLoaded).toHaveBeenCalledWith('Deep review', false)

    await openMenu(screen.getByRole('button', { name: 'Commands' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete saved prompt Release notes' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith(expect.objectContaining({ package: '@openagt/saved-prompts' }), 'p1', 'project:b'))
    await waitFor(() => expect(screen.queryByText('Release notes')).toBeNull())

    await openMenu(screen.getByRole('button', { name: 'Commands' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Save prompt/ }))
    expect(panels.at(-1)).toMatchObject({ projectId: 'p1', text: 'Audit this PR.' })
    const reads = list.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'module-save' }))
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(reads))
    expect(screen.queryByRole('button', { name: 'module-save' })).toBeNull()
  })

  test('with no module offering saved prompts, the Commands menu has none and no way to save one (#2394)', async () => {
    forgetRemembered()
    render(
      <ModulesContext.Provider value={commandsModule().modules}>
        <Composer files={[]} onSubmit={vi.fn()} busy={false} submitLabel="Send" submitBusyLabel="Sending…" />
      </ModulesContext.Provider>,
    )
    await openMenu(screen.getByRole('button', { name: 'Commands' }))
    expect(await screen.findByText('/work-queue')).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Save prompt/ })).toBeNull()
  })

  test('with no module offering commands, the Commands menu says the project has none', async () => {
    forgetRemembered()
    renderComposer()
    await openMenu(screen.getByRole('button', { name: 'Commands' }))
    expect(await screen.findByText('This project has no commands.')).toBeTruthy()
  })

  // #1139: a draft carried across a navigation lands in sessionStorage; the launcher seeds it into
  // the editor on mount, and takes it once.
  test('the launcher rehydrates a carried draft (#1139)', () => {
    sessionStorage.setItem('oa.pending-draft', 'carried from a ticket')
    const { onSubmit } = renderComposer({ submitLabel: 'Start session' })
    fireEvent.click(screen.getByRole('button', { name: /Start session/ }))
    expect(onSubmit).toHaveBeenCalledWith('carried from a ticket', { later: false, images: [] })
    expect(sessionStorage.getItem('oa.pending-draft')).toBeNull() // taken once
  })

  test('a carried draft is IN the editor, not just in what Start would send (#1139)', () => {
    // The regression the stub models: the draft is taken and cleared on the first render, while the
    // editor is not there yet to receive it. Seeding it as `initialText` is what keeps those two
    // facts from cancelling out. Asserted on the box rather than on submit, because submit was
    // right the whole time this was broken — the user was the one looking at an empty composer.
    const draft = 'Work on tickets/a.md. Do not start any other ticket.'
    sessionStorage.setItem('oa.pending-draft', draft)
    renderComposer({ submitLabel: 'Start session' })
    expect(editorText()).toBe(draft)
  })

  test('what is typed is back when the box is drawn again, after a navigation or a reload, for that box alone, until it is sent', () => {
    renderComposer({ draftKey: 'launcher:p1' })
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'a long draft I care about' } })
    cleanup()
    renderComposer({ draftKey: 'p1:run-2' })
    expect(editorText()).toBe('')
    cleanup()
    renderComposer({ draftKey: 'launcher:p1' })
    expect(editorText()).toBe('a long draft I care about')
    // Sent: the caller empties the box, and nothing is kept.
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: '' } })
    cleanup()
    renderComposer({ draftKey: 'launcher:p1' })
    expect(editorText()).toBe('')
  })

  test('a draft handed over to a box that kept one is loaded over it, said as a load over a draft, and the kept one is under it for an undo', () => {
    const onLoaded = vi.fn()
    localStorage.setItem('oa.draft:launcher:p1', 'my own long draft')
    sessionStorage.setItem('oa.pending-draft', 'carried from a ticket')
    renderComposer({ draftKey: 'launcher:p1', onLoaded })
    expect(editorText()).toBe('carried from a ticket')
    expect(screen.getByLabelText('prompt').getAttribute('data-replaced')).toBe('my own long draft')
    expect(onLoaded).toHaveBeenCalledWith('The prompt', true)
    cleanup()
    onLoaded.mockReset()
    // The same words handed over again replace nothing.
    sessionStorage.setItem('oa.pending-draft', 'carried from a ticket')
    renderComposer({ draftKey: 'launcher:p1', onLoaded })
    expect(screen.getByLabelText('prompt').getAttribute('data-replaced')).toBeNull()
    expect(onLoaded).not.toHaveBeenCalled()
  })

  test('on a phone a kept draft comes back without the caret, and one a press handed over takes it; elsewhere a kept draft takes it', () => {
    const seedFocus = () => screen.getByLabelText('prompt').getAttribute('data-seed-focus')
    localStorage.setItem('oa.draft:launcher:p1', 'a long draft I care about')
    renderComposer({ draftKey: 'launcher:p1' })
    expect(seedFocus()).toBe('true')
    cleanup()
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    try {
      renderComposer({ draftKey: 'launcher:p1' })
      expect(editorText()).toBe('a long draft I care about')
      expect(seedFocus()).toBe('false')
      cleanup()
      sessionStorage.setItem('oa.pending-draft', 'carried from a ticket')
      renderComposer({ draftKey: 'launcher:p1' })
      expect(editorText()).toBe('carried from a ticket')
      expect(seedFocus()).toBe('true')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('words handed back go after what is typed in the box, and are kept with it', () => {
    const box = createRef<ComposerHandle>()
    const onSubmit = vi.fn()
    render(<Composer ref={box} files={[]} onSubmit={onSubmit} busy={false} submitLabel="Send" submitBusyLabel="Sending…" inAgent draftKey="p1:run-2" />)
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'a new thought' } })
    act(() => box.current!.append('the words it never read'))
    expect(localStorage.getItem('oa.draft:p1:run-2')).toBe('a new thought\n\nthe words it never read')
    fireEvent.click(screen.getByText('editor-submit'))
    expect(onSubmit).toHaveBeenCalledWith('a new thought\n\nthe words it never read', { later: false, images: [] })
  })

  test('a browser that keeps nothing still has the draft in the box, and it is sent', () => {
    const refuse = () => {
      throw new DOMException('The storage is off', 'SecurityError')
    }
    const refused = (['getItem', 'setItem', 'removeItem'] as const).map(method => vi.spyOn(Storage.prototype, method).mockImplementation(refuse))
    try {
      const onPromptChange = vi.fn()
      const { onSubmit } = renderComposer({ inAgent: true, draftKey: 'p1:run-2', onPromptChange })
      fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'a draft with nowhere to go' } })
      expect(editorText()).toBe('a draft with nowhere to go')
      expect(onPromptChange).toHaveBeenLastCalledWith('a draft with nowhere to go')
      fireEvent.click(screen.getByText('editor-submit'))
      expect(onSubmit).toHaveBeenCalledWith('a draft with nowhere to go', { later: false, images: [] })
    } finally {
      for (const spy of refused) spy.mockRestore()
    }
  })

  test('an in-session composer does not rehydrate a carried draft (#1066)', () => {
    sessionStorage.setItem('oa.pending-draft', 'not for here')
    renderComposer({ inAgent: true })
    expect(sessionStorage.getItem('oa.pending-draft')).toBe('not for here') // launcher-only
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull() // nothing seeded
  })

  test('the row above the box: the launcher\'s holds "Run on" alone, where a host is offered; inside a session, the one it is given, in the same place, and no "Run on" of its own', async () => {
    withHost()
    renderComposer()
    // In the row that stands right before the box.
    const followedByBox = (el: Element) => {
      for (let row = el.parentElement; row; row = row.parentElement) if (row.nextElementSibling === box()) return true
      return false
    }
    expect(followedByBox(await screen.findByRole('button', { name: /^Run on: / }))).toBe(true)
    cleanup()
    renderComposer({ inAgent: true, sessionRow: <div><span>where it started</span></div> })
    expect(followedByBox(screen.getByText('where it started'))).toBe(true)
    expect(screen.queryByRole('button', { name: /^Run on: / })).toBeNull()
  })

  test('the caller\'s notes lie over the page above the box, none in the box\'s flow; a page that keeps a place for them gets them there', () => {
    renderComposer({ notes: <p role="alert">Could not send.</p> })
    const notes = screen.getByRole('alert').parentElement!
    expect(notes.parentElement!.className).toContain('absolute')
    expect(notes.parentElement!.className).toContain('bottom-full')
    cleanup()
    // Where the page's own words are right above the box, they hang under its row.
    render(<Composer files={[]} onSubmit={vi.fn()} busy={false} submitLabel="Send" submitBusyLabel="Sending…" notesUnder notes={<p role="alert">Could not send.</p>} />)
    expect(screen.getByRole('alert').parentElement!.parentElement!.className).toContain('top-full')
    expect(screen.getByLabelText('prompt').closest('.border')!.contains(notes)).toBe(false)
    cleanup()
    const place = document.createElement('div')
    document.body.append(place)
    render(
      <BoxNotes.Provider value={place}>
        <Composer files={[]} onSubmit={vi.fn()} busy={false} submitLabel="Send" submitBusyLabel="Sending…" notes={<p role="alert">Could not send.</p>} />
      </BoxNotes.Provider>,
    )
    expect(place.contains(screen.getByRole('alert'))).toBe(true)
    place.remove()
  })

  test('a box whose send is on its way sends nothing more, by the arrow or the keyboard, and keeps what is typed', () => {
    const { onSubmit } = renderComposer({ busy: true })
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'ship it' } })
    // The send waits, its spinner in full, refusing presses.
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(screen.getByText('editor-submit'))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(editorText()).toBe('ship it')
  })

})

// The bordered box: the nearest element around the editor that draws the border.
const box = (): HTMLElement => {
  let el: HTMLElement = screen.getByLabelText('prompt')
  while (!el.className.split(' ').includes('border')) el = el.parentElement!
  return el
}
const commands = () => screen.getByRole('button', { name: 'Commands' })

describe('the box', () => {
  test('with the keyboard in it, or in the menu its + opened, its hairline is a step brighter and its shadow a step deeper: no ring, and no colour', () => {
    renderComposer()
    const cls = box().className.split(' ')
    expect(cls).toEqual(expect.arrayContaining(['border-hairline', 'shadow-lg', 'focus-within:border-hairline-strong', 'focus-within:shadow-lift', 'has-[[aria-expanded=true]]:border-hairline-strong', 'has-[[aria-expanded=true]]:shadow-lift']))
    expect(cls.filter(c => c.includes('outline') || c.includes('ring') || c.includes('border-primary'))).toEqual([])
  })

  test('it holds the commands menu, the text and the submit: the modules\' row controls and "Run on" are outside it, on rows of their own', async () => {
    withHost()
    renderWithRowControl()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'x' } })
    expect(box().contains(screen.getByRole('button', { name: 'Send' }))).toBe(true)
    expect(box().contains(commands())).toBe(true)
    expect(box().contains(rowControl())).toBe(false)
    expect(box().contains(await screen.findByRole('button', { name: /^Run on: / }))).toBe(false)
    cleanup()
    renderComposer({ inAgent: true })
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'x' } })
    expect(box().contains(screen.getByRole('button', { name: 'Send' }))).toBe(true)
  })

  test('the commands menu is at the left of the text and a session\'s send at its right, both kept at its last line', () => {
    renderComposer({ inAgent: true })
    const editor = screen.getByLabelText('prompt')
    const submit = box().querySelector('button[aria-label="Send"]')!
    // With no image, the box is the one row: the +, the text and the send, kept at its last line.
    const row = box().firstElementChild as HTMLElement
    expect(row.firstElementChild!.contains(commands())).toBe(true)
    expect(commands().compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(editor.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row.className).toContain('items-end')
  })

  test('a session\'s idle control takes the submit\'s place in the box', () => {
    renderComposer({ inAgent: true, idleControl: <button type="button">stop</button> })
    expect(box().contains(screen.getByRole('button', { name: 'stop' }))).toBe(true)
  })
})

const runOn = () => screen.getByRole('button', { name: /^Run on: / })

describe('the rows around the box', () => {
  test('where the agent runs is a row above the box, "Run on"; under it, the gear, then the caller\'s controls, and the modules\' row controls at the right', async () => {
    withHost()
    renderWithRowControl({ controls: <span>a-control</span>, setup: { said: 'Profile Default · 3 skills', lines: <span>a-line</span> } })
    await screen.findByRole('button', { name: /^Run on: / })
    const above = box().previousElementSibling!
    const under = box().nextElementSibling!
    const control = screen.getByText('a-control')
    const gear = screen.getByRole('button', { name: 'Session setup' })
    const select = rowControl()
    // The gear leads the row, on the box's left edge; its lines are in its menu, not in the row.
    expect(under.contains(gear)).toBe(true)
    expect(gear.parentElement!.firstElementChild).toBe(gear)
    expect(gear.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(under.contains(screen.getByText('a-line'))).toBe(false)
    expect(above.contains(runOn())).toBe(true)
    expect(under.contains(control)).toBe(true)
    expect(under.contains(select)).toBe(true)
    expect(control.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Run on: / })).toHaveLength(1)
    // Said in words, drawn as every item of the rows is: no border of its own.
    expect(runOn().textContent).toBe('This machine')
    expect(runOn().className).not.toContain('border')
    // Each one line of a fixed height: a longer label at the left cannot move the select or the page.
    for (const row of [above, under]) {
      expect(row.className).toContain('h-8')
      expect(row.className).not.toContain('flex-wrap')
    }
    // The model is the row's last, so it ends on the box's right edge.
    expect(under.lastElementChild).toBe(select)
  })

  test('with nothing of the caller\'s, the row above still carries "Run on", and the row under the modules\' controls', async () => {
    withHost()
    renderWithRowControl()
    const runOnButton = await screen.findByRole('button', { name: /^Run on: / })
    expect(box().previousElementSibling!.contains(runOnButton)).toBe(true)
    expect(box().nextElementSibling!.contains(rowControl())).toBe(true)
  })

  test("the gear's menu opens above the box, holds the caller's lines under \"This session\", and its hover says them with the menu shut; with no setup there is no gear", async () => {
    renderComposer({ setup: { said: 'Profile Default · 3 skills', lines: <span>a-line</span> } })
    const gear = screen.getByRole('button', { name: 'Session setup' })
    expect((await hoverTooltip(gear)).textContent).toBe('Profile Default · 3 skills')
    await openMenu(gear)
    const menu = await screen.findByRole('menu')
    expect(menu.textContent).toBe('This sessiona-line')
    expect(menu.closest('[data-side]')!.getAttribute('data-side')).toBe('top')
    cleanup()
    renderComposer()
    expect(screen.queryByRole('button', { name: 'Session setup' })).toBeNull()
  })

  test("a session's words of its own close the row under the box", () => {
    renderComposer({ inAgent: true, sessionContext: <span>a-context</span> })
    expect(box().nextElementSibling!.lastElementChild!.textContent).toBe('a-context')
  })
})

describe('in a session', () => {
  test('there is no "Run on" pick: a session already runs where it was started', () => {
    renderComposer({ inAgent: true })
    expect(screen.queryByRole('button', { name: /^Run on: / })).toBeNull()
    expect(screen.getByRole('button', { name: 'Commands' })).toBeTruthy()
  })

  test('there is no row above the box: the box is the first thing the composer draws', () => {
    renderComposer({ inAgent: true })
    expect(box().previousElementSibling).toBeNull()
  })
})

describe('images', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const image = (name = 'shot.png', type = 'image/png') => new File([PNG], name, { type })
  const kept = (n: number) => `${String(n).repeat(64)}.png`
  /** A paste of `files`, and of words too when `text` is given, as a browser hands them to the box. */
  const paste = (files: File[], text?: string) =>
    fireEvent.paste(screen.getByLabelText('prompt'), { clipboardData: { files, types: [...(text !== undefined ? ['text/plain'] : []), 'Files'], getData: () => text ?? '' } })
  const drop = (files: File[]) => fireEvent.drop(box(), { dataTransfer: { files, types: ['Files'] } })
  const tiles = () => screen.queryAllByRole('button', { name: /^Open image / })
  // The module that keeps the images: its keep stands in for its server part.
  const sendImage = vi.fn()
  const store = imageStore((_host, image) => sendImage(image.type, image.data))
  const renderComposer = (over: Partial<Parameters<typeof Composer>[0]> = {}) => {
    const onSubmit = vi.fn()
    render(
      <ModulesContext.Provider value={mountedOf({ options: { 'composer.images': [store] } })}>
        <Composer files={[]} onSubmit={onSubmit} busy={false} submitLabel="Send" submitBusyLabel="Sending…" {...over} />
      </ModulesContext.Provider>,
    )
    return { onSubmit }
  }

  beforeEach(() => {
    sendImage.mockReset()
    let made = 0
    URL.createObjectURL = vi.fn(() => `blob:image-${(made += 1)}`)
    URL.revokeObjectURL = vi.fn()
  })

  test('a pasted screenshot is a tile in a row above the text, inside the box, kept at once; the send goes with its name', async () => {
    sendImage.mockResolvedValue({ ok: true, name: kept(1) })
    const { onSubmit } = renderComposer({ inAgent: true })
    paste([image()])
    expect(tiles()).toHaveLength(1)
    const row = screen.getByRole('list', { name: 'Images' })
    expect(box().contains(row)).toBe(true)
    expect(row.compareDocumentPosition(screen.getByLabelText('prompt')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row.className).toContain('gap-2')
    expect(row.querySelector('li')!.className).toContain('size-[120px]')
    expect(row.querySelector('li')!.className).toContain('rounded-[10px]')
    expect(row.querySelector('img')!.className).toContain('object-contain')
    await waitFor(() => expect(sendImage).toHaveBeenCalledWith('image/png', btoa(String.fromCharCode(...PNG))))
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'What word is in it?' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith('What word is in it?', { later: false, images: [kept(1)] })
  })

  test('the send waits while an image is still being kept, and while one could not be, until its X takes it out', async () => {
    let answer: (value: unknown) => void = () => {}
    sendImage.mockReturnValueOnce(new Promise(resolve => (answer = resolve))).mockResolvedValueOnce({ ok: false, error: 'The image is larger than the agent takes' })
    const { onSubmit } = renderComposer({ inAgent: true })
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'Look' } })
    paste([image()])
    await waitFor(() => expect(sendImage).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('status', { name: 'Keeping the image' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true)
    await act(async () => answer({ ok: true, name: kept(2) }))
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false)
    drop([image('big.png')])
    expect(await screen.findByRole('img', { name: 'Image 2: The image is larger than the agent takes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Remove image 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith('Look', { later: false, images: [kept(2)] })
  })

  test('the X on a tile takes it out; a paste of words is the editor\'s, a kind the agent cannot read is refused on its tile, and a drop of no image says so', async () => {
    sendImage.mockResolvedValue({ ok: true, name: kept(3) })
    renderComposer({ inAgent: true })
    drop([image('a.png'), image('b.png')])
    expect(tiles()).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Remove image 1' }))
    expect(tiles()).toHaveLength(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-1')
    // A copied page carries a picture of itself beside its words: the words go in the text.
    paste([image()], 'some words')
    expect(tiles()).toHaveLength(1)
    paste([image('scan.heic', 'image/heic')])
    expect(await screen.findByRole('img', { name: /^Image 2: HEIC is not an image the agent reads/ })).toBeTruthy()
    drop([new File(['x'], 'notes.txt', { type: 'text/plain' })])
    expect(screen.getByText('Only images go with a message.')).toBeTruthy()
  })

  test('the box keeps its images with its draft across a reload, and a cleared box hands them back for a restore', async () => {
    sendImage.mockResolvedValue({ ok: true, name: kept(4) })
    const ref = createRef<ComposerHandle>()
    renderComposer({ inAgent: true, draftKey: 'p1:run-1', ref })
    paste([image()])
    await waitFor(() => expect(JSON.parse(localStorage.getItem('oa.draft-images:p1:run-1') ?? '[]')).toEqual([kept(4)]))
    cleanup()
    renderComposer({ inAgent: true, draftKey: 'p1:run-1', ref })
    expect(screen.getByRole('list', { name: 'Images' }).querySelector('img')!.getAttribute('src')).toBe(`/_images/${kept(4)}`)
    let draft: ReturnType<ComposerHandle['clear']> | undefined
    act(() => void (draft = ref.current!.clear()))
    expect(draft!.images).toEqual([kept(4)])
    expect(tiles()).toHaveLength(0)
    expect(localStorage.getItem('oa.draft-images:p1:run-1')).toBeNull()
    act(() => ref.current!.restore(draft!))
    expect(tiles()).toHaveLength(1)
  })

  test('where no module keeps images, a box takes none: a pasted image stays out of it', () => {
    render(<Composer files={[]} onSubmit={vi.fn()} busy={false} submitLabel="Send" submitBusyLabel="Sending…" inAgent />)
    paste([image()])
    expect(tiles()).toHaveLength(0)
    expect(sendImage).not.toHaveBeenCalled()
  })

  test('a click on a tile shows the image large over the page; its X and Esc close it', async () => {
    sendImage.mockResolvedValue({ ok: true, name: kept(5) })
    renderComposer({ inAgent: true })
    paste([image()])
    fireEvent.click(tiles()[0]!)
    const large = await screen.findByRole('dialog', { name: 'Image' })
    expect(large.querySelector('img')!.getAttribute('src')).toBe('blob:image-1')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Image' })).toBeNull())
    fireEvent.click(tiles()[0]!)
    await screen.findByRole('dialog', { name: 'Image' })
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Image' })).toBeNull())
  })
})
