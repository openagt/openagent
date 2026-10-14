import { File, FileCode, FileCog, FileImage, FileJson, FileTerminal, FileText, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils.js'

// A file's icon by its kind, coloured as Claude Code on the web colours them: pictures pink,
// markup orange, documents green, code by its language, settings amber. A kind not listed is a
// plain grey file. The dashboard's own, so every pane that lists files draws them the same.

interface Kind {
  icon: LucideIcon
  className: string
}

const IMAGE: Kind = { icon: FileImage, className: 'text-pink-500' }
const MARKUP: Kind = { icon: FileCode, className: 'text-orange-500' }
const DOCUMENT: Kind = { icon: FileText, className: 'text-emerald-500' }
const SETTINGS: Kind = { icon: FileJson, className: 'text-amber-500' }
const SHELL: Kind = { icon: FileTerminal, className: 'text-lime-600' }
const DOTFILE: Kind = { icon: FileCog, className: 'text-muted-foreground' }
const PLAIN: Kind = { icon: File, className: 'text-muted-foreground' }
const code = (className: string): Kind => ({ icon: FileCode, className })

const BY_EXTENSION: Record<string, Kind> = {
  png: IMAGE, jpg: IMAGE, jpeg: IMAGE, gif: IMAGE, webp: IMAGE, svg: IMAGE, ico: IMAGE, avif: IMAGE, bmp: IMAGE,
  html: MARKUP, htm: MARKUP, xml: MARKUP, vue: MARKUP, svelte: MARKUP,
  md: DOCUMENT, mdx: DOCUMENT, txt: DOCUMENT, rst: DOCUMENT, pdf: DOCUMENT,
  json: SETTINGS, jsonc: SETTINGS, yml: SETTINGS, yaml: SETTINGS, toml: SETTINGS, ini: SETTINGS, lock: SETTINGS, env: SETTINGS,
  sh: SHELL, bash: SHELL, zsh: SHELL, fish: SHELL,
  ts: code('text-blue-500'), tsx: code('text-blue-500'), mts: code('text-blue-500'), cts: code('text-blue-500'),
  js: code('text-yellow-500'), jsx: code('text-yellow-500'), mjs: code('text-yellow-500'), cjs: code('text-yellow-500'),
  css: code('text-sky-500'), scss: code('text-pink-400'), less: code('text-sky-600'),
  py: code('text-sky-600'), go: code('text-cyan-500'), rs: code('text-orange-600'), rb: code('text-red-500'),
  java: code('text-red-600'), kt: code('text-violet-500'), swift: code('text-orange-500'), c: code('text-blue-600'),
  h: code('text-blue-600'), cpp: code('text-blue-600'), cs: code('text-violet-600'), php: code('text-indigo-400'),
  sql: code('text-amber-600'),
}

function kindOf(path: string): Kind {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  if (dot === -1) return PLAIN
  const kind = BY_EXTENSION[name.slice(dot + 1)]
  if (kind) return kind
  return dot === 0 ? DOTFILE : PLAIN
}

/** A file's icon, coloured by its kind. */
export function FileIcon({ path, className }: { path: string; className?: string }) {
  const { icon: Icon, className: tone } = kindOf(path)
  return <Icon aria-hidden className={cn('size-4 shrink-0', tone, className)} />
}
