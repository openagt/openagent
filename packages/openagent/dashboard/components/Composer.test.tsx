import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Preferences } from '../../src/index.js'
import { selectMachine } from '../lib/remote-target.js'
import { hoverTooltip, openMenu } from '../test-utils.js'

// Preferences are the shared daemon store; stub them so the composer reads a fixed value.
const updatePreferences = vi.hoisted(() => vi.fn())
let prefs: Preferences = {}
vi.mock('../lib/preferences.js', () => ({
  usePreferences: () => prefs,
  updatePreferences,
  // #1025: the project's saved prompts; none here.
  useProjectPresets: () => [],
  saveProjectPresetList: vi.fn(),
  useActiveProjectId: () => 'p1',
}))
// The editor picker (#727) detects installed editors over an RPC; stub it to none in the test.
vi.mock('../lib/editors.js', () => ({ useDetectedEditors: () => [] }))
// Composer loads its own projects for the `@` picker (#743) and the project's commands for the
// `/` list; stub the reads.
const onCommands = vi.hoisted(() => vi.fn())
vi.mock('../rpc/projects.js', () => ({ onProjects: () => Promise.resolve([]), onCommands }))
// The saved machines and their health poll (#1072) are the daemon's, reached over an RPC: a
// pretend daemon each test seeds, and answers online/offline through, for the "Run on" target (#1073).
vi.mock('../rpc/machines.js', async () => (await import('../test-machines.js')).machinesRpc)
import { daemon, machinesRpc, saveMachines } from '../test-machines.js'

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
    }))
    const seeded = useRef(false)
    useEffect(() => {
      if (!ready || seeded.current || !props.initialText) return
      seeded.current = true
      put(props.initialText)
    }, [ready, props.initialText])
    return (
      <div>
        <input aria-label="prompt" value={held} onChange={e => put(e.target.value)} disabled={props.disabled} />
        <button type="button" onClick={() => props.onSubmit()}>
          editor-submit
        </button>
      </div>
    )
  })
  return { PromptEditor }
})

/** What the editor is actually holding, as opposed to what Start would submit. */
const editorText = (): string => (screen.getByLabelText('prompt') as HTMLInputElement).value

const { Composer } = await import('./Composer.js')

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
  selectMachine(null)
  await saveMachines() // default: no machine saved
  onCommands.mockReset()
  onCommands.mockResolvedValue({ commands: [{ name: 'work-queue', description: 'Work the agent queue' }], startHook: true, gitHost: true, remote: true, address: 'github.com/acme/shop' })
})
afterEach(cleanup)

const STUDIO = 'http://192.168.1.5:4200'
const STUDIO_MACHINE = { id: STUDIO, label: 'Studio', url: STUDIO }

// The driver/model trigger names both in its own label (#1143): with no model pinned it is a logo
// and a chevron, so the name cannot come from the rendered text the way it used to.
const agentTrigger = () => screen.getByRole('button', { name: /^Driver: / })

