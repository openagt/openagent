import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ADDRESS, LOOPBACK_ADDRESS, addHostsLine, quoted, removeHostsLine } from './address.js'

const sh = (script: string) => execFileSync('/bin/sh', ['-c', script], { encoding: 'utf8' })

test('quoted keeps any value one word, quotes included', () => {
  for (const value of ["it's", 'a b', '$HOME', '"x"', "''"]) assert.equal(sh(`printf '%s' ${quoted(value)}`), value)
})

test('the hosts line is added once, however often, and taken off with the rest left as it was', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'install-hosts-'))
  const hosts = join(dir, 'hosts')
  try {
    // A last line with no end: the install's must not be joined to it.
    await writeFile(hosts, '127.0.0.1 localhost\n255.255.255.255 broadcasthost')
    sh(addHostsLine(hosts))
    sh(addHostsLine(hosts))
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


test('a hosts file that is a link stays a link, and the file it points at gets the line', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'install-hosts-'))
  const real = join(dir, 'real-hosts')
  const hosts = join(dir, 'hosts')
  try {
    await writeFile(real, '127.0.0.1 localhost\n')
    await symlink(real, hosts)
    sh(addHostsLine(hosts))
    assert.equal(await readFile(real, 'utf8'), `127.0.0.1 localhost\n${LOOPBACK_ADDRESS} ${ADDRESS} # OpenAgent\n`)
    sh(removeHostsLine(hosts))
    assert.equal(await readFile(real, 'utf8'), '127.0.0.1 localhost\n')
    assert.equal(sh(`[ -L ${quoted(hosts)} ] && echo link`), 'link\n')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
