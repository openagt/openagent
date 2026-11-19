import { execFile, type ExecFileException } from 'node:child_process'

/**
 * The system folder picker behind the dashboard's "Add project" (#1150): the daemon opens the
 * OS's own choose-a-folder dialog and hands the picked absolute path back, because a browser page
 * cannot learn the absolute path of anything the user picks in it.
 */

/** The outcome of asking the OS for a folder: a path, a dismissed dialog (`path: null`), or why the dialog could not be asked. */
export type PickDirectoryResult =
  | { ok: true; path: string | null }
  | { ok: false; error: string }

/** What a dialog command left behind when it exited. */
export type DialogRun = { code: number; stdout: string; stderr: string }

/** Injectable seam so tests never open a real dialog. */
export type DialogRunner = (command: string, args: string[]) => Promise<DialogRun>

/** The exit code standing for "this machine does not have that command", so the next candidate can be tried. */
const NOT_INSTALLED = 127

/** The exit code the Windows script reports a cancelled dialog with, kept clear of PowerShell's own failure exit of 1. */
const WINDOWS_CANCELLED = 2

/** What the user is asked for, in every OS's own dialog. */
const PROMPT = 'Choose a git repository to add as a project'

/** One OS's folder dialog: the command that renders it, and how that command reports a dismissal. */
type Dialog = { command: string; args: string[]; dismissed: (run: DialogRun) => boolean }

/** macOS: `osascript`'s `choose folder`, which renders the standard folder sheet. */
const macDialog: Dialog = {
  command: 'osascript',
  args: ['-e', `POSIX path of (choose folder with prompt "${PROMPT}")`],
  // osascript reports a cancelled dialog as error -128, the one exit we translate rather than surface.
  dismissed: run => run.stderr.includes('-128'),
}

/**
 * Windows: PowerShell drives the folder browser that ships with the OS. `-STA` because that dialog
 * needs a single-threaded apartment, `-NoProfile` so a user's startup script cannot print into the
 * path read back off stdout.
 */
const windowsDialog: Dialog = {
  command: 'powershell.exe',
  args: [
    '-NoProfile',
    '-STA',
    '-Command',
    [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      `$dialog.Description = '${PROMPT}'`,
      '$dialog.ShowNewFolderButton = $false',
      `if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath } else { exit ${WINDOWS_CANCELLED} }`,
    ].join('; '),
  ],
  dismissed: run => run.code === WINDOWS_CANCELLED,
}

/**
 * Linux: the desktop's own dialog helper, whichever of the two is installed — `zenity` on GTK
 * desktops, `kdialog` on KDE. Both print the chosen folder and report a cancelled dialog as exit 1,
 * and both are told where to open, because `kdialog` takes the starting directory as an argument.
 *
 * Exit 1 is read as a cancellation even though a helper that cannot reach the display exits that
 * way too: a session with no display at all is ruled out before we get here, and mistaking the
 * remaining rarity for a cancellation is better than showing every user who cancels the harmless
 * warnings these helpers print on startup.
 */
function linuxDialogs(home: string): Dialog[] {
  const dismissed = (run: DialogRun) => run.code === 1
  return [
    { command: 'zenity', args: ['--file-selection', '--directory', `--title=${PROMPT}`, `--filename=${home}/`], dismissed },
    { command: 'kdialog', args: ['--title', PROMPT, '--getexistingdirectory', home], dismissed },
  ]
}

/** A command that could not be spawned at all reads as not installed; anything else keeps its own exit code. */
function exitCode(error: ExecFileException): number {
  if (error.code === 'ENOENT') return NOT_INSTALLED
  return typeof error.code === 'number' ? error.code : 1
}

const nodeDialogRunner: DialogRunner = (command, args) =>
  new Promise(done => {
    execFile(command, args, (error, stdout, stderr) => {
      done({ code: error ? exitCode(error) : 0, stdout: String(stdout), stderr: String(stderr) })
    })
  })

/** Whether this computer has a screen a folder dialog can open on: asked before one is offered. */
export function canPickDirectory(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  if (platform === 'darwin' || platform === 'win32') return true
  return platform === 'linux' && Boolean(env.DISPLAY || env.WAYLAND_DISPLAY)
}

/**
 * Open the OS folder picker and wait for the user's choice.
 *
 * Dismissing the dialog is a normal outcome (`path: null`), not an error. A Linux daemon with no
 * desktop session to draw on, a Linux machine with neither dialog helper installed, and a platform
 * with no dialog wired up each answer with that reason instead of trying.
 */
export async function pickDirectory(
  platform: NodeJS.Platform = process.platform,
  run: DialogRunner = nodeDialogRunner,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PickDirectoryResult> {
  if (platform === 'darwin') return openDialog([macDialog], run)
  if (platform === 'win32') return openDialog([windowsDialog], run)
  if (platform === 'linux') {
    // A dialog needs a screen to appear on, and a daemon started over SSH or inside a container has
    // none — saying so beats spawning a helper that can only fail.
    if (!canPickDirectory(platform, env))
      return { ok: false, error: 'The machine running OpenAgent has no desktop session, so no folder dialog can open there.' }
    return openDialog(linuxDialogs(env.HOME ?? '.'), run)
  }
  return { ok: false, error: `The system folder picker is not available on ${platform}.` }
}

/** Open the first installed dialog of `dialogs`, and read the user's answer out of what it printed. */
async function openDialog(dialogs: Dialog[], run: DialogRunner): Promise<PickDirectoryResult> {
  for (const dialog of dialogs) {
    const result = await run(dialog.command, dialog.args)
    if (result.code === NOT_INSTALLED) continue
    if (dialog.dismissed(result)) return { ok: true, path: null }
    if (result.code !== 0) return { ok: false, error: result.stderr.trim() || 'The folder dialog could not be opened.' }
    // macOS prints the POSIX path with a trailing slash; the registry stores paths without one.
    const path = result.stdout.trim().replace(/(.)\/$/, '$1')
    return path ? { ok: true, path } : { ok: false, error: 'The folder dialog returned no path.' }
  }
  const names = dialogs.map(dialog => dialog.command).join(' or ')
  return { ok: false, error: `The folder dialog needs ${names}, which the machine running OpenAgent does not have installed.` }
}
