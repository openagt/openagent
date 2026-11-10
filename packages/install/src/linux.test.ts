import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SECURE_PORT } from '@openagt/dashboard/secure-address'
import { LOOPBACK_ADDRESS } from './address.js'
import { SYSTEM_STORE, adminInstallScript, adminUninstallScript, certificateStores, dashboardUnit, installPackagesLine, installPackagesScript, portRule, portUnit, unitWord } from './linux.js'

test('a unit file word keeps quotes, backslashes, % and, on a command line, $ as they are', () => {
  assert.equal(unitWord('/a b/"c"\\d 100%'), '"/a b/\\"c\\"\\\\d 100%%"')
  assert.equal(unitWord('/x/$HOME', { exec: true }), '"/x/$$HOME"')
  assert.equal(unitWord('PATH=/x/$HOME'), '"PATH=/x/$HOME"')
})

test('the dashboard service runs node on the dashboard, with the terminal’s variables, and again only when it fails', () => {
  const unit = dashboardUnit({ node: '/home/a/.nvm/node', dashboard: '/home/a/my apps/bin.js', vars: { PATH: '/home/a/bin:/usr/bin', XDG_CONFIG_HOME: '/home/a/cfg' } })
  assert.match(unit, /^ExecStart="\/home\/a\/.nvm\/node" "\/home\/a\/my apps\/bin.js"$/m)
  assert.match(unit, /^Environment="PATH=\/home\/a\/bin:\/usr\/bin"$/m)
  assert.match(unit, /^Environment="XDG_CONFIG_HOME=\/home\/a\/cfg"$/m)
  assert.match(unit, /^Restart=on-failure$/m)
  assert.match(unit, /^WantedBy=default.target$/m)
})

test('the port rule touches the address alone, in a table of its own, and loads again after the firewall’s', () => {
  assert.equal(
    portRule(),
    `add table ip openagent; flush table ip openagent; add chain ip openagent output { type nat hook output priority -100 ; }; add rule ip openagent output ip daddr ${LOOPBACK_ADDRESS} tcp dport 443 redirect to :${SECURE_PORT}`,
  )
  const unit = portUnit()
  assert.match(unit, new RegExp(`^ExecStart=nft "add table ip openagent; .*redirect to :${SECURE_PORT}"$`, 'm'))
  assert.match(unit, /^ExecStop=nft "delete table ip openagent"$/m)
  assert.match(unit, /^After=nftables.service firewalld.service$/m)
  assert.match(unit, /^PartOf=nftables.service$/m)
  assert.match(unit, /^WantedBy=multi-user.target nftables.service$/m)
})

test('the administrator scripts are whole shell scripts, with the system store where the computer has one', () => {
  const store = SYSTEM_STORE
  for (const script of [adminInstallScript("/home/o'neil/cert.pem", store), adminInstallScript('/c.pem', undefined), adminUninstallScript(store), adminUninstallScript(undefined)]) {
    execFileSync('/bin/sh', ['-n', '-c', script])
  }
  assert.match(adminInstallScript("/home/o'neil/cert.pem", store), /^install -m 644 '\/home\/o'\\''neil\/cert.pem' '\/usr\/local\/share\/ca-certificates\/openagent.build.crt'\nupdate-ca-certificates >\/dev\/null 2>&1$/m)
  assert.doesNotMatch(adminInstallScript('/c.pem', undefined), /ca-certificates|update-ca/)
  assert.match(adminUninstallScript(store), /rm -f '\/usr\/local\/share\/ca-certificates\/openagent.build.crt'; update-ca-certificates/)
})

test('apt-get reads the list of packages when it knows none yet; the others install at once', () => {
  assert.equal(installPackagesLine('apt-get', ['libnss3-tools']), "DEBIAN_FRONTEND=noninteractive apt-get install -y 'libnss3-tools' || { apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y 'libnss3-tools'; }")
  assert.equal(installPackagesLine('dnf', ['nss-tools', 'nftables']), "dnf install -y 'nss-tools' 'nftables'")
})

test('the browsers’ certificate stores: Chrome’s, even before Chrome made it, and each Firefox profile’s, wherever Firefox came from', async () => {
  const home = await mkdtemp(join(tmpdir(), 'install-home-'))
  try {
    const profile = async (dir: string) => (await mkdir(dir, { recursive: true }), writeFile(join(dir, 'cert9.db'), ''))
    await profile(join(home, '.mozilla', 'firefox', 'abc.default-release'))
    await profile(join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox', 'def.default'))
    // A folder with no store in it is no profile.
    await mkdir(join(home, '.mozilla', 'firefox', 'Crash Reports'), { recursive: true })
    assert.deepEqual(await certificateStores(home, { withChrome: true }), [
      join(home, '.pki', 'nssdb'),
      join(home, '.mozilla', 'firefox', 'abc.default-release'),
      join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox', 'def.default'),
    ])
    // Taking the certificate off, a Chrome store that is not there is left alone.
    assert.deepEqual(await certificateStores(home, { withChrome: false }), [
      join(home, '.mozilla', 'firefox', 'abc.default-release'),
      join(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox', 'def.default'),
    ])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('the package manager is heard only when it fails, and then all it said is', () => {
  const quiet = (line: string) => installPackagesScript('dnf', ['x']).replace(installPackagesLine('dnf', ['x']), line)
  const run = (script: string) => spawnSync('/bin/sh', ['-c', script], { encoding: 'utf8' })
  const fine = run(quiet('echo progress; echo more >&2'))
  assert.deepEqual([fine.status, fine.stdout, fine.stderr], [0, '', ''])
  const failed = run(quiet('echo progress; echo "No match for argument: x" >&2; false'))
  assert.deepEqual([failed.status, failed.stdout, failed.stderr], [1, '', 'progress\nNo match for argument: x\n'])
})
