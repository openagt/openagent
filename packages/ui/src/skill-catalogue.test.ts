import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { distributionPackages } from './distribution-packages.js'
import { descriptionOf, GROUPS, SKILL_NAMES } from './skill-catalogue.js'
import { handDownTestDistribution } from './test-distribution.js'

handDownTestDistribution()

test('the list holds 13 skills in five groups, and none every run gets by default', () => {
  assert.equal(SKILL_NAMES.length, 13)
  assert.equal(new Set(SKILL_NAMES).size, 13, 'no skill twice')
  assert.deepEqual(GROUPS.map(group => group.title), ['Tickets and queue', 'Agents', 'Pull requests', 'Automations', 'Needs its own setup'])
  // The prompts nothing in the product uses are not carried: their texts are in the repository's skills folder.
  for (const left of ['readability', 'research', 'ux', 'post-merge-cleanup', 'suggest-new-tickets']) assert.ok(!SKILL_NAMES.includes(left), `${left} is not carried`)
  for (const basic of ['branches', 'ask', 'github']) assert.ok(!SKILL_NAMES.includes(basic), `${basic} comes with every run`)
})

test("every skill of the list is its own package's, in the distribution: its text opens with its name, says what it does in one line, and runs its command by its full name only", async () => {
  const packages = await distributionPackages()
  for (const name of SKILL_NAMES) {
    const pkg = packages.find(each => each.skill === name)
    assert.ok(pkg, `${name} is carried`)
    assert.equal(pkg.name, `@openagt/skill-${name}`)
    const text = await readFile(join(pkg.dir, 'SKILL.md'), 'utf8')
    assert.match(text, new RegExp(`^---\\nname: ${name}\\n`), `${name}'s text opens with its name`)
    const description = descriptionOf(text)
    assert.ok(description.length > 10 && !description.startsWith('"'), `${name} has a one-line description`)
    // A short name would run whatever package holds it on npm, in a run's checkout with nothing installed.
    assert.doesNotMatch(text, /npx (tickets|queue|logs|github|branches|browser|discord|scheduler)\b/, `${name} calls no command by a short name`)
  }
})
