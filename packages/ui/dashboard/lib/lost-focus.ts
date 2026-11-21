/** A ref for a line that replaces the press it was said by: it takes the focus the removed press dropped to the page, and none a person has put elsewhere. */
export function takeLostFocus(line: HTMLElement | null): void {
  if (line && document.activeElement === document.body) line.focus()
}
