import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { carriedSkills, GROUPS, SKILL_NAMES } from './catalogue.js'
import { olderThan, stamped, unstamped } from './skill-file.js'

test('the list holds 20 skills in six groups, everything ticked but the two that need a setup of their own, and none every run gets by default', async () => {
  assert.equal(SKILL_NAMES.length, 20)
  assert.equal(new Set(SKILL_NAMES).size, 20, 'no skill twice')
  assert.equal(GROUPS.length, 6)
  assert.deepEqual(GROUPS.filter(group => !group.ticked).flatMap(group => group.skills), ['browser', 'discord'])
  for (const basic of ['branches', 'logs', 'question', 'github', 'orchestration', 'tickets', 'queue']) assert.ok(!SKILL_NAMES.includes(basic), `${basic} comes with every run`)
})

test('every skill is carried with its own package\'s text: its name, a description, a version, and its command by full name only', async () => {
  const carried = await carriedSkills()
  assert.deepEqual([...carried.keys()], [...SKILL_NAMES])
  for (const skill of carried.values()) {
    assert.match(skill.text, new RegExp(`^---\\nname: ${skill.name}\\n`), `${skill.name}'s text opens with its name`)
    assert.ok(skill.description.length > 10 && !skill.description.includes('\n') && !skill.description.startsWith('"'), `${skill.name} has a one-line description`)
    assert.match(skill.version, /^\d+\.\d+\.\d+$/)
    assert.equal(skill.package, `@openagt/skill-${skill.name}`)
    // A short name would run whatever package holds it on npm in a project with nothing installed.
    assert.doesNotMatch(skill.text, /npx (tickets|queue|logs|github|branches|browser|discord|orchestration|scheduler)\b/, `${skill.name} calls no command by a short name`)
    assert.ok(!/^metadata:/m.test(skill.text.slice(0, skill.text.indexOf('\n---\n'))), `${skill.name}'s own text has no metadata key: the stamp is OpenAgent's`)
  }
})

test('a written text carries its version, and reads back as the text and the version, for every skill', async () => {
  for (const skill of (await carriedSkills()).values()) {
    const file = stamped(skill.text, skill.version)
    assert.notEqual(file, skill.text)
    assert.match(file, new RegExp(`\\nmetadata:\\n  version: ${skill.version.replaceAll('.', '\\.')}\\n---\\n`))
    assert.deepEqual(unstamped(file), { version: skill.version, text: skill.text })
    // The front matter still parses as the coding agents read it: the name first, the body untouched.
    assert.ok(file.startsWith(`---\nname: ${skill.name}\n`))
    assert.equal(file.slice(file.indexOf('\n---\n')), skill.text.slice(skill.text.indexOf('\n---\n')))
  }
})

test('a text with no stamp reads back as it is; a stamp-shaped line in the body is not a stamp', () => {
  const plain = '---\nname: mine\n---\nBody.\n'
  assert.deepEqual(unstamped(plain), { text: plain })
  const inBody = '---\nname: mine\n---\nBody.\nmetadata:\n  version: 9.9.9\n---\nMore.\n'
  assert.deepEqual(unstamped(inBody), { text: inBody })
  assert.deepEqual(unstamped('no front matter\n'), { text: 'no front matter\n' })
  assert.equal(stamped('no front matter\n', '1.2.3'), '---\nmetadata:\n  version: 1.2.3\n---\nno front matter\n')
})

test('versions compare by their numbers', () => {
  assert.equal(olderThan('0.1.2', '0.1.10'), true)
  assert.equal(olderThan('0.1.10', '0.1.2'), false)
  assert.equal(olderThan('0.1.0', '0.1.0'), false)
  assert.equal(olderThan('0.9.9', '1.0.0'), true)
  assert.equal(olderThan('nonsense', '1.0.0'), false)
})
