import { ClaudeLogo, CodexLogo } from '@openagt/skill-ui/module'
import type { DriverName } from '../../src/client.js'

/** The logo for a driver, so a caller with a `DriverName` does not repeat the mapping. */
export function DriverLogo({ driver, className, title }: { driver: DriverName; className?: string | undefined; title?: string | undefined }) {
  const Logo = driver === 'codex' ? CodexLogo : ClaudeLogo
  return <Logo className={className} {...(title ? { title } : {})} />
}
