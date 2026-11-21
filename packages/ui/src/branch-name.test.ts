import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { isBranchName } from './branch-name.js'

/** What git itself says of the name. */
function gitTakes(name: string): boolean {
  try {
    execFileSync('git', ['check-ref-format', '--branch', name], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

test('a branch name is what git takes as one: plain names, slashes, dots, other alphabets', () => {
  for (const name of ['main', 'launcher-start-branch', 'fix/issue-1901', 'v1.2', 'feature/#12', 'été', 'a@b', 'x'.repeat(255)]) {
    assert.equal(isBranchName(name), true, name)
    assert.equal(gitTakes(name), true, `git takes ${name}`)
  }
})

test('a word a command line could read as an option is no branch name', () => {
  for (const name of ['-b', '--upload-pack=x', '-']) assert.equal(isBranchName(name), false, name)
})

test('what git refuses as a branch name is refused, and so is anything that is not text', () => {
  for (const name of ['', 'HEAD', '@', 'a b', 'a..b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b', 'x@{1}', '/a', 'a/', 'a//b', '.a', 'a/.b', 'a.lock', 'a.lock/b', 'a.', 'a\nb', 'a\tb', 'a\x7fb']) {
    assert.equal(isBranchName(name), false, JSON.stringify(name))
    // `HEAD` and `@` are words git reads as "where I am", not as a branch's name; the rest it refuses here.
    if (name !== 'HEAD' && name !== '@') assert.equal(gitTakes(name), false, `git refuses ${JSON.stringify(name)}`)
  }
  assert.equal(isBranchName('x'.repeat(256)), false)
  for (const value of [undefined, null, 7, ['main'], { name: 'main' }]) assert.equal(isBranchName(value), false)
})
