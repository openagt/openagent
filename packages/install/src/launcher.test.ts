import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LAUNCHER_MARK, addLauncherLines, hasLauncher, launcherScript, removeLauncherLine } from './launcher.js'

async function inFolder(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'launcher-'))
  try {
    await body(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('the openagent command runs node on the dashboard the login service runs, with what was typed after it', () =>
  inFolder(async dir => {
    // A node that says what it was given, in a folder whose name a shell would split.
    const node = join(dir, "it's node")
    await writeFile(node, '#!/bin/sh\nfor arg in "$@"; do echo "$arg"; done\n')
    await chmod(node, 0o755)
    const at = join(dir, 'bin', 'openagent')
    execFileSync('/bin/sh', ['-c', addLauncherLines({ node, dashboard: '/apps/open agent/bin.js' }, at)])
    assert.equal(execFileSync(at, ['--port', '4300']).toString(), '/apps/open agent/bin.js\n--port\n4300\n')
    assert.ok(await hasLauncher(at))
    assert.equal(await readFile(at, 'utf8'), launcherScript({ node, dashboard: '/apps/open agent/bin.js' }))
  }))

test('an openagent there before is replaced, a link never written through; the uninstall takes off the install’s alone', () =>
  inFolder(async dir => {
    const bin = join(dir, 'bin')
    await mkdir(bin)
    // `npm i -g` links its own: the file it points at is the global package's, left as it was.
    const globals = join(dir, 'global-bin.js')
    await writeFile(globals, 'the global package\n')
    const at = join(bin, 'openagent')
    await symlink(globals, at)
    execFileSync('/bin/sh', ['-c', addLauncherLines({ node: '/usr/bin/node', dashboard: '/apps/bin.js' }, at)])
    assert.equal(await readFile(globals, 'utf8'), 'the global package\n')
    assert.equal((await lstat(at)).isSymbolicLink(), false)
    assert.ok((await readFile(at, 'utf8')).includes(LAUNCHER_MARK))
    execFileSync('/bin/sh', ['-c', removeLauncherLine(at)])
    assert.equal(await hasLauncher(at), false)
    // Someone else's openagent stays.
    await writeFile(at, '#!/bin/sh\necho mine\n')
    execFileSync('/bin/sh', ['-c', removeLauncherLine(at)])
    assert.equal(await readFile(at, 'utf8'), '#!/bin/sh\necho mine\n')
    // And none at all is nothing to take off.
    execFileSync('/bin/sh', ['-c', removeLauncherLine(join(bin, 'none'))])
  }))
