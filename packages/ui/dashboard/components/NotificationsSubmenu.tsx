import { Bell, BellOff } from 'lucide-react'
import { setBrowserNotifications, useNotificationPermission } from '../lib/notification-permission.js'
import { usePreferences, updatePreferences, notificationsEnabled, newActivityEnabled, humanInterventionEnabled } from '../lib/preferences.js'
import { HUMAN_QUEUE_ABOUT, NEW_ACTIVITY_ABOUT, browserHint, kindHint } from '../lib/notification-words.js'
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

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {active ? <Bell className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <BellOff className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
        <span className="flex-1">Notifications</span>
        <span className="text-muted-foreground">{active ? 'On' : 'Off'}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-[16rem]">
        {browserSupported && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>Deliver to</DropdownMenuLabel>
              {/* Ticked once notifications reach the browser: on and not allowed yet, the click its hint invites ticks it, and asks. */}
              <DropdownMenuCheckboxItem
                checked={active}
                disabled={blocked}
                onCheckedChange={setBrowserNotifications}
                className="items-start"
              >
                <OptionLabel label="Browser" description={browserHint(permission)} />
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
            <OptionLabel label="Human Queue" description={kindHint(HUMAN_QUEUE_ABOUT, permission, browser)} />
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={activity}
            onCheckedChange={next => updatePreferences({ notifyNewActivity: next })}
            className="items-start"
          >
            <OptionLabel label="New activity" description={kindHint(NEW_ACTIVITY_ABOUT, permission, browser)} />
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
