import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { SuggestionList, type SuggestionItem } from './SuggestionList.js'

afterEach(cleanup)

const list = (items: SuggestionItem[]) => render(<SuggestionList items={items} command={() => {}} />)

test('a file too long for the list gives up its folders before its name, and its hint is never cut', () => {
  list([
    { id: 'file:src/components/checkout/PaymentMethodForm.tsx', label: '#src/components/checkout/PaymentMethodForm.tsx', path: 'src/components/checkout/PaymentMethodForm.tsx', hint: 'file', group: 'Files' },
    { id: 'file:src/components/checkout/PaymentMethodForm.test.tsx', label: '#src/components/checkout/PaymentMethodForm.test.tsx', path: 'src/components/checkout/PaymentMethodForm.test.tsx', hint: 'file', group: 'Files' },
  ])
  const [first, second] = screen.getAllByRole('option')
  // The folders are one part, which takes the whole shortage; the name's last letters are a part that never shrinks.
  const folders = first!.querySelector('.truncate')!
  expect(folders.textContent).toBe('src/components/checkout/')
  expect(folders.className).toContain('shrink-[1000000]')
  expect([...first!.querySelectorAll('.shrink-0')].map(part => part.textContent)).toEqual(['#', 'odForm.tsx', 'file'])
  expect([...second!.querySelectorAll('.shrink-0')].map(part => part.textContent)).toEqual(['#', 'm.test.tsx', 'file'])
  // Read out whole, and whole on a hover.
  expect(first!.textContent).toContain('PaymentMethodForm.tsx')
  expect(first!.getAttribute('title')).toBe('#src/components/checkout/PaymentMethodForm.tsx')
})

test('a row that is no file is cut at its label’s end, with its hint whole', () => {
  list([{ id: 'save-prompt', label: 'Save prompt…', hint: 'save the current prompt', group: 'Saved prompts' }])
  const row = screen.getByRole('option')
  const [label, hint] = [...row.querySelectorAll('span')]
  expect(label!.textContent).toBe('Save prompt…')
  expect(label!.className).toContain('truncate')
  expect(hint!.textContent).toBe('save the current prompt')
  expect(hint!.className).toContain('shrink-0')
  expect(hint!.className).not.toContain('truncate')
  expect(row.hasAttribute('title')).toBe(false)
})

test('a command says what it does on a hover, as before', () => {
  list([{ id: 'command:plan', label: '/plan', group: 'Commands', title: 'Write a plan' }])
  expect(screen.getByRole('option').getAttribute('title')).toBe('Write a plan')
})
