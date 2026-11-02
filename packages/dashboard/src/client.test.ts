import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// The client barrel's whole contract: the dashboard imports it in a browser, so
// nothing reachable from it may import `node:*` (#431). An export added to it
// breaks this by accident the day its module reads a file.
//
// Walk the real import graph rather than trusting the rule to be remembered. It
// walks the *compiled* output, not the source: `import type` erases at compile,
// so source would report type-only edges (run-view -> driver) as false leaks.
// What ships is what matters.
const OUT = dirname(fileURLToPath(import.meta.url))

async function nodeImportsReachableFrom(entry: string): Promise<string[]> {
  const seen = new Set<string>()
  const leaks: string[] = []
  const queue = [entry]
  while (queue.length) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const text = await readFile(file, 'utf8')
    for (const match of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = match[1]!
      if (spec.startsWith('node:')) leaks.push(`${file.slice(OUT.length + 1)} -> ${spec}`)
      else if (spec.startsWith('.')) queue.push(resolve(dirname(file), spec))
    }
  }
  return leaks
}

test('the client barrel reaches no node: import, so it stays browser-safe (#431/#520)', async () => {
  const leaks = await nodeImportsReachableFrom(join(OUT, 'client.js'))
  assert.deepEqual(leaks, [], `client.js must not reach node:* — found:\n${leaks.join('\n')}`)
})