describe('Composer (#721)', () => {
  test('renders the commands menu, the agent/model select, "Run on", and the submit button', async () => {
    renderComposer({ submitLabel: 'Start session' })
    // Commands have a visible surface (#948): the `/` menu stays the fast path, the button is
    // the discoverable one.
    expect(screen.getByRole('button', { name: 'Commands' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run on' })).toBeTruthy()
    expect((await hoverTooltip(agentTrigger())).textContent).toContain('Driver: Claude Code')
    // The submit button appears only once the prompt has text (#721).
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'x' } })
    expect(screen.getByRole('button', { name: /Start session/ })).toBeTruthy()
  })

  test('compact (#723) keeps the agent/model + "Run on" controls (#755)', async () => {
    const { onSubmit } = renderComposer({ compact: true, submitLabel: 'Start' })
    // They used to be dropped here, which meant a navbar agent silently used the stored agent
    // and model with nothing on screen saying which.
    expect(screen.queryByRole('button', { name: 'Run on' })).not.toBeNull()
    expect((await hoverTooltip(agentTrigger())).textContent).toContain('Driver: Claude Code')
    // The editor + submit still work (so `/` `@` `#` triggers remain live in the editor).
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'quick run' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    expect(onSubmit).toHaveBeenCalledWith('quick run')
  })

  test('showDriverModel={false} (#831) drops the agent/model select, keeping the rest of the row', () => {
    const { onSubmit } = renderComposer({ showDriverModel: false })
    // An in-session composer: the session is bound to the agent it started with, so offering the
    // select there would only ever rewrite the next session's default.
    expect(screen.queryByRole('button', { name: /^Driver: / })).toBeNull()
    expect(screen.getByRole('button', { name: 'Commands' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'follow-up' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith('follow-up')
  })

  test('the submit button is hidden until the editor has text, then appears and fires onSubmit', () => {
    const { onSubmit } = renderComposer()
    // Empty prompt: nothing to send, so the button is not in the DOM (#721).
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'ship it' } })
    const submit = screen.getByRole('button', { name: 'Send' })
    expect(submit.hasAttribute('disabled')).toBe(false)
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith('ship it')
  })

  test('the editor shortcut (Cmd/Ctrl+Enter) submits too', () => {
    const { onSubmit } = renderComposer()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'go' } })
    fireEvent.click(screen.getByText('editor-submit'))
    expect(onSubmit).toHaveBeenCalledWith('go')
  })

  test('mirrors prompt changes out via onPromptChange', () => {
    const onPromptChange = vi.fn()
    renderComposer({ onPromptChange })
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'hi' } })
    expect(onPromptChange).toHaveBeenLastCalledWith('hi')
  })

  test('a command picked from the menu loads as its slash line, and what is sent is that line plus the argument typed after it', async () => {
    const onPreset = vi.fn()
    const { onSubmit } = renderComposer({ onPreset })
    await waitFor(() => expect(onCommands).toHaveBeenCalledWith('p1'))
    fireEvent.click(screen.getByRole('button', { name: 'Commands' }))
    fireEvent.click(await screen.findByText('/work-queue'))
    expect(editorText()).toBe('/work-queue ')
    expect(onPreset).toHaveBeenCalledWith('/work-queue', false)
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: '/work-queue now' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith('/work-queue now')
  })

  test('canSubmit={false} keeps the submit off, by click and by shortcut', () => {
    const { onSubmit } = renderComposer({ canSubmit: false })
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'ship it' } })
    const submit = screen.getByRole('button', { name: 'Send' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.click(submit)
    fireEvent.click(screen.getByText('editor-submit'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  // #1139: a draft carried across a navigation lands in sessionStorage; the launcher seeds it into
  // the editor on mount, and takes it once.
  test('the launcher rehydrates a carried draft (#1139)', () => {
    sessionStorage.setItem('oa.pending-draft', 'carried from a ticket')
    const { onSubmit } = renderComposer({ submitLabel: 'Start session' })
    fireEvent.click(screen.getByRole('button', { name: /Start session/ }))
    expect(onSubmit).toHaveBeenCalledWith('carried from a ticket')
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

  test('an in-session composer does not rehydrate a carried draft (#1066)', () => {
    sessionStorage.setItem('oa.pending-draft', 'not for here')
    renderComposer({ inAgent: true })
    expect(sessionStorage.getItem('oa.pending-draft')).toBe('not for here') // launcher-only
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull() // nothing seeded
  })

  // #1073: pressing Start on an offline "Run on" machine would silently attempt the ~15s relay, so
  // Start is blocked with a reason pointing back to the "Run on" pick. No auto-fallback: the target stays.
  test('an offline "Run on" machine disables Start and shows the reason (#1073)', async () => {
    await saveMachines(STUDIO_MACHINE)
    daemon.reachable = { [STUDIO]: false }
    selectMachine(STUDIO)
    const { onSubmit } = renderComposer()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'ship it' } })
    await waitFor(() => expect(screen.getByText(/Studio is offline/)).toBeTruthy())
    const submit = screen.getByRole('button', { name: 'Send' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    // Both the click and the editor shortcut are blocked.
    fireEvent.click(submit)
    fireEvent.click(screen.getByText('editor-submit'))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('an online "Run on" machine leaves Start enabled with no offline note (#1073)', async () => {
    await saveMachines(STUDIO_MACHINE)
    daemon.reachable = { [STUDIO]: true }
    selectMachine(STUDIO)
    const { onSubmit } = renderComposer()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'ship it' } })
    await waitFor(() => expect(machinesRpc.onMachinesReachable).toHaveBeenCalled())
    expect(screen.queryByText(/is offline/)).toBeNull()
    const submit = screen.getByRole('button', { name: 'Send' })
    expect(submit.hasAttribute('disabled')).toBe(false)
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith('ship it')
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
  test('it holds the text and the submit alone: the commands menu, the model and "Run on" are outside it', () => {
    renderComposer()
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'x' } })
    expect(box().contains(screen.getByRole('button', { name: 'Send' }))).toBe(true)
    expect(box().contains(commands())).toBe(false)
    expect(box().contains(agentTrigger())).toBe(false)
    expect(box().contains(screen.getByRole('button', { name: 'Run on' }))).toBe(false)
  })

  test('the submit is at the right of the text and stays at its last line', () => {
    renderComposer()
    const editor = screen.getByLabelText('prompt')
    const submit = box().querySelector('button[aria-label="Send"]')!
    expect(editor.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(box().className).toContain('items-end')
  })

  test('a session\'s idle control takes the submit\'s place in the box', () => {
    renderComposer({ inAgent: true, idleControl: <button type="button">stop</button> })
    expect(box().contains(screen.getByRole('button', { name: 'stop' }))).toBe(true)
  })
})

describe('the row under the box', () => {
  test('the commands menu, then the caller\'s controls, then the agent/model select at the right, in one row right under the box', () => {
    renderComposer({ belowControls: <span>below-left</span> })
    const row = box().nextElementSibling!
    const left = screen.getByText('below-left')
    const select = agentTrigger()
    expect(row.contains(commands())).toBe(true)
    expect(row.contains(left)).toBe(true)
    expect(row.contains(select)).toBe(true)
    expect(commands().compareDocumentPosition(left) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(left.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // One line of a fixed height: a longer label at the left cannot move the select or the page.
    expect(row.className).toContain('h-8')
    expect(row.className).not.toContain('flex-wrap')
    expect(select.parentElement!.className).toContain('shrink-0')
  })

  test('with no controls of the caller, the row still carries the commands menu and the select', () => {
    renderComposer()
    const row = box().nextElementSibling!
    expect(row.contains(commands())).toBe(true)
    expect(row.contains(agentTrigger())).toBe(true)
  })

  test('in a session the model is said in words where the select would be, and is no button', () => {
    renderComposer({ inAgent: true, showDriverModel: false, sessionModel: 'Opus 5.5' })
    const row = box().nextElementSibling!
    const said = screen.getByText('Opus 5.5')
    expect(row.contains(said)).toBe(true)
    expect(said.closest('button')).toBeNull()
    expect(commands().compareDocumentPosition(said) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Driver: / })).toBeNull()
  })

  test('a session whose model is not known says none', () => {
    renderComposer({ inAgent: true, showDriverModel: false })
    expect(box().nextElementSibling!.textContent).toBe('')
  })
})

const runOn = () => screen.getByRole('button', { name: 'Run on' })

describe('the row of chips above the box', () => {
  test('with aboveControls, the "Run on" chip and then its content are in one row above the box, and "Run on" is not in the box', () => {
    renderComposer({ aboveControls: <span>a-chip</span> })
    const row = box().previousElementSibling!
    const chip = screen.getByText('a-chip')
    expect(row.contains(runOn())).toBe(true)
    expect(row.contains(chip)).toBe(true)
    expect(runOn().compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(box().contains(runOn())).toBe(false)
    expect(screen.getAllByRole('button', { name: 'Run on' })).toHaveLength(1)
    // Drawn as a chip: it says the target in words.
    expect(runOn().textContent).toBe('This machine')
    // One line of a fixed height, and the chips after "Run on" are the first to give way.
    expect(row.className).toContain('h-6')
    expect(row.className).not.toContain('flex-wrap')
    expect(chip.parentElement!.className).toContain('min-w-0')
    expect(chip.parentElement!.className).toContain('shrink-[100]')
  })

  test('with no chips of the caller, the row still carries the "Run on" chip', () => {
    renderComposer()
    expect(box().previousElementSibling!.contains(runOn())).toBe(true)
    expect(box().contains(runOn())).toBe(false)
  })

  test('the chip reads the picked machine, and its menu picks a machine and this machine again', async () => {
    await saveMachines(STUDIO_MACHINE)
    renderComposer({ aboveControls: null })
    expect(runOn().textContent).toBe('This machine')
    await openMenu(runOn())
    fireEvent.click(screen.getByRole('menuitem', { name: /^Studio/ }))
    await waitFor(() => expect(runOn().textContent).toBe('Studio'))
    await openMenu(runOn())
    fireEvent.click(screen.getByRole('menuitem', { name: /^This machine/ }))
    await waitFor(() => expect(runOn().textContent).toBe('This machine'))
  })

  test('in a project with no repository address the chip reads "This machine" whatever was picked before, and an offline machine does not block the Start', async () => {
    // Its origin is a folder on this disk: a remote, and still no name another machine knows it by.
    onCommands.mockResolvedValue({ commands: [], startHook: true, gitHost: false, remote: true })
    await saveMachines(STUDIO_MACHINE)
    daemon.reachable = { [STUDIO]: false }
    selectMachine(STUDIO)
    const { onSubmit } = renderComposer({ aboveControls: null })
    await waitFor(() => expect(runOn().textContent).toBe('This machine'))
    fireEvent.change(screen.getByLabelText('prompt'), { target: { value: 'ship it' } })
    expect(screen.queryByText(/is offline/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith('ship it')
  })

  test('an offline picked machine still reads its label on the chip, with the note under the box', async () => {
    await saveMachines(STUDIO_MACHINE)
    daemon.reachable = { [STUDIO]: false }
    selectMachine(STUDIO)
    renderComposer({ aboveControls: null })
    await waitFor(() => expect(screen.getByText(/Studio is offline/)).toBeTruthy())
    expect(runOn().textContent).toBe('Studio')
  })

  test('the compact form has no row of chips: "Run on" stays an icon button in its one row', () => {
    renderComposer({ compact: true, aboveControls: <span>a-chip</span> })
    expect(screen.queryByText('a-chip')).toBeNull()
    expect(runOn().textContent).toBe('')
  })
})

describe('in a session', () => {
  test('there is no "Run on" pick: a session already runs where it was started', () => {
    renderComposer({ inAgent: true })
    expect(screen.queryByRole('button', { name: 'Run on' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Commands' })).toBeTruthy()
  })

  test('there is no row of chips: the box is the first thing the composer draws', () => {
    renderComposer({ inAgent: true, showDriverModel: false })
    expect(box().previousElementSibling).toBeNull()
  })
})
