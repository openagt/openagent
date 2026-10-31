import { beforeEach } from 'vitest'
import { forgetRemembered } from './use-async.js'

// The answers `use-async` remembers per key live for the page's life, which in a test run is the
// whole file, and the ones it stores live in the browser's storage: forget both before each test,
// so one test's answer is never another's first frame.
beforeEach(() => {
  forgetRemembered()
  localStorage.clear()
})
