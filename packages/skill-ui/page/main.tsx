import { Component, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { SkillHostContext, type ModuleCard, type ModuleCommandResult, type ModuleProject, type SkillHost, type SkillUi } from '@openagt/skill-ui/module'
import type { PageFolder, PageModule } from '../src/server.js'
import './page.css'

// The page of one folder's skills: each skill's cards, on nothing but what `@openagt/skill-ui/module`
// offers. A skill built on more of OpenAgent's dashboard than that does not load here, and the page
// says so rather than leaving it out.

async function runOnPage(body: Record<string, unknown>): Promise<ModuleCommandResult> {
  const response = await fetch('/_skill/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return (await response.json()) as ModuleCommandResult
}

function hostOf(pkg: string): SkillHost {
  return {
    package: pkg,
    runCommand: (_projectId, args, command) => runOnPage({ package: pkg, args, command }),
    runComputerCommand: (args, command, input) => runOnPage({ package: pkg, args, command, input, computer: true }),
  }
}

/** A skill's browser part, loaded, with its stylesheet linked; undefined for one that does not load here. */
async function load(module: PageModule): Promise<SkillUi | undefined> {
  const loaded = (await import(/* @vite-ignore */ module.url).catch((error: unknown) => {
    console.warn(`${module.package} did not load:`, error)
    return undefined
  })) as { default?: SkillUi } | undefined
  const definition = loaded?.default
  if (!definition || typeof definition !== 'object') return undefined
  if (definition.stylesheet) {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = new URL(definition.stylesheet, new URL(module.url, window.location.href)).href
    document.head.appendChild(link)
  }
  return definition
}

/** A card that throws shows this instead of taking the page down. */
class CardBoundary extends Component<{ label: string; children: ReactNode }, { error: string | null }> {
  override state = { error: null as string | null }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  override render() {
    if (this.state.error === null) return this.props.children
    return (
      <div role="alert" className="p-4 text-sm text-danger">
        The {this.props.label} card failed: {this.state.error}
      </div>
    )
  }
}

function SkillCard({ pkg, card, project }: { pkg: string; card: ModuleCard; project: ModuleProject }) {
  const host = useMemo(() => hostOf(pkg), [pkg])
  const Card: ComponentType<{ projects: ModuleProject[] }> = card.Card
  return (
    <SkillHostContext.Provider value={host}>
      <CardBoundary label={card.label}>
        <Card projects={[project]} />
      </CardBoundary>
    </SkillHostContext.Provider>
  )
}

interface Loaded {
  project: ModuleProject
  cards: { pkg: string; card: ModuleCard }[]
  /** The skills with a browser part that is not built for this page. */
  notHere: string[]
}

function Page() {
  const [loaded, setLoaded] = useState<Loaded | string>()
  useEffect(() => {
    void (async () => {
      const folder = (await (await fetch('/_skill/folder')).json()) as PageFolder
      const definitions = await Promise.all(folder.modules.map(async module => ({ pkg: module.package, definition: await load(module) })))
      const cards = definitions.flatMap(({ pkg, definition }) => (definition?.cards ?? []).map(card => ({ pkg, card })))
      cards.sort((a, b) => (a.card.order ?? 50) - (b.card.order ?? 50) || a.pkg.localeCompare(b.pkg))
      setLoaded({ project: folder.project, cards, notHere: definitions.filter(({ definition }) => !definition).map(({ pkg }) => pkg) })
    })().catch((error: unknown) => setLoaded(error instanceof Error ? error.message : String(error)))
  }, [])
  if (loaded === undefined) return null
  if (typeof loaded === 'string') return <p className="p-6 text-sm text-danger">{loaded}</p>
  document.title = `${loaded.project.name} · Skills`
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <h1 className="text-lg font-semibold">{loaded.project.name}</h1>
      {loaded.cards.length === 0 && <p className="text-sm text-muted-foreground">No skill of this folder has a card.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        {loaded.cards.map(({ pkg, card }) => (
          <SkillCard key={`${pkg}:${card.id}`} pkg={pkg} card={card} project={loaded.project} />
        ))}
      </div>
      {loaded.notHere.length > 0 && <p className="text-xs text-muted-foreground">Shown only in OpenAgent's dashboard: {loaded.notHere.join(', ')}</p>}
    </main>
  )
}

// The theme follows the computer's: a skill's own page has no setting of its own.
const dark = window.matchMedia('(prefers-color-scheme: dark)')
const followTheme = (): void => void document.documentElement.classList.toggle('dark', dark.matches)
followTheme()
dark.addEventListener('change', followTheme)

createRoot(document.getElementById('root')!).render(<Page />)
