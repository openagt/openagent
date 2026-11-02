import { spawn } from 'node:child_process'

/** The command that opens an address in the default browser, by platform. */
export function browserCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  // `start` is a command of cmd itself; its first quoted argument is the window's title.
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '""', url] }
  return { command: 'xdg-open', args: [url] }
}

/**
 * Open the dashboard in the browser, for a person at this terminal only: a service, with no
 * terminal, has no one to show it to. A computer with no browser to open says nothing: the
 * address is printed above it.
 */
export function openInBrowser(url: string, stdout: { isTTY?: boolean } = process.stdout): void {
  if (!stdout.isTTY) return
  const { command, args } = browserCommand(process.platform, url)
  spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}
