import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { FIREWALL_UNIT, HELPER, PERSONS_DIR, PERSON_HELPER, PERSON_UNIT, SERVICE_UNIT, STEPS, SUDOERS, linkScript, quoted, removePersonScript } from './steps.js'

const run = promisify(execFile)

/** Run the helper, or a text made from it, with these words: how it ends, and what it said. */
function helper(args: string[], text = HELPER): Promise<{ code: number; out: string; err: string }> {
  return new Promise(resolve => {
    const child = execFile('bash', ['-s', ...args], (error, out, err) => resolve({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, out, err }))
    child.stdin!.end(text)
  })
}

/** The helper with its last part, which reads the words it is given, put in place of `what`: a part of it, tried alone. */
const only = (what: string): string => {
  const at = HELPER.lastIndexOf('case "${1:-}" in')
  assert.notEqual(at, -1)
  return `${HELPER.slice(0, at)}${what}\n`
}

test('the helper is a script a shell reads, and a word it is not made for does nothing', async () => {
  await run('bash', ['-n', '-c', HELPER])
  for (const args of [[], ['nothing'], ['add', 'rom'], ['add', 'rom', '4300', 'more'], ['remove'], ['firewall', 'now']]) {
    const said = await helper(args)
    assert.equal(said.code, 2, args.join(' '))
    assert.match(said.err, /^usage: openagent-person /)
  }
})

test('every word the helper is given is checked before anything is done with it', async () => {
  for (const account of ['Rom', 'rom;id', '-rom', 'rom-', 'ro--m', '../rom', 'a'.repeat(40), '']) {
    const said = await helper(['add', account, '4300'])
    assert.equal(said.code, 1, account)
    assert.equal(said.err, `${account} is not a GitHub account.\n`)
    assert.equal((await helper(['remove', account])).err, `${account} is not a GitHub account.\n`)
  }
  // Never one of the owner's ports, never one in the middle of a block, nothing that only reads as a number.
  for (const port of ['4200', '4299', '4350', '04300', '10000', '43OO', '4300 ', '$(id)', '-1']) {
    const said = await helper(['add', 'rom', port])
    assert.equal(said.code, 1, port)
    assert.equal(said.err, `${port} is not the first port of a person's block.\n`)
  }
})

test('a person\'s user is named after their account, and one too long for a user name is folded the same way every time', async () => {
  const userOf = async (account: string): Promise<string> => (await helper([account], only('user_of "$1"'))).out.trim()
  assert.equal(await userOf('rom'), 'oa-rom')
  assert.equal(await userOf('a'.repeat(29)), `oa-${'a'.repeat(29)}`)
  const long = `${'b'.repeat(20)}-and-more-than-that`
  const folded = await userOf(long)
  assert.equal(folded, `oa-${'b'.repeat(20)}-${createHash('sha256').update(long).digest('hex').slice(0, 8)}`)
  assert.equal(folded.length, 32)
  // Every name it makes is one the helper takes back as its own.
  assert.equal((await helper([folded], only('user_ok "$1" && echo yes'))).out, 'yes\n')
})

