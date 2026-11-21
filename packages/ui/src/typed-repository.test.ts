import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { typedRepository } from './typed-repository.js'

test("a repository's address as a person types it gives what git is given, the one address every machine knows it by, and its name; a search word gives none", () => {
  assert.deepEqual(typedRepository('github.com/ada/shop'), { url: 'https://github.com/ada/shop', address: 'github.com/ada/shop', name: 'shop' })
  assert.deepEqual(typedRepository('git@github.com:ada/Shop.git'), { url: 'git@github.com:ada/Shop.git', address: 'github.com/ada/shop', name: 'Shop' })
  assert.deepEqual(typedRepository('gitlab.example.com/Team/Sub/My.App'), { url: 'https://gitlab.example.com/Team/Sub/My.App', address: 'gitlab.example.com/team/sub/my.app', name: 'My.App' })
  for (const typed of ['', 'shop', 'ada/shop', '/Users/ada/shop', 'https://me:token@github.com/ada/shop', 'github.com/ada/../etc']) assert.equal(typedRepository(typed), undefined, typed)
})
