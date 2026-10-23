import { strict as assert } from 'node:assert'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { runCli } from './cli.js'
import { fixLine, ownKey, plainKey, testConnection } from './connection.js'
import type { Exec } from './ssh.js'
import { pretendServer, testHome } from './test-home.js'

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOpenAgentTestKey0123456789abcdefghijklmn suleiman@mac'
const ON = { address: '192.168.1.40', user: 'dani' }
const key = async (): Promise<string> => KEY

test('a server that lets this computer in as root says what it runs and its key, and the test is the install\'s own first step, nothing more', async () => {
  const { exec, calls } = pretendServer(call => (call.remote === 'sudo -n bash -s' ? { out: 'Ubuntu 24.04.1 LTS, x86_64\n' } : undefined))
  assert.deepEqual(await testConnection(ON, { exec, key }), { ok: true, system: 'Ubuntu 24.04.1 LTS, x86_64', fingerprint: 'SHA256:0123456789abcdefghijklmnopqrstuvwxyzABCDEFG' })
  assert.deepEqual(
    calls.map(call => call.remote),
    ['true', 'sudo -n bash -s'],
  )
  assert.match(calls[1]!.script, /OpenAgent installs on Ubuntu and Debian/)
})

test('what failed is told by what a person does about it, with the line to paste on the computer for what is fixed there', async () => {
  for (const [said, trouble, reached] of [
    ['ssh: connect to host 192.168.1.40 port 22: Connection refused', 'no-ssh', true],
    ['dani@192.168.1.40: Permission denied (publickey,password).', 'key', true],
    ['ssh: connect to host 192.168.1.40 port 22: Operation timed out', 'unreachable', false],
    ['ssh: connect to host 192.168.1.40 port 22: No route to host', 'unreachable', false],
    ['ssh: Could not resolve hostname pc.local: nodename nor servname provided', 'unreachable', false],
    ['@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\nHost key verification failed.', 'host-key', true],
  ] as const) {
    const { exec, calls } = pretendServer(call => (call.remote === 'true' ? { code: 255, err: said } : undefined))
    const tested = await testConnection(ON, { exec, key })
    assert.equal(tested.ok, false)
    if (tested.ok) continue
    assert.deepEqual([tested.trouble, tested.reached, tested.said], [trouble, reached, said], said)
    // Only a computer that answered and is fixed there gets the line.
    assert.equal(tested.fix, trouble === 'no-ssh' || trouble === 'key' ? fixLine(KEY, 'dani') : undefined, said)
    // Nothing else was asked of a server that would not let this computer in.
    assert.deepEqual(calls.map(call => call.remote), ['true'])
  }
})

test('a user that cannot become root without a password, and a system OpenAgent does not install on, are told apart', async () => {
  const sudo = pretendServer(call => (call.remote === 'sudo -n bash -s' ? { code: 1, err: 'sudo: a password is required' } : undefined))
  const asked = await testConnection(ON, { exec: sudo.exec, key })
  assert.deepEqual(asked, { ok: false, trouble: 'sudo', reached: true, said: 'sudo: a password is required', key: KEY, fix: fixLine(KEY, 'dani') })
  const other = pretendServer(call => (call.remote === 'sudo -n bash -s' ? { code: 1, err: 'OpenAgent installs on Ubuntu and Debian. This server runs Fedora Linux 41.' } : undefined))
  assert.deepEqual(await testConnection(ON, { exec: other.exec, key }), { ok: false, trouble: 'system', reached: true, said: 'OpenAgent installs on Ubuntu and Debian. This server runs Fedora Linux 41.' })
})

test('a computer with no SSH key of its own is told that first: there is nothing to put on the server', async () => {
  const none = async (): Promise<undefined> => undefined
  for (const said of ['dani@192.168.1.40: Permission denied (publickey).', 'ssh: connect to host 192.168.1.40 port 22: Connection refused']) {
    const { exec } = pretendServer(call => (call.remote === 'true' ? { code: 255, err: said } : undefined))
    const tested = await testConnection(ON, { exec, key: none })
    assert.equal(!tested.ok && tested.trouble, 'no-key')
    assert.equal(!tested.ok && tested.fix, undefined)
  }
})

test('the key is the first one ssh would offer that has its public half, else the first the SSH agent holds; an odd comment is left out', async () => {
  const run =
    (agent: string): Exec =>
    async bin =>
      bin === 'ssh'
        ? { code: 0, out: 'user dani\nidentityfile ~/.ssh/id_rsa\nidentityfile /keys/id_ed25519\n', err: '' }
        : { code: agent ? 0 : 1, out: agent, err: agent ? '' : 'The agent has no identities.' }
  const files: Record<string, string> = { '/keys/id_ed25519.pub': `${KEY}\n` }
  const read = async (path: string): Promise<string> => files[path] ?? Promise.reject(new Error('ENOENT'))
  assert.equal(await ownKey(ON, run(''), read), KEY)
  assert.equal(await ownKey(ON, run('ssh-rsa AAAAB3NzaC1yc2EAAAADAQAB it\'s mine\n'), async () => Promise.reject(new Error('ENOENT'))), 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQAB')
  assert.equal(await ownKey(ON, run(''), async () => Promise.reject(new Error('ENOENT'))), undefined)
  assert.equal(plainKey('not a key'), undefined)
  assert.equal(plainKey(`${KEY.split(' ').slice(0, 2).join(' ')} "quoted"`), KEY.split(' ').slice(0, 2).join(' '))
})

test('the line is one sh line root runs: SSH on, the key on the user once, and sudo without a password; root gets no sudo rule', async () => {
  const line = fixLine(KEY, 'dani')
  assert.match(line, /^sudo sh -c '[^']*'$/)
  assert.match(line, /apt-get install -y openssh-server/)
  assert.match(line, /grep -qxF "\$k"/)
  assert.match(line, /echo "dani ALL=\(ALL\) NOPASSWD:ALL" > \/etc\/sudoers\.d\/openagent-dani/)
  assert.doesNotMatch(fixLine(KEY, 'root'), /sudoers/)
  // A line sh reads.
  const inner = line.slice("sudo sh -c '".length, -1)
  await promisify(execFile)('sh', ['-n', '-c', inner])
})

test('`test` refuses what is no address or user, and answers what the try found', async () => {
  const home = await testHome()
  try {
    const out: string[] = []
    const err: string[] = []
    const io = { env: home.env, stdout: (line: string) => out.push(line), stderr: (line: string) => err.push(line) }
    assert.equal(await runCli(['test', '-oProxyCommand=sh', 'root'], io), 1)
    assert.equal(await runCli(['test', '192.168.1.40', 'dani;id'], io), 1)
    assert.deepEqual(err, ["-oProxyCommand=sh is not a server's number or name", 'dani;id is not a user name'])
    const { exec } = pretendServer(call => (call.remote === 'true' ? { code: 255, err: 'dani@192.168.1.40: Permission denied (publickey).' } : undefined))
    assert.equal(await runCli(['test', '192.168.1.40', 'dani'], { ...io, exec, ownKey: key }), 0)
    assert.deepEqual(JSON.parse(out.at(-1)!), { ok: false, trouble: 'key', reached: true, said: 'dani@192.168.1.40: Permission denied (publickey).', key: KEY, fix: fixLine(KEY, 'dani') })
  } finally {
    await home.remove()
  }
})