test('the firewall lets only its owner\'s user and root call a block of ports and answer from it, and a file that names no person is none', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'servers-persons-'))
  try {
    await writeFile(join(dir, 'oa-rom.env'), 'OPENAGENT_PERSON=rom\nPORT=4300\n')
    await writeFile(join(dir, 'oa-dani.env'), 'OPENAGENT_PERSON=dani\nPORT=4400\n')
    // A user that is no longer there, a file of another name, a port that is the owner's, a port that reads as more.
    await writeFile(join(dir, 'oa-gone.env'), 'PORT=4500\n')
    await writeFile(join(dir, 'someone.env'), 'PORT=4600\n')
    await writeFile(join(dir, 'oa-owner.env'), 'PORT=4200\n')
    await writeFile(join(dir, 'oa-more.env'), 'PORT=4700 4800\n')
    const text = only('rules').replace(`PERSONS=${PERSONS_DIR}`, `PERSONS=${quoted(dir)}`).replace(/^is_user\(\) \{.*\}$/m, 'is_user() { [ "$1" != oa-gone ]; }')
    const said = await helper([], text)
    assert.equal(said.code, 0, said.err)
    const rule = (ports: string, who: string): string => `    oifname "lo" tcp dport ${ports} meta skuid != { ${who} } reject with tcp reset\n    oifname "lo" tcp sport ${ports} meta skuid != { ${who} } drop\n`
    // Root stays let in everywhere: the install itself asks the owner's OpenAgent whether it answers.
    assert.equal(said.out, rule('4200-4299', '"openagent", "root"') + rule('4400-4499', '"oa-dani", "openagent", "root"') + rule('4300-4399', '"oa-rom", "openagent", "root"'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the helper puts the rules in place in one go, and waits its turn behind another change', () => {
  assert.match(HELPER, /^table inet openagent\ndelete table inet openagent\ntable inet openagent \{$/m)
  assert.match(HELPER, /^lock\(\) \{ exec 9>\/run\/openagent-person\.lock; flock -w 600 9 /m)
  // Root finds its programs in the system's own folders only.
  assert.match(HELPER, /^export PATH=\/usr\/local\/sbin:\/usr\/local\/bin:\/usr\/sbin:\/usr\/bin:\/sbin:\/bin$/m)
  // Claude Code is installed as the person, with nothing of root's around it.
  assert.match(HELPER, /runuser -u "\$user" -- env -i HOME="\$home" /)
})

test('the server\'s user may run the helper as root, and nothing else', () => {
  assert.equal(SUDOERS, `openagent ALL=(root) NOPASSWD: ${PERSON_HELPER}`)
  assert.equal(PERSON_HELPER, '/opt/openagent/bin/openagent-person')
})

test('a person\'s OpenAgent runs as their own user, on their port, and what their user writes cannot change whose it is or where it listens', () => {
  assert.match(PERSON_UNIT, /^User=%i$/m)
  assert.match(PERSON_UNIT, /^ExecStart=\/opt\/openagent\/node\/bin\/openagent --port \$\{PORT\}$/m)
  // The person's own file first, root's last: what is said twice is what the last one says.
  const files = PERSON_UNIT.split('\n').filter(line => line.startsWith('EnvironmentFile='))
  assert.deepEqual(files, ['EnvironmentFile=-/home/%i/.config/openagent/claude.env', 'EnvironmentFile=/etc/openagent/persons/%i.env'])
  for (const unit of [PERSON_UNIT, SERVICE_UNIT]) {
    // A run goes on when its OpenAgent starts again; and each OpenAgent sees only its own user's programs, whose command lines hold prompts.
    assert.match(unit, /^KillMode=process$/m)
    assert.match(unit, /^ProtectProc=invisible$/m)
    assert.match(unit, /^Environment=OPENAGENT_SERVER=1$/m)
    assert.match(unit, /^After=network-online\.target openagent-firewall\.service$/m)
  }
  // Only the owner's OpenAgent knows of the helper, and only it holds the right to listen on the door's ports.
  assert.match(SERVICE_UNIT, /^Environment=OPENAGENT_PERSON_HELPER=\/opt\/openagent\/bin\/openagent-person$/m)
  assert.doesNotMatch(PERSON_UNIT, /OPENAGENT_PERSON_HELPER|AmbientCapabilities/)
  assert.match(FIREWALL_UNIT, /^Type=oneshot$/m)
  assert.match(FIREWALL_UNIT, /^ExecStart=\/opt\/openagent\/bin\/openagent-person firewall$/m)
  assert.match(FIREWALL_UNIT, /^After=nftables\.service$/m)
  assert.match(FIREWALL_UNIT, /^Before=openagent\.service$/m)
})

test('the install writes the helper, the rule, and the two services, each as one word of its script', async () => {
  const people = STEPS.find(step => step.id === 'people')!
  assert.equal(people.as, 'root')
  const text = people.script({ address: '203.0.113.5', version: '1.2.3' })
  for (const [name, value] of Object.entries({ HELPER, SUDOERS, PERSON_UNIT, FIREWALL_UNIT })) assert.ok(text.includes(`\n${name}=${quoted(value)}\n`), name)
  // sudo is let read the rule only once it has said it can.
  assert.match(text, /visudo -cf "\$tmp" >\/dev\/null \|\| \{ rm -f "\$tmp"; fail /)
  // It comes before the service: the rules are in place before the owner's OpenAgent starts with the helper.
  const ids = STEPS.map(step => step.id)
  assert.ok(ids.indexOf('people') < ids.indexOf('service'))
  // A person's OpenAgent starts again with a new OpenAgent, as the owner's does.
  assert.match(text, /if \[ "\$persons" = 1 \] \|\| \[ -e \/opt\/openagent\/restart \]; then/)
  await run('bash', ['-n', '-c', text])
})

test('the door is told where the helper is when a person is let in or taken out over SSH, and not for a device of the owner\'s', () => {
  const told = /^OPENAGENT_PERSON_HELPER=\/opt\/openagent\/bin\/openagent-person \/opt\/openagent\/node\/bin\/node \S+\/remote-access /m
  assert.match(linkScript('rom'), told)
  assert.match(removePersonScript('rom'), told)
  assert.doesNotMatch(linkScript(), /OPENAGENT_PERSON_HELPER/)
})
