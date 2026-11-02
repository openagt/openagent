import { useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { SettingsSelectRow, type SettingsOption } from './SettingsRows.js'
import { choices, closeList, offered, openList, pick, showing } from '../test-controls.js'

afterEach(cleanup)

// The Editor row's shape: a first choice whose value is no text, then what was found.
const EDITORS: SettingsOption[] = [
  { value: '', label: 'Auto-detect' },
  { value: 'code', label: 'VS Code' },
  { value: 'zed', label: 'Zed' },
]

/** A row that keeps its own pick, as the page does through the preferences, and reports each one. */
function Row({ start, options, onChange }: { start: string; options: SettingsOption[]; onChange: (next: string) => void }) {
  const [value, setValue] = useState(start)
  return (
    <SettingsSelectRow
      label="Editor"
      description="Which editor opens."
      value={value}
      options={options}
      onChange={next => {
        onChange(next)
        setValue(next)
      }}
    />
  )
}

const editor = () => screen.getByRole('combobox', { name: 'Editor' })

describe('a Settings row picked from a list', () => {
  test('it is named by its label, shows the label of its pick, and offers every choice in order', async () => {
    render(<Row start="zed" options={EDITORS} onChange={() => {}} />)
    expect(screen.getByText('Which editor opens.')).toBeTruthy()
    // The label of the pick, not its value, and before the list was ever opened.
    expect(showing(editor())).toBe('Zed')
    expect(await choices(editor())).toEqual(['Auto-detect', 'VS Code', 'Zed'])
  })

  test('picking a choice answers its value, and the row then shows its label', async () => {
    const onChange = vi.fn()
    render(<Row start="zed" options={EDITORS} onChange={onChange} />)
    await pick(editor(), 'VS Code')
    expect(onChange.mock.calls).toEqual([['code']])
    expect(showing(editor())).toBe('VS Code')
  })

  test('a row whose value is no text shows the label of the choice with no value', () => {
    render(<Row start="" options={EDITORS} onChange={() => {}} />)
    expect(showing(editor())).toBe('Auto-detect')
  })

  test('the choice with no value can be picked, and answers no text', async () => {
    const onChange = vi.fn()
    render(<Row start="code" options={EDITORS} onChange={onChange} />)
    await pick(editor(), 'Auto-detect')
    expect(onChange.mock.calls).toEqual([['']])
    expect(showing(editor())).toBe('Auto-detect')
    // And it is the one marked as picked in the list, no other.
    const list = await openList(editor())
    expect(within(list).getAllByRole('option').map(option => [option.textContent, option.getAttribute('aria-selected')])).toEqual([
      ['Auto-detect', 'true'],
      ['VS Code', 'false'],
      ['Zed', 'false'],
    ])
  })

  test('a line that says something is greyed and cannot be picked: a click on it answers nothing and the pick stays', async () => {
    const onChange = vi.fn()
    render(<Row start="" options={[{ value: '', label: "the CLI's own default" }, { value: 'not logged in', label: 'not logged in', disabled: true }]} onChange={onChange} />)
    expect(await offered(editor())).toEqual([
      ["the CLI's own default", false],
      ['not logged in', true],
    ])
    const line = within(await openList(editor())).getByRole('option', { name: 'not logged in' })
    fireEvent.mouseMove(line)
    fireEvent.click(line)
    expect(onChange).not.toHaveBeenCalled()
    await closeList(editor())
    expect(showing(editor())).toBe("the CLI's own default")
  })

  test('a row with nothing to pick renders nothing at all (#1172)', () => {
    const { container } = render(<Row start="" options={[]} onChange={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  test('a saved value the list does not hold is still the pick: it has a line of its own, by its text, and it is the one marked', async () => {
    const onChange = vi.fn()
    render(<SettingsSelectRow label="Editor" description="Which editor opens." value="/usr/local/bin/code" options={[{ value: '', label: 'Auto-detect' }]} onChange={onChange} />)
    const select = screen.getByRole('combobox', { name: 'Editor' })
    expect(showing(select)).toBe('/usr/local/bin/code')
    const list = await openList(select)
    const lines = within(list).getAllByRole('option')
    expect(lines.map(line => [line.textContent, line.getAttribute('aria-selected')])).toEqual([
      ['Auto-detect', 'false'],
      ['/usr/local/bin/code', 'true'],
    ])
  })
})
