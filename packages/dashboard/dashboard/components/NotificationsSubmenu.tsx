import { Bell, BellOff } from 'lucide-react'
import { useNotificationPermission } from '../lib/notification-permission.js'
import { usePreferences, updatePreferences, notificationsEnabled, newActivityEnabled, humanInterventionEnabled } from '../lib/preferences.js'
import { OptionLabel } from './ui/option-label.js'
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu.js'

// "Notifications", a row of the person's menu at the foot of the sidebar (#676), saying whether
// they are on and opening the switches. It makes the model legible: the browser is the *delivery
// method* (where a notification goes), "Human Queue" and "New activity" are the *categories* (what
// it is about). This is purely the control that writes the preferences.

export function NotificationsSubmenu() {
  const preferences = usePreferences()
  const browser = notificationsEnabled(preferences)
  const activity = newActivityEnabled(preferences)
  const needsYou = humanInterventionEnabled(preferences)
  const permission = useNotificationPermission()
  const browserSupported = permission !== 'unsupported'
  const blocked = permission === 'denied'
  // Browser delivery only actually fires once the browser has granted permission: only then are they "On".
  const active = browser && permission === 'granted'

  const toggleBrowser = (next: boolean) => {
    updatePreferences({ notifyBrowser: next })
    // Asking for permission must ride this user gesture (turning it on).
    if (next && permission === 'default') void Notification.requestPermission()
  }

  const browserHint = blocked
    ? 'Blocked in your browser settings'
    : browser && permission === 'default'
      ? 'Click to allow browser notifications'
      : 'Desktop notifications while the dashboard is open'

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {active ? <Bell className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden /> : <BellOff className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />}
        <span className="flex-1">Notifications</span>
        <span className="text-muted-foreground">{active ? 'On' : 'Off'}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[16rem]">
        {browserSupported && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Deliver to</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={browser}
                disabled={blocked}
                onCheckedChange={toggleBrowser}
                className="items-start"
              >
                <OptionLabel label="Browser" description={browserHint} />
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Notify me about</DropdownMenuLabel>
          {/* "Needs you" (#627): a run awaiting an answer or a PR ready to review. Defaults on — the
              baseline category — but now a real toggle, so it can be turned off like any other. */}
          <DropdownMenuCheckboxItem
            checked={needsYou}
            onCheckedChange={next => updatePreferences({ notifyHumanIntervention: next })}
            className="items-start"
          >
            <OptionLabel label="Human Queue" description="An agent awaiting you, or a PR to review" />
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={activity}
            onCheckedChange={next => updatePreferences({ notifyNewActivity: next })}
            className="items-start"
          >
            <OptionLabel label="New activity" description="An agent started or finished" />
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
