import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { CustomPreset } from '../../src/index.js'
import { PresetCreatePanel } from './PresetCreatePanel.js'

afterEach(cleanup)

describe('PresetCreatePanel (#649)', () => {
  test('prefills the prompt from the editor and saves a well-formed preset', () => {
    const onSave = vi.fn()
    render(<PresetCreatePanel currentPrompt="my crafted prompt" busy={false} canSaveToProject={false} onSave={onSave} onCancel={() => {}} />)
    expect((screen.getByPlaceholderText(/The prompt to save/) as HTMLTextAreaElement).value).toBe('my crafted prompt')
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'My preset' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }))
    const [saved, scope] = onSave.mock.calls[0]! as [CustomPreset, string]
    expect({ label: saved.label, prompt: saved.prompt }).toEqual({ label: 'My preset', prompt: 'my crafted prompt' })
    expect(saved.id).toBeTruthy()
    expect(scope).toBe('user') // no project open -> always the user tier (#1025)
  })

  test('cannot save without both a name and a prompt', () => {
    render(<PresetCreatePanel currentPrompt="" busy={false} canSaveToProject={false} onSave={() => {}} onCancel={() => {}} />)
    expect((screen.getByRole('button', { name: 'Save prompt' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('Enter in the name saves, and each field is named and says what it needs while it is empty', () => {
    const onSave = vi.fn()
    render(<PresetCreatePanel currentPrompt="" busy={false} canSaveToProject={false} onSave={onSave} onCancel={() => {}} />)
    const name = screen.getByRole('textbox', { name: 'Name' })
    const prompt = screen.getByRole('textbox', { name: 'Prompt' })
    const needs = (field: HTMLElement) => document.getElementById(field.getAttribute('aria-describedby') ?? '')?.textContent
    expect(needs(name)).toBe('Name it to save it: Commands lists it by its name.')
    expect(needs(prompt)).toBe('Write the prompt it loads into the box.')
    fireEvent.change(name, { target: { value: 'My preset' } })
    fireEvent.change(prompt, { target: { value: 'sweep it' } })
    expect(name.hasAttribute('aria-describedby')).toBe(false)
    expect(prompt.hasAttribute('aria-describedby')).toBe(false)
    fireEvent.submit(name.closest('form')!)
    expect((onSave.mock.calls[0]![0] as CustomPreset).label).toBe('My preset')
  })

  test('with a project open, saving "This project" reports the project scope (#1025)', () => {
    const onSave = vi.fn()
    render(<PresetCreatePanel currentPrompt="shared prompt" busy={false} canSaveToProject onSave={onSave} onCancel={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Team preset' } })
    fireEvent.click(screen.getByRole('button', { name: 'This project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save prompt' }))
    const [, scope] = onSave.mock.calls[0]! as [CustomPreset, string]
    expect(scope).toBe('project')
  })

  test('no scope choice when there is no project to share into (#1025)', () => {
    render(<PresetCreatePanel currentPrompt="" busy={false} canSaveToProject={false} onSave={() => {}} onCancel={() => {}} />)
    expect(screen.queryByRole('button', { name: 'This project' })).toBeNull()
  })

  test('Cancel backs out', () => {
    const onCancel = vi.fn()
    render(<PresetCreatePanel currentPrompt="" busy={false} canSaveToProject={false} onSave={() => {}} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
