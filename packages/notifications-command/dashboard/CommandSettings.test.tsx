import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { ModuleCallResult } from '@openagt/ui/module'
import { fakeHost, renderWithHost } from '@openagt/ui/module/testing'
import { CommandSettings } from './CommandSettings.js'

// The module's server part as a test answers it: the command saved on this computer.
let saved: string
let answers: Record<string, (input: Record<string, unknown>) => ModuleCallResult>
const callComputer = vi.fn(async (name: string, input: object): Promise<ModuleCallResult> => (answers[name] ?? (() => ({ ok: true, output: null })))(input as Record<string, unknown>))
const sent = (name: string) => callComputer.mock.calls.filter(([called]) => called === name).map(([, input]) => input)
const render = () => renderWithHost(<CommandSettings />, fakeHost('@openagt/notifications-command', { callComputer }))

beforeEach(() => {
  saved = ''
  answers = {
    command: () => ({ ok: true, output: saved }),
    saveCommand: input => ((saved = String(input['command']).trim()), { ok: true, output: null }),
  }
  callComputer.mockClear()
})
afterEach(cleanup)

describe('Settings › Notification command', () => {
  test('with none saved, nothing runs: a command typed and saved is the one this computer runs', async () => {
    render()
    expect(await screen.findByText('None yet: nothing runs.')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: ' npx @openagt/discord@0.1 send "$MESSAGE" ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('saveCommand')).toEqual([{ command: ' npx @openagt/discord@0.1 send "$MESSAGE" ' }]))
    expect((await screen.findByRole('status')).textContent).toBe('Saved.')
    expect(screen.getByText('Run when a run on this computer needs you.')).toBeTruthy()
    expect((screen.getByLabelText('Command') as HTMLInputElement).value).toBe('npx @openagt/discord@0.1 send "$MESSAGE"')
  })

  test('the command saved is shown; Save, with nothing changed, sends nothing; emptied and saved, nothing runs', async () => {
    saved = 'say done'
    render()
    expect(((await screen.findByLabelText('Command')) as HTMLInputElement).value).toBe('say done')
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(save)
    expect(sent('saveCommand')).toEqual([])
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('status')).textContent).toBe('Saved: nothing runs now.')
    expect(sent('saveCommand')).toEqual([{ command: '' }])
    expect(screen.getByText('None yet: nothing runs.')).toBeTruthy()
  })

  test('a command refused is said, and what was saved stays', async () => {
    answers['saveCommand'] = () => ({ ok: false, error: 'A command is one line of at most 4000 characters.' })
    render()
    fireEvent.change(await screen.findByLabelText('Command'), { target: { value: 'x'.repeat(4001) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('A command is one line of at most 4000 characters.')
    expect(screen.queryByRole('status')).toBeNull()
  })

  test('a command that cannot be read says why', async () => {
    answers['command'] = () => ({ ok: false, error: 'the settings could not be read' })
    render()
    expect((await screen.findByRole('alert')).textContent).toBe('The command could not be read: the settings could not be read')
  })
})
