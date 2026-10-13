import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { RadioGroup, RadioGroupItem, RadioGroupOption } from './radio-group.js'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select.js'
import { CardTitleLink } from './card.js'
import { openMenu } from '../../test-utils.js'

// The form controls the pages share: the radio group and the select, on Base UI, and a card's
// title that opens the card's page.

afterEach(cleanup)

describe('RadioGroup', () => {
  function Paces({ disabled = false, onPick = () => {} }: { disabled?: boolean; onPick?: (value: unknown) => void }) {
    const [value, setValue] = useState('skill')
    return (
      <RadioGroup aria-label="Wait" value={value} disabled={disabled} onValueChange={next => (setValue(next as string), onPick(next))}>
        <RadioGroupOption value="skill">
          As the skill says <span>(6 hours)</span>
        </RadioGroupOption>
        <RadioGroupOption value="work">No wait</RadioGroupOption>
        <RadioGroupItem value="every" aria-label="A wait you set" />
      </RadioGroup>
    )
  }

  test('an option is named by its words, hint included, so a screen reader says what the dot picks; a bare item by its own label', () => {
    render(<Paces />)
    expect(screen.getByRole('radiogroup', { name: 'Wait' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'As the skill says (6 hours)' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'No wait' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('radio', { name: 'A wait you set' })).toBeTruthy()
  })

  test('a click on the words picks the option, and only one is picked', () => {
    const onPick = vi.fn()
    render(<Paces onPick={onPick} />)
    fireEvent.click(screen.getByText('No wait'))
    expect(onPick).toHaveBeenCalledWith('work')
    expect(screen.getAllByRole('radio').map(radio => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
  })

  test('a disabled group takes no pick', () => {
    const onPick = vi.fn()
    render(<Paces disabled onPick={onPick} />)
    fireEvent.click(screen.getByText('No wait'))
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByRole('radio', { name: 'No wait' }).getAttribute('aria-disabled')).toBe('true')
  })
})

describe('Select', () => {
  const UNITS = [
    { value: 'h', label: 'hours' },
    { value: 'd', label: 'days' },
  ]
  function Units({ onPick = () => {} }: { onPick?: (value: unknown) => void }) {
    const [value, setValue] = useState('h')
    return (
      <Select items={UNITS} value={value} onValueChange={next => (setValue(next as string), onPick(next))}>
        <SelectTrigger aria-label="Unit">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {UNITS.map(unit => (
            <SelectItem key={unit.value} value={unit.value} disabled={unit.value === 'x'}>
              {unit.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  test('the trigger shows the label of the pick before its list was ever opened, and is named', () => {
    render(<Units />)
    const trigger = screen.getByRole('combobox', { name: 'Unit' })
    expect(trigger.textContent).toBe('hours')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  test('opened, it lists its items; picking one closes it, tells the page, and shows the new label', async () => {
    const onPick = vi.fn()
    render(<Units onPick={onPick} />)
    const trigger = screen.getByRole('combobox', { name: 'Unit' })
    await openMenu(trigger)
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['hours', 'days'])
    const days = screen.getByRole('option', { name: 'days' })
    // Base UI takes a click only on the item the pointer is on.
    fireEvent.mouseMove(days)
    fireEvent.click(days)
    await waitFor(() => expect(trigger.getAttribute('aria-expanded')).toBe('false'))
    expect(onPick.mock.calls[0]?.[0]).toBe('d')
    expect(trigger.textContent).toBe('days')
  })
})

describe('CardTitleLink', () => {
  test('a real link to the card\'s page: a plain click goes through the dashboard\'s own navigation, a click with a modifier is left to the browser', () => {
    const onOpen = vi.fn()
    render(
      <CardTitleLink href="/queue" onOpen={onOpen}>
        AI Queue
      </CardTitleLink>,
    )
    const link = screen.getByRole('link', { name: 'AI Queue' })
    expect(link.getAttribute('href')).toBe('/queue')
    expect(screen.getByRole('heading', { name: 'AI Queue' })).toBeTruthy()
    expect(fireEvent.click(link)).toBe(false)
    expect(onOpen).toHaveBeenCalledTimes(1)
    // Opening it in a new tab is the browser's to do.
    expect(fireEvent.click(link, { metaKey: true })).toBe(true)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
