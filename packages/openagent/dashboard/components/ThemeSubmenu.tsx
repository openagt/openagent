import { Monitor, Sun, Moon, Check, type LucideIcon } from 'lucide-react'
import { usePreferences, updatePreferences, themePreference, type ThemePreference } from '../lib/preferences.js'
import { cn } from '../lib/utils.js'
import { DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from './ui/dropdown-menu.js'

// The appearance control (#754), a row of the person's menu at the foot of the sidebar: "Theme",
// with the theme that is on beside it, opening the three choices.
//
// Same `preferences.theme` the rest of the app reads (LayoutDefault resolves it and toggles `dark`
// on <html>), so this is a second surface onto one setting, not a second setting.

/** The theme choices, in order; `system` is the default. */
const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
]

export function ThemeSubmenu() {
  const theme = themePreference(usePreferences())
  // The row says which theme is on without opening it.
  const current = THEME_OPTIONS.find(t => t.value === theme) ?? THEME_OPTIONS[0]!
  const Current = current.icon

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Current className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
        <span className="flex-1">Theme</span>
        <span className="text-muted-foreground">{current.label}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {THEME_OPTIONS.map(t => {
          const Icon = t.icon
          return (
            <DropdownMenuItem
              key={t.value}
              // Keep the menu open so the theme visibly changes underneath the pick.
              closeOnClick={false}
              onClick={() => updatePreferences({ theme: t.value })}
            >
              <Check className={cn('h-3.5 w-3.5 shrink-0', t.value === theme ? 'opacity-100' : 'opacity-0')} />
              <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />
              {t.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
