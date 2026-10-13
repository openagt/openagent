import { isLoopbackHost } from '../../src/client.js'

/**
 * What the page calls the machine its dashboard is on. The dashboard is always its own
 * machine's, also when a phone shows it. Opened on the computer itself, at one of the computer's
 * own names, that machine is "This machine". Opened from anywhere else those words would read as
 * the phone in the person's hand, so the machine goes by the name the page was reached at: a
 * server's address, a computer's name on the Wi-Fi.
 */
export function thisMachineName(hostname: string = typeof window === 'undefined' ? '' : window.location.hostname): string {
  return hostname === '' || isLoopbackHost(hostname) ? 'This machine' : hostname
}
