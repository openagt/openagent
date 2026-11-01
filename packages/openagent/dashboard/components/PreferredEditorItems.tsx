import type { EditorInfo } from '../rpc/preferences.js'
import { usePreferences, updatePreferences } from '../lib/preferences.js'
import { useDetectedEditors } from '../lib/editors.js'
import { cn } from '../lib/utils.js'
import { Check } from 'lucide-react'
import { OptionLabel } from './ui/option-label.js'
import { DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel } from './ui/dropdown-menu.js'

// The "Preferred editor" picker (#727), as one group both menus that offer it render: the project
// home's ⋮ menu and a session's own menu (AgentActionsMenu). They showed the
// same rows from the same two reads, written out twice — so a row added to one silently did not
// appear in the other.

/**
 * The editors to offer: the ones detected on the daemon's machine, plus the stored one when it is
 * not among them (a hand-set `$OPENAGENT_EDITOR`), so the current choice always has a row.
 */
function useEditorRows(editor: string | undefined): EditorInfo[] {
  const detected = useDetectedEditors()
  return editor && !detected.some(e => e.bin === editor) ? [...detected, { bin: editor, label: editor }] : detected
}

/**
 * The picker's rows: "Default" (whatever `$OPENAGENT_EDITOR` or `code` resolves to) and one per
 * editor, ticked where the stored preference points. Each row stores the choice without closing
 * the menu, so picking is visibly confirmed rather than making the menu vanish.
 */
export function PreferredEditorItems({ busy }: { busy: boolean }) {
  const editor = usePreferences().editor
  const editorRows = useEditorRows(editor)
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Preferred editor</DropdownMenuLabel>
      <DropdownMenuItem disabled={busy} closeOnClick={false} onClick={() => updatePreferences({ editor: '' })} className="items-start">
        <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', editor ? 'opacity-0' : 'opacity-100')} />
        <OptionLabel label="Default" description="$OPENAGENT_EDITOR, or code" />
      </DropdownMenuItem>
      {editorRows.map(e => (
        <DropdownMenuItem
          key={e.bin}
          disabled={busy}
          closeOnClick={false}
          onClick={() => updatePreferences({ editor: e.bin })}
          className="items-start"
        >
          <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', editor === e.bin ? 'opacity-100' : 'opacity-0')} />
          <OptionLabel label={e.label} description={e.bin} />
        </DropdownMenuItem>
      ))}
    </DropdownMenuGroup>
  )
}
