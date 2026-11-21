import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'vite'
import { PREVIEWS, type Preview } from './previews.js'

// Builds the design gallery: one self-contained HTML file per card, each carrying the shipped
// stylesheet inline and rendering its component in both themes, into design/out/. `pnpm
// design:build` writes it; publishing it is somebody's own business, and nothing in this
// repository does it. Cards are static — no client JS — so hover/open states are
// shown as separate rendered instances rather than something to click.

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, 'out')
const cssBuildDir = join(here, '.css-build')

/** Runs the CSS-only Vite build and returns the compiled stylesheet. */
async function compileCss(): Promise<string> {
  await build({ configFile: join(here, 'vite.config.css.ts') })
  const files: string[] = []
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.css')) files.push(full)
    }
  }
  await walk(cssBuildDir)
  const css = (await Promise.all(files.map(f => readFile(f, 'utf8')))).join('\n')
  if (css.trim().length === 0) throw new Error('gallery CSS build produced nothing')
  return css
}

/** Gallery chrome. Deliberately its own namespace so it cannot be mistaken for app styling. */
const CHROME = `
  .ds-page { padding: 24px; font-family: ui-sans-serif, system-ui, sans-serif; }
  .ds-head { margin-bottom: 16px; }
  .ds-title { font-size: 15px; font-weight: 600; }
  .ds-sub { font-size: 12px; opacity: 0.65; margin-top: 2px; }
  .ds-flag { display: inline-block; margin-top: 8px; padding: 2px 8px; border-radius: 999px;
    font-size: 11px; background: rgba(245,158,11,0.16); color: #b45309; }
  .ds-themes { display: grid; gap: 16px; grid-template-columns: 1fr; }
  @media (min-width: 900px) { .ds-themes { grid-template-columns: 1fr 1fr; } }
  .ds-pane { border-radius: 12px; overflow: hidden; border: 1px solid rgba(128,128,128,0.28); }
  .ds-pane-label { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase;
    padding: 6px 12px; opacity: 0.6; border-bottom: 1px solid rgba(128,128,128,0.22); }
  .ds-pane-body { padding: 20px; }
`

function page(preview: Preview, css: string): string {
  const body = renderToStaticMarkup(preview.node as never)
  const pane = (label: string, dark: boolean) => `
      <div class="ds-pane${dark ? ' dark' : ''}">
        <div class="ds-pane-body bg-background text-foreground" style="padding:0">
          <div class="ds-pane-label">${label}</div>
          <div class="ds-pane-body">${body}</div>
        </div>
      </div>`

  return `<!-- @dsCard group="${preview.group}" -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${preview.name}</title>
<style>${css}</style>
<style>${CHROME}</style>
</head>
<body>
<div class="ds-page">
  <div class="ds-head">
    <div class="ds-title">${preview.name}</div>
    <div class="ds-sub">${preview.subtitle}</div>
    ${preview.replica ? '<div class="ds-flag">Replica: portalled at runtime, markup hand-copied from source</div>' : ''}
  </div>
  <div class="ds-themes">
${pane('Light', false)}
${pane('Dark', true)}
  </div>
</div>
</body>
</html>
`
}

const css = await compileCss()
await rm(outDir, { recursive: true, force: true })

for (const preview of PREVIEWS) {
  const target = join(outDir, preview.path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, page(preview, css), 'utf8')
}

await rm(cssBuildDir, { recursive: true, force: true })
console.log(`design gallery: ${PREVIEWS.length} cards -> ${outDir} (${Math.round(css.length / 1024)} KB css inlined)`)
