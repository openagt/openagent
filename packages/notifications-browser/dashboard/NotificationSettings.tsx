import { Button, SettingsRow, SettingsRowShapes, SettingsSection, ToggleRow, useAction, useModuleHost } from '@openagt/ui/module'
import type { Kind } from '../src/kinds.js'
import { switchKind, useKinds } from './kinds.js'
import { askPermission, useNotificationPermission, type Permission } from './permission.js'

/** What the This browser row says under its name. */
function browserSaid(permission: Permission): string {
  if (permission === 'granted') return 'Allowed: notifications show while the dashboard is open.'
  if (permission === 'default') return 'Not allowed yet: the browser asks once you press Allow.'
  if (permission === 'denied') return 'Blocked in your browser settings'
  return 'Not supported by this browser'
}

/** What a kind is about, and while this browser shows none, why. */
function kindSaid(about: string, permission: Permission): string {
  if (permission === 'granted') return about
  return permission === 'default' ? `${about} Sent once this browser allows them.` : `${about} This browser shows none.`
}

const KINDS: { kind: Kind; label: string; about: string }[] = [
  { kind: 'waiting', label: 'Human Queue', about: 'An agent awaiting your answer, or a PR ready to review.' },
  { kind: 'activity', label: 'New activity', about: 'An agent starts or finishes.' },
]

/**
 * Settings › Notifications: whether this browser shows them, asked of the browser by a press, and
 * what they are about, each kind a switch of the person's, the same on every computer of theirs.
 * While the browser shows none, the kinds are greyed and still switch.
 */
export function NotificationSettings() {
  const host = useModuleHost()
  const kinds = useKinds(host)
  const permission = useNotificationPermission()
  const saving = useAction()
  return (
    <SettingsSection description="Desktop notifications while the dashboard is open in a browser.">
      <SettingsRow
        label="This browser"
        description={browserSaid(permission)}
        control={
          permission === 'default' ? (
            <Button variant="secondary" onClick={askPermission}>
              Allow
            </Button>
          ) : null
        }
      />
      {kinds === undefined ? (
        <SettingsRowShapes rows={KINDS.length} />
      ) : (
        KINDS.map(({ kind, label, about }) => (
          <ToggleRow
            key={kind}
            label={label}
            description={kindSaid(about, permission)}
            checked={kinds[kind]}
            dimmed={permission !== 'granted'}
            onChange={on => void saving.run(() => switchKind(host, kind, on), 'Could not save that.')}
          />
        ))
      )}
      {saving.error && (
        <p role="alert" className="text-xs text-danger">
          {saving.error}
        </p>
      )}
    </SettingsSection>
  )
}
