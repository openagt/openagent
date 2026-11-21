import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Combobox } from '@base-ui/react/combobox'
import { usePickerSearch } from './picker-search.js'

afterEach(cleanup)

const ROWS = ['blog', 'shop']

function Picker({ onPick }: { onPick: (row: string | null) => void }) {
  const search = usePickerSearch()
  return (
    <Combobox.Root<string> items={ROWS} value="shop" onValueChange={onPick} {...search.root}>
      <Combobox.Trigger aria-label="Project" {...search.trigger}>
        shop
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner>
          <Combobox.Popup>
            <Combobox.Input aria-label="Search" />
            <Combobox.List>{(row: string) => <Combobox.Item key={row} value={row}>{row}</Combobox.Item>}</Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}

describe('a letter typed on a picker’s button', () => {
  test('opens the picker with every letter in its search, and picks nothing', async () => {
    const onPick = vi.fn()
    render(<Picker onPick={onPick} />)
    const button = screen.getByRole('combobox', { name: 'Project' })
    button.focus()
    act(() => {
      fireEvent.keyDown(button, { key: 'b' })
      fireEvent.keyDown(button, { key: 'l' })
    })
    expect(((await screen.findByLabelText('Search')) as HTMLInputElement).value).toBe('bl')
    expect(onPick).not.toHaveBeenCalled()
  })

  test('held with Ctrl, or pressed to compose, is no letter of the search', () => {
    const onPick = vi.fn()
    render(<Picker onPick={onPick} />)
    const button = screen.getByRole('combobox', { name: 'Project' })
    fireEvent.keyDown(button, { key: 'b', ctrlKey: true })
    fireEvent.keyDown(button, { key: 'b', isComposing: true })
    expect(screen.queryByLabelText('Search')).toBeNull()
  })
})
