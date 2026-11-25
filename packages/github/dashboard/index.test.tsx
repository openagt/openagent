import { expect, test } from 'vitest'
import github from './index.js'

// What github's UI part brings beside its views and actions: where a session's `#12` leads.

test("#12 in a session's chat leads to that issue or pull request of the project's repository on GitHub; a project elsewhere, or with no remote, is not github's to link", () => {
  const references = github.hooks['ui.option']?.find(option => option.place === 'chat.references')
  if (references?.place !== 'chat.references') throw new Error('github links no references')
  expect(references.issue({ id: 'shop', name: 'shop', remote: 'github.com/me/shop' }, 12)).toBe('https://github.com/me/shop/issues/12')
  expect(references.issue({ id: 'shop', name: 'shop', remote: 'gitlab.com/me/shop' }, 12)).toBeUndefined()
  expect(references.issue({ id: 'shop', name: 'shop' }, 12)).toBeUndefined()
})
