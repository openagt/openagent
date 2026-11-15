import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

// The entry points browser-side code imports (`./names`, `./repository-address`) import nothing at
// all: one node module there drags node-only code into a page's bundle, and the bundler says so
// only as a warning, in another package's build.
for (const entry of ['names', 'repository-address']) {
  test(`${entry} imports nothing, so browser-side code can import it`, async () => {
    const source = await readFile(new URL(`./${entry}.js`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /^\s*(import|export .* from)\b/m)
  })
}
