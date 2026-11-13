// The licence of every font a build ships, beside its files (the SIL Open Font License asks that
// its text go with every copy): a Vite plugin the dashboard's build and the website's use. It writes
// `LICENSE-fonts.txt` at the root of the build, read from the `@fontsource` packages the build's
// font files came from: each family as its stylesheet names it, then its package's own LICENSE.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const FONT_LICENSES = 'LICENSE-fonts.txt'

/** @returns {import('vite').Plugin} */
export function fontLicenses() {
  return {
    name: 'openagent:font-licenses',
    apply: 'build',
    generateBundle(_options, bundle) {
      const packages = new Set()
      for (const output of Object.values(bundle)) {
        if (output.type !== 'asset' || !output.fileName.endsWith('.woff2')) continue
        for (const source of output.originalFileNames) {
          const found = /^(.*\/@fontsource(?:-variable)?\/[^/]+)\//.exec(source)
          if (!found) throw new Error(`${output.fileName} comes from no @fontsource package (${source}): its licence cannot be shipped with it`)
          packages.add(found[1])
        }
      }
      if (packages.size === 0) return
      const sections = [...packages].sort().map(dir => {
        const { name, license } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
        const families = [...new Set([...readFileSync(join(dir, 'index.css'), 'utf8').matchAll(/font-family:\s*'([^']+)'/g)].map(match => match[1]))]
        return `${families.join(', ')} (${name}, ${license})\n\n${readFileSync(join(dir, 'LICENSE'), 'utf8').trim()}\n`
      })
      this.emitFile({
        type: 'asset',
        fileName: FONT_LICENSES,
        source: `The fonts this build ships, each under its own licence.\n\n${sections.join('\n----\n\n')}`,
      })
    },
  }
}
