import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SECURE_PORT } from '@openagt/dashboard/secure-address'
import { LOOPBACK_ADDRESS } from './address.js'
import { adminInstallScript, adminUninstallScript, dashboardPlist, portPlist, portRule } from './mac.js'

/** The property lists are read by a Mac's `plutil`. */
const onMac = { skip: process.platform !== 'darwin' }

test('the launch agent and the launch daemon are property lists macOS reads', onMac, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'install-plist-'))
  try {
    const files = {
      agent: dashboardPlist({ node: '/usr/local/bin/node', dashboard: '/x/a & b/<bin>.js', home: '/Users/x', vars: { PATH: '/usr/bin:/bin' }, log: '/Users/x/Library/Logs/OpenAgent/dashboard.log' }),
      port: portPlist(),
    }
    for (const [name, text] of Object.entries(files)) {
      await writeFile(join(dir, `${name}.plist`), text)
      execFileSync('plutil', ['-lint', join(dir, `${name}.plist`)])
    }
    const agent = JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', join(dir, 'agent.plist')], { encoding: 'utf8' }))
    assert.deepEqual(agent.ProgramArguments, ['/usr/local/bin/node', '/x/a & b/<bin>.js'])
    assert.deepEqual(agent.KeepAlive, { SuccessfulExit: false })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the port rule touches the address alone, not all of 127.0.0.1', () => {
  assert.equal(portRule(), `rdr pass on lo0 inet proto tcp from any to ${LOOPBACK_ADDRESS} port 443 -> 127.0.0.1 port ${SECURE_PORT}\n`)
})

test('the administrator scripts are whole shell scripts', () => {
  for (const script of [adminInstallScript(), adminUninstallScript()]) execFileSync('/bin/sh', ['-n', '-c', script])
})
