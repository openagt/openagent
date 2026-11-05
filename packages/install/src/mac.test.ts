import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADDRESS, LOOPBACK_ADDRESS, addHostsLine, adminInstallScript, adminUninstallScript, dashboardPlist, portPlist, portRule, quoted, removeHostsLine } from './mac.js'

/** The scripts are a Mac's: its `sed`, `plutil` and `launchctl`. */
const onMac = { skip: process.platform !== 'darwin' }

const sh = (script: string) => execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8' })

test('quoted keeps any value one word, quotes included', () => {
  for (const value of ["it's", 'a b', '$HOME', '"x"', "''"]) assert.equal(sh(`printf '%s' ${quoted(value)}`), value)
})

test('the hosts line is added once, however often, and taken off with the rest left as it was', onMac, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'install-hosts-'))
  const hosts = join(dir, 'hosts')
  try {
    // A last line with no end: the install's must not be joined to it.
    await writeFile(hosts, '127.0.0.1 localhost\n255.255.255.255 broadcasthost')
    sh(addHostsLine(hosts, ADDRESS))
    sh(addHostsLine(hosts, ADDRESS))
    assert.equal(await readFile(hosts, 'utf8'), `127.0.0.1 localhost\n255.255.255.255 broadcasthost\n${LOOPBACK_ADDRESS} ${ADDRESS} # OpenAgent\n`)
    sh(removeHostsLine(hosts))
    assert.equal(await readFile(hosts, 'utf8'), '127.0.0.1 localhost\n255.255.255.255 broadcasthost\n')
    // Nothing to take off: the file is left alone.
    sh(removeHostsLine(hosts))
    assert.equal(await readFile(hosts, 'utf8'), '127.0.0.1 localhost\n255.255.255.255 broadcasthost\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the launch agent and the launch daemon are property lists macOS reads', onMac, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'install-plist-'))
  try {
    const files = {
      agent: dashboardPlist({ node: '/usr/local/bin/node', dashboard: '/x/a & b/<bin>.js', home: '/Users/x', env: { PATH: '/usr/bin:/bin' }, log: '/Users/x/Library/Logs/OpenAgent/dashboard.log' }),
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
  assert.equal(portRule(4243), `rdr pass on lo0 inet proto tcp from any to ${LOOPBACK_ADDRESS} port 443 -> 127.0.0.1 port 4243\n`)
})

test('the administrator scripts are whole shell scripts', () => {
  for (const script of [adminInstallScript(), adminUninstallScript()]) execFileSync('/bin/sh', ['-n', '-c', script])
})
