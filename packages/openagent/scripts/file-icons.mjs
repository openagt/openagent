// Write `dashboard/components/file-icons.generated.ts`: the file icons of Material Icon Theme (MIT,
// the `material-icon-theme` dev dependency) for the names and extensions listed here, by the
// theme's own map of which file gets which icon. Only the icons these files use are written, so
// the page carries a few dozen pictures, not the theme's thousand. A file of a kind not listed
// gets the theme's plain file. Run again after changing a list: `node scripts/file-icons.mjs`.
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXTENSIONS = [
  'ts', 'tsx', 'mts', 'cts', 'd.ts', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'json5', 'md', 'mdx', 'txt', 'pdf', 'csv',
  'html', 'htm', 'xml', 'vue', 'svelte', 'astro',
  'css', 'scss', 'sass', 'less',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'avif', 'bmp', 'mp4', 'mp3', 'woff', 'woff2', 'ttf',
  'yml', 'yaml', 'toml', 'ini', 'env', 'lock', 'log', 'zip',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'lua', 'dart', 'ex', 'exs', 'zig',
  'sql', 'graphql', 'gql', 'prisma', 'proto', 'wasm',
]
const NAMES = [
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', 'bun.lockb', '.npmrc', '.nvmrc',
  'tsconfig.json', 'jsconfig.json', 'vite.config.ts', 'vite.config.js', 'vitest.config.ts', 'eslint.config.js', 'eslint.config.mjs', '.prettierrc', 'tailwind.config.js', 'tailwind.config.ts',
  'readme.md', 'license', 'license.md', 'changelog.md', 'contributing.md', 'agents.md', 'claude.md',
  'dockerfile', 'docker-compose.yml', 'compose.yaml', 'makefile', '.gitignore', '.gitattributes', '.gitmodules', '.editorconfig', '.env', '.env.local', '.env.example',
  'cargo.toml', 'go.mod', 'go.sum', 'requirements.txt', 'pyproject.toml', 'gemfile',
]
/** The theme maps some extensions only through the editor's language: these are those languages. */
const LANGUAGES = { ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact', html: 'html', css: 'css', md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml', sh: 'shellscript', py: 'python', go: 'go', rs: 'rust', rb: 'ruby', java: 'java', c: 'c', cpp: 'cpp', cs: 'csharp', php: 'php', lua: 'lua', sql: 'sql', xml: 'xml', txt: 'plaintext', bat: 'bat', ps1: 'powershell', dart: 'dart', swift: 'swift' }

const theme = dirname(createRequire(import.meta.url).resolve('material-icon-theme/package.json'))
const manifest = JSON.parse(readFileSync(join(theme, 'dist/material-icons.json'), 'utf8'))

const byExtension = {}
const byName = {}
const used = new Set([manifest.file])
for (const extension of EXTENSIONS) {
  const icon = manifest.fileExtensions[extension] ?? manifest.languageIds[LANGUAGES[extension]]
  if (icon) used.add((byExtension[extension] = icon))
}
for (const name of NAMES) {
  const icon = manifest.fileNames[name] ?? manifest.fileNames[name.replace(/\.md$/, '')]
  if (icon) used.add((byName[name] = icon))
}
// The icons the theme draws differently on a light background.
const light = {}
for (const [map, keys] of [[manifest.light.fileExtensions ?? {}, byExtension], [manifest.light.fileNames ?? {}, byName]]) {
  for (const key of Object.keys(keys)) if (map[key] && map[key] !== keys[key]) used.add((light[keys[key]] = map[key]))
}
// An id inside a picture (a gradient's) is the page's: each is given its icon's name, so two icons never share one.
const svg = id =>
  readFileSync(join(theme, 'dist', manifest.iconDefinitions[id].iconPath), 'utf8')
    .trim()
    .replace(/id="([^"]+)"/g, `id="file-icon-${id}-$1"`)
    .replace(/(url\(#|href="#)([^")]+)/g, `$1file-icon-${id}-$2`)
const icons = Object.fromEntries([...used].sort().map(id => [id, svg(id)]))

const out = fileURLToPath(new URL('../dashboard/components/file-icons.generated.ts', import.meta.url))
const json = value => JSON.stringify(value, null, 2)
writeFileSync(
  out,
  `// Written by scripts/file-icons.mjs from material-icon-theme ${JSON.parse(readFileSync(join(theme, 'package.json'), 'utf8')).version} (MIT). Do not edit.
export const DEFAULT_ICON = ${JSON.stringify(manifest.file)}
export const BY_NAME: Record<string, string> = ${json(byName)}
export const BY_EXTENSION: Record<string, string> = ${json(byExtension)}
/** An icon's own variant for a light background. */
export const LIGHT: Record<string, string> = ${json(light)}
export const ICONS: Record<string, string> = ${json(icons)}
`,
)
console.log(`${used.size} icons, ${Object.keys(byExtension).length} extensions, ${Object.keys(byName).length} names`)
