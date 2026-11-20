import type { AgentLogins } from '@openagt/hooks'

/**
 * A coding agent's accounts for tests (`RunAgent.accounts`), its list named `list`: installed, its
 * own login there, every part swappable. A sign-in nothing swapped refuses.
 */
export function testLogins(list: string, more: Partial<AgentLogins> = {}): AgentLogins {
  return {
    list,
    service: list.charAt(0).toUpperCase() + list.slice(1),
    envLogins: [],
    installed: () => Promise.resolve(true),
    ownLoginThere: () => true,
    ownName: () => Promise.resolve(undefined),
    logOut: () => Promise.resolve(),
    signIn: () => Promise.resolve({ ok: false, error: 'This test signs nobody in.' }),
    isSignInCode: code => /^[\w-]{8,}$/.test(code),
    forget: () => Promise.resolve(),
    usage: () => Promise.resolve(undefined),
    ...more,
  }
}
