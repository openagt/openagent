import { fireEvent, waitFor, within } from '@testing-library/react'
import { openMenu } from './test-utils.js'

// How a test reads and works the controls the dashboard draws with its shadcn components on
// Base UI, in this package and in every package that brings a page or a Settings section. A Select
// there is no `<select>`: its trigger is a button (`combobox`) that shows the label of the pick,
// and its list (a `listbox` of `option`s) exists only while it is open, in a portal on the page's
// body. A radio is an element with `role="radio"` and `aria-checked`, beside a hidden input, and a
// switch one with `role="switch"`. So a test does what a person does: it reads the label on the
// trigger, opens the list to see what is offered, moves onto a choice and clicks it.

/** The label a select shows on its trigger: its pick, as a person reads it. */
export const showing = (select: HTMLElement): string => select.textContent ?? ''

/** Open a select's list and answer it: opened the way the dashboard's own tests open a Base UI menu, clicked until the trigger says it is open. */
export async function openList(select: HTMLElement): Promise<HTMLElement> {
  await openMenu(select)
  const list = document.getElementById(select.getAttribute('aria-controls') ?? '')
  if (!list) throw new Error(`the list of "${showing(select)}" is open, and is not on the page`)
  return list
}

/** Wait until a select's list is shut again, so the next one opened is the only one. */
async function shut(select: HTMLElement, otherwise: string): Promise<void> {
  await waitFor(() => {
    if (select.getAttribute('aria-expanded') !== 'false') throw new Error(otherwise)
  })
}

/** Close a select's open list with Escape: nothing is picked. */
export async function closeList(select: HTMLElement): Promise<void> {
  const list = document.getElementById(select.getAttribute('aria-controls') ?? '')
  if (!list) throw new Error(`the list of "${showing(select)}" is not open`)
  fireEvent.keyDown(list, { key: 'Escape' })
  await shut(select, 'Escape did not close the list')
}

/** What a select offers, in the order of its list: each choice's label, and whether it is greyed. The list is opened, read, and closed with Escape: nothing is picked. */
export async function offered(select: HTMLElement): Promise<[label: string, greyed: boolean][]> {
  const list = await openList(select)
  const read = within(list)
    .getAllByRole('option')
    .map((option): [string, boolean] => [option.textContent ?? '', option.getAttribute('aria-disabled') === 'true'])
  await closeList(select)
  return read
}

/** The labels a select offers, in the order of its list. */
export const choices = async (select: HTMLElement): Promise<string[]> => (await offered(select)).map(([label]) => label)

/**
 * Pick a choice of a select by its label, the way a person does: open the list, move onto the
 * choice, click it. Base UI takes a click only on the choice the pointer is on. A choice that is
 * greyed, or a select that takes no pick, picks nothing and leaves the list open: that fails here.
 */
export async function pick(select: HTMLElement, label: string): Promise<void> {
  const option = within(await openList(select)).getByRole('option', { name: label })
  fireEvent.mouseMove(option)
  fireEvent.click(option)
  await shut(select, `"${label}" was not picked`)
}

/**
 * The words a radio goes by: its own `aria-label`, else the words of the `<label>` around it,
 * without the smaller hint beside them. Base UI's radio is a `<span>`, which a `<label>` around it
 * does not name, so `getByRole('radio', { name })` finds only the radios that have an `aria-label`
 * or an `aria-labelledby`, and the second names the radio by its words and its hint together.
 */
function radioWords(radio: HTMLElement): string {
  const own = radio.getAttribute('aria-label')
  if (own !== null) return own
  return [...(radio.closest('label')?.childNodes ?? [])]
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent ?? '')
    .join('')
    .trim()
}

/** The radios in a part of the page, by their words, in the order they are drawn. */
export const radioNames = (container: HTMLElement): string[] => within(container).queryAllByRole('radio').map(radioWords)

/** The radio that goes by these words in a part of the page, if one is drawn there. */
export function queryRadio(container: HTMLElement, name: string): HTMLElement | null {
  const found = within(container)
    .queryAllByRole('radio')
    .filter(radio => radioWords(radio) === name)
  if (found.length > 1) throw new Error(`${found.length} radios go by "${name}" here: look in a smaller part of the page`)
  return found[0] ?? null
}

/** The radio that goes by these words in a part of the page. Clicking it picks it. */
export function radio(container: HTMLElement, name: string): HTMLElement {
  const found = queryRadio(container, name)
  if (!found) throw new Error(`no radio goes by "${name}" here; the radios are: ${radioNames(container).join(', ') || 'none'}`)
  return found
}

/** Whether a radio is the pick of its group, or a switch is on. */
export const checked = (control: HTMLElement): boolean => control.getAttribute('aria-checked') === 'true'
