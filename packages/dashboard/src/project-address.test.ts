import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { projectAddresses } from './project-address.js'

// Two projects named `shop` (the second one added gets its id as its address), one named `app`,
// and one named as a page's word.
const projects = projectAddresses(['shop-1abc', 'app-a1', 'shop-2def', 'logs-9zz'], ['logs', 'tickets'])

test("a project's address is its folder's name: its id without the `-<hash>`", () => {
  assert.equal(projects.addressOf('app-a1'), 'app')
  assert.equal(projects.addressOf('shop-1abc'), 'shop')
  assert.equal(projectAddresses(['my-repo-a1b2'], []).addressOf('my-repo-a1b2'), 'my-repo')
})

test('the name goes to the first project added that has it, and its id to the next', () => {
  assert.equal(projects.addressOf('shop-2def'), 'shop-2def')
  assert.equal(projectAddresses(['shop-2def'], []).addressOf('shop-2def'), 'shop')
})

test("a name that is a page's word goes to the page, and its id to the project", () => {
  assert.equal(projects.addressOf('logs-9zz'), 'logs-9zz')
  assert.equal(projectAddresses(['overview-1a'], []).addressOf('overview-1a'), 'overview-1a')
  assert.equal(projectAddresses(['settings-2b'], []).addressOf('settings-2b'), 'settings-2b')
})

test('a project is found by its address and by its id', () => {
  assert.equal(projects.projectOf('shop'), 'shop-1abc')
  assert.equal(projects.projectOf('shop-1abc'), 'shop-1abc')
  assert.equal(projects.projectOf('shop-2def'), 'shop-2def')
  assert.equal(projects.projectOf('logs'), undefined)
  assert.equal(projects.projectOf('nope'), undefined)
})

test('an id it does not know is written as it is', () => {
  assert.equal(projects.addressOf('gone-7x'), 'gone-7x')
})
