import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { canPickDirectory, pickDirectory, type DialogRunner } from './pick-directory.js'

type Exit = { code: number; stdout?: string; stderr?: string }

/** Answers each dialog command from `results`; anything not listed there is not installed (exit 127). */
const runner = (results: Record<string, Exit>, calls?: string[][]): DialogRunner => {
  return (command, args) => {
    calls?.push([command, ...args])
    const result = results[command] ?? { code: 127 }
    return Promise.resolve({ code: result.code, stdout: result.stdout ?? '', stderr: result.stderr ?? '' })
  }
}

const nothingSpawns: DialogRunner = () => {
  throw new Error('must not spawn anything')
}

const error = (result: Awaited<ReturnType<typeof pickDirectory>>) => (result.ok ? '' : result.error)

test('a picked folder comes back as its POSIX path, trailing slash dropped (#1150)', async () => {
  const calls: string[][] = []
  const picked = await pickDirectory('darwin', runner({ osascript: { code: 0, stdout: '/Users/dev/my-repo/\n' } }, calls))
  assert.deepEqual(picked, { ok: true, path: '/Users/dev/my-repo' })
  assert.equal(calls[0]?.[0], 'osascript', 'the dialog is the OS one, via osascript')
  assert.match(calls[0]?.[2] ?? '', /choose folder/, 'osascript renders the standard folder sheet')
})

test('dismissing the dialog is a normal outcome, not an error', async () => {
  const picked = await pickDirectory('darwin', runner({ osascript: { code: 1, stderr: 'execution error: User canceled. (-128)' } }))
  assert.deepEqual(picked, { ok: true, path: null })
})

test('a dialog failure surfaces its reason', async () => {
  const picked = await pickDirectory('darwin', runner({ osascript: { code: 1, stderr: 'osascript: no display' } }))
  assert.deepEqual(picked, { ok: false, error: 'osascript: no display' })
})

test('on Linux the GTK helper renders the dialog', async () => {
  const calls: string[][] = []
  const picked = await pickDirectory('linux', runner({ zenity: { code: 0, stdout: '/home/dev/my-repo\n' } }, calls), { DISPLAY: ':0', HOME: '/home/dev' })
  assert.deepEqual(picked, { ok: true, path: '/home/dev/my-repo' })
  assert.equal(calls[0]?.[0], 'zenity')
  assert.ok(calls[0]?.includes('--directory'), 'a folder is asked for, not a file')
})

test('on Linux without the GTK helper the KDE one is asked instead', async () => {
  const calls: string[][] = []
  // A Wayland session counts as a desktop session too, not only X11's DISPLAY.
  const picked = await pickDirectory('linux', runner({ kdialog: { code: 0, stdout: '/home/dev/my-repo\n' } }, calls), { WAYLAND_DISPLAY: 'wayland-0', HOME: '/home/dev' })
  assert.deepEqual(picked, { ok: true, path: '/home/dev/my-repo' })
  assert.deepEqual(calls.map(call => call[0]), ['zenity', 'kdialog'], 'the GTK helper is tried first, the KDE one after')
  assert.ok(calls[1]?.includes('--getexistingdirectory'), 'a folder is asked for, not a file')
})

test('on Linux a dismissed dialog is a normal outcome, not an error', async () => {
  const picked = await pickDirectory('linux', runner({ zenity: { code: 1 } }), { DISPLAY: ':0', HOME: '/home/dev' })
  assert.deepEqual(picked, { ok: true, path: null })
})

test('on Linux with neither helper installed, the answer names what is missing', async () => {
  const picked = await pickDirectory('linux', runner({}), { DISPLAY: ':0', HOME: '/home/dev' })
  assert.equal(picked.ok, false)
  assert.match(error(picked), /zenity or kdialog/)
})

test('a Linux daemon with no desktop session says so instead of trying', async () => {
  const picked = await pickDirectory('linux', nothingSpawns, { HOME: '/home/dev' })
  assert.equal(picked.ok, false)
  assert.match(error(picked), /no desktop session/)
})

test('on Windows PowerShell renders the folder browser', async () => {
  const calls: string[][] = []
  const picked = await pickDirectory('win32', runner({ 'powershell.exe': { code: 0, stdout: 'C:\\Users\\dev\\my-repo\r\n' } }, calls))
  assert.deepEqual(picked, { ok: true, path: 'C:\\Users\\dev\\my-repo' })
  assert.equal(calls[0]?.[0], 'powershell.exe')
  assert.match(calls[0]?.at(-1) ?? '', /FolderBrowserDialog/, 'the OS\'s own folder browser, not a prompt')
})

test('on Windows a dismissed dialog is a normal outcome, not an error', async () => {
  const picked = await pickDirectory('win32', runner({ 'powershell.exe': { code: 2 } }))
  assert.deepEqual(picked, { ok: true, path: null })
})

test('on Windows a PowerShell failure stays a failure, unlike a dismissal', async () => {
  const picked = await pickDirectory('win32', runner({ 'powershell.exe': { code: 1, stderr: 'Add-Type : Cannot load System.Windows.Forms' } }))
  assert.deepEqual(picked, { ok: false, error: 'Add-Type : Cannot load System.Windows.Forms' })
})

test('a platform without a wired picker says so instead of trying', async () => {
  const picked = await pickDirectory('freebsd', nothingSpawns)
  assert.equal(picked.ok, false)
  assert.match(error(picked), /not available on freebsd/)
})

test('a computer can show a folder dialog when it has a screen: a Mac and Windows always, Linux with a desktop session', () => {
  assert.equal(canPickDirectory('darwin', {}), true)
  assert.equal(canPickDirectory('win32', {}), true)
  assert.equal(canPickDirectory('linux', {}), false)
  assert.equal(canPickDirectory('linux', { DISPLAY: ':0' }), true)
  assert.equal(canPickDirectory('linux', { WAYLAND_DISPLAY: 'wayland-0' }), true)
  assert.equal(canPickDirectory('freebsd', { DISPLAY: ':0' }), false)
})
