import { useState, type KeyboardEvent } from 'react'
import type { BaseUIEvent } from '@base-ui/react/types'
import { typedCharacter } from '../../lib/shortcut.js'

/**
 * A searchable picker's open state and its search, for its `Combobox.Root` (`root`) and its
 * `Combobox.Trigger` (`trigger`). A letter typed on the button opens the picker with the letter in
 * its search, and the letters after it land behind it until the search has the keyboard: a key on
 * the button never picks a row. Space, Enter and the arrows keep the button's own meaning.
 */
export function usePickerSearch() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setTyped('')
  }
  const onKeyDown = (event: BaseUIEvent<KeyboardEvent>) => {
    const letter = typedCharacter(event)
    if (letter === undefined || letter === ' ') return
    // The library's own: a letter on a closed button picks the first row it starts.
    event.preventBaseUIHandler()
    event.preventDefault()
    setTyped(before => before + letter)
    setOpen(true)
  }
  return { open, typed, root: { open, onOpenChange, inputValue: typed, onInputValueChange: setTyped }, trigger: { onKeyDown } }
}
