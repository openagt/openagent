import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installCommand } from './gh.js'

test('installCommand: Homebrew where it is, else GitHub’s build for this computer into ~/.local/bin; none where GitHub makes none', () => {
  assert.equal(installCommand(true), 'brew install gh')
  const mac = installCommand(false, 'darwin', 'arm64')!
  assert.match(mac, /releases\/download\/v\$v\/gh_\$\{v\}_macOS_arm64\.zip/)
  assert.match(mac, /unzip -q/)
  assert.match(mac, /mv "\$d"\/gh_\*\/bin\/gh ~\/\.local\/bin\//)
  assert.match(installCommand(false, 'linux', 'x64')!, /linux_amd64\.tar\.gz.*tar -xzf/)
  assert.equal(installCommand(false, 'win32', 'x64'), undefined)
})

test('the install, run for real in a home of its own, puts a working gh in its ~/.local/bin', { skip: process.env['OPENAGENT_NETWORK_TESTS'] !== '1' && 'reaches GitHub: OPENAGENT_NETWORK_TESTS=1' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'gh-home-'))
  try {
    execFileSync('sh', ['-c', installCommand(false)!], { env: { ...process.env, HOME: home } })
    assert.match(execFileSync(join(home, '.local', 'bin', 'gh'), ['--version'], { encoding: 'utf8' }), /^gh version/)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
