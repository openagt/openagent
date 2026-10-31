import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

// What a page shares with a skill's browser part. The part imports these by bare name and bundles
// none of them, and the import map this plugin writes into the page points each name at the page's
// own copy, so the part renders in the same React and uses the same components. Each is built as an
// entry of its own that shares its chunks with the page's main entry, fingerprinted like them
// (`/assets/host/<name>-<hash>.js`): the import map, in the page that is always asked for again,
// names this version's, so a browser keeps them for good and a page opened again asks for none.
//
// React ships as CommonJS, and a re-export of CommonJS (`export * from 'react'`) keeps none of its
// names, so each React entry is generated: its names are read off the very package the build uses,
// here, so an upgrade that adds a name can never leave it out. The page's own names are real files.

const REACT: Record<string, string> = {
  react: 'react',
  'react/jsx-runtime': 'react-jsx-runtime',
  'react-dom': 'react-dom',
  'react-dom/client': 'react-dom-client',
}
const PREFIX = 'virtual:skill-ui-host:'

/** A name a page shares that is its own file: the file, and the name of its entry under `host/`. */
export interface HostFile {
  entry: string
  file: string
}

/** The build's entries for what a page shares: add them to `rollupOptions.input`, with `preserveEntrySignatures: 'exports-only'`, since they are imported by name from outside the bundle. */
export function hostInputs(own: Record<string, HostFile>): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(own).map(([, { entry, file }]) => [`host/${entry}`, file])),
    ...Object.fromEntries(Object.entries(REACT).map(([spec, file]) => [`host/${file}`, `${PREFIX}${spec}`])),
  }
}

/** The plugin that makes React's entries and writes the import map: React's names and the page's own. */
export function hostModules(own: Record<string, HostFile>): Plugin {
  const require = createRequire(import.meta.url)
  let serving = false
  return {
    name: 'skill-ui:host-modules',
    configResolved(config) {
      serving = config.command === 'serve'
    },
    resolveId(id) {
      return id.startsWith(PREFIX) ? id : undefined
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return undefined
      const spec = id.slice(PREFIX.length)
      const names = Object.keys(require(spec) as object).filter(name => name !== 'default')
      return [`import M from '${spec}'`, 'export default M', ...names.map(name => `export const ${name} = M.${name}`)].join('\n')
    },
    transformIndexHtml: {
      // After the bundle is written: the map names each host entry by its fingerprinted file.
      order: 'post',
      handler(_html, { bundle }) {
        const built = (name: string): string => {
          const chunk = Object.values(bundle ?? {}).find(output => output.type === 'chunk' && output.isEntry && output.name === name)
          if (!chunk) throw new Error(`the build wrote no ${name} entry`)
          return `/${chunk.fileName}`
        }
        const imports: Record<string, string> = {}
        for (const [spec, file] of Object.entries(REACT)) imports[spec] = serving ? `/@id/${PREFIX}${spec}` : built(`host/${file}`)
        for (const [spec, { entry, file }] of Object.entries(own)) imports[spec] = serving ? `/@fs${file}` : built(`host/${entry}`)
        return [{ tag: 'script', attrs: { type: 'importmap' }, children: JSON.stringify({ imports }, null, 2), injectTo: 'head-prepend' }]
      },
    },
  }
}
