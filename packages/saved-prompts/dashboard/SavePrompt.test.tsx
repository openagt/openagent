import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { SavePrompt } from './SavePrompt.js'

// The "Save prompt" dialog over the message box, its server part answering as a test says: in a
// project unless `inProject` is false, saving what it is sent.

afterEach(cleanup)

function open({ text = '', inProject = true, saved = (): ModuleCallResult => ({ ok: true, output: { id: 'x', label: 'l', text: 't' } }) } = {}) {
  const call = vi.fn(async (_projectId: string, name: string, _input: object): Promise<ModuleCallResult> => (name === 'prompts' ? { ok: true, output: inProject ? { person: [], project: [] } : { person: [] } } : saved()))
  const onDone = vi.fn()
  renderWithHost(<SavePrompt projectId="shop" text={text} onDone={onDone} />, fakeHost('@openagt/saved-prompts', { call }))
  const sent = () => call.mock.calls.filter(([projectId, name]) => projectId === 'shop' && name === 'save').map(([, , input]) => input)
  return { onDone, sent }
}

describe('Save prompt (#649, #2394)', () => {
  test("prefills what the box holds and saves it under its name, as the person's", async () => {
    const { onDone, sent } = open({ text: 'my crafted prompt' })
    expect((screen.getByPlaceholderText(/The prompt to save/) as HTMLTextAreaElement).value).toBe('my crafted prompt')
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: ' My prompt ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true))
    expect(sent()).toEqual([{ label: 'My prompt', text: 'my crafted prompt', whose: 'person' }])
  })

  test('cannot save without both a name and a prompt, and each field says what it needs while it is empty; Enter in the name saves', async () => {
    const { sent } = open()
    expect((screen.getByRole('button', { name: 'Save prompt' }) as HTMLButtonElement).disabled).toBe(true)
    const name = screen.getByRole('textbox', { name: 'Name' })
    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    const needs = (field: HTMLElement) => document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent
    expect(needs(name)).toBe('Name it to save it: Commands lists it by its name.')
    expect(needs(prompt)).toBe('Write the prompt it loads into the box.')
    fireEvent.change(name, { target: { value: 'My prompt' } })
    fireEvent.change(prompt, { target: { value: 'sweep it' } })
    expect(name.hasAttribute('aria-describedby')).toBe(false)
    expect(prompt.hasAttribute('aria-describedby')).toBe(false)
    fireEvent.submit(name.closest('form')!)
    await waitFor(() => expect(sent()).toEqual([{ label: 'My prompt', text: 'sweep it', whose: 'person' }]))
  })

  test("in a project, it may be saved as the project's", async () => {
    const { sent } = open({ text: 'shared prompt' })
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Team prompt' } })
    fireEvent.click(await screen.findByRole('button', { name: 'This project' }))
    expect(screen.getByText('Kept with this project’s agent data: whoever reads that has it')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }))
    await waitFor(() => expect(sent()).toEqual([{ label: 'Team prompt', text: 'shared prompt', whose: 'project' }]))
  })

  test("in a session with no project, there is no project's to save it as", async () => {
    open({ inProject: false })
    await waitFor(() => expect(screen.queryByText('Save to')).toBeNull())
    expect(screen.queryByRole('button', { name: 'This project' })).toBeNull()
  })

  test('a save refused says why, and the dialog stays with what was typed', async () => {
    const { onDone } = open({ text: 'x', saved: () => ({ ok: false, error: 'You have 30 saved prompts: delete one to save another.' }) })
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'One more' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }))
    expect((await screen.findByRole('alert')).textContent).toBe('You have 30 saved prompts: delete one to save another.')
    expect(onDone).not.toHaveBeenCalled()
    expect((screen.getByPlaceholderText('Name') as HTMLInputElement).value).toBe('One more')
  })

  test('Cancel backs out, saving nothing', () => {
    const { onDone, sent } = open()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onDone).toHaveBeenCalledWith(false)
    expect(sent()).toEqual([])
  })
})
