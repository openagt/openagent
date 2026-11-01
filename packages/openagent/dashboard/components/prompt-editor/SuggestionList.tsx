import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { cn } from '../../lib/utils.js'

// The floating command/reference menu (#470) the `/` and `@` triggers open. A shadcn-style
// popover surface driven imperatively by @tiptap/suggestion (which owns positioning), so it
// is a plain list here: arrow keys move, Enter/Tab pick, and items may carry a group header.
// It reads as a listbox to assistive tech (#948): options carry ids the editor's
// aria-activedescendant points at, since focus never leaves the contenteditable.
export interface SuggestionItem {
  id: string
  label: string
  hint?: string | undefined
  /** Optional section header; consecutive items with the same group render under one label. */
  group?: string | undefined
  /** Hover text, for an item whose label and hint don't say where its output lands (#698). */
  title?: string | undefined
}

export interface SuggestionListProps {
  items: SuggestionItem[]
  command: (item: SuggestionItem) => void
  /** Shown when there are no items on a fresh trigger (nothing typed yet) — an empty source
   *  (projects/files not loaded, or none exist) otherwise looks like the feature is broken. */
  emptyNote?: string | undefined
  /** The highlighted option's DOM id, for the editor's aria-activedescendant (#948). */
  onActiveChange?: ((id: string | null) => void) | undefined
}

export interface SuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean
}

/** The DOM id for an option row; unique within the one menu that can be open at a time. */
function optionDomId(index: number): string {
  return `prompt-suggestion-option-${index}`
}

export const SuggestionList = forwardRef<SuggestionListRef, SuggestionListProps>(function SuggestionList(
  { items, command, emptyNote, onActiveChange },
  ref,
) {
  const [selected, setSelected] = useState(0)

  // Reset the highlight whenever the filtered list changes so it never points past the end.
  useEffect(() => setSelected(0), [items])

  // Mirror the highlight out for aria-activedescendant on the editor.
  useEffect(() => {
    onActiveChange?.(items.length > 0 ? optionDomId(selected) : null)
  }, [items, selected, onActiveChange])

  useImperativeHandle(ref, () => ({
    onKeyDown: event => {
      if (items.length === 0) return false
      if (event.key === 'ArrowDown') {
        setSelected(i => (i + 1) % items.length)
        return true
      }
      if (event.key === 'ArrowUp') {
        setSelected(i => (i - 1 + items.length) % items.length)
        return true
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[selected]
        if (item) command(item)
        return true
      }
      return false
    },
  }))

  if (items.length === 0) {
    // Only rendered when the trigger has an emptyNote and nothing was typed yet (suggestion.ts
    // hides the portal otherwise), so a mistyped query still just closes the menu.
    return (
      <div role="status" className="w-64 rounded-md border border-border bg-card p-2 text-sm text-muted-foreground shadow-md">
        {emptyNote ?? 'No matches'}
      </div>
    )
  }

  return (
    <div role="listbox" aria-label="Suggestions" className="max-h-72 w-64 overflow-y-auto rounded-md border border-border bg-card p-1 text-sm shadow-md">
      {items.map((item, i) => (
        <div key={item.id}>
          {item.group && (i === 0 || items[i - 1]?.group !== item.group) && (
            <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              {item.group}
            </div>
          )}
          <button
            type="button"
            id={optionDomId(i)}
            role="option"
            aria-selected={i === selected}
            {...(item.title ? { title: item.title } : {})}
            onMouseDown={e => {
              e.preventDefault()
              command(item)
            }}
            onMouseEnter={() => setSelected(i)}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left',
              i === selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60',
            )}
          >
            <span className="truncate font-medium">{item.label}</span>
            {item.hint && <span className="ml-auto truncate text-xs text-muted-foreground">{item.hint}</span>}
          </button>
        </div>
      ))}
    </div>
  )
})
