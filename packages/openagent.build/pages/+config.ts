import vikeReact from 'vike-react/config'
import type { Config } from 'vike/types'

export default {
  extends: vikeReact,
  prerender: true,
  // OpenAgent's palette (tokens.css), dark; light for a visitor who asks for it (+Head.tsx).
  htmlAttributes: { class: 'dark' },
  title: 'OpenAgent',
  description:
    'Make the important decisions, let AI do the rest. OpenAgent turns AI agents into autonomous teammates that handle work end-to-end — while you stay in control of key decisions.',
  favicon: '/assets/logo.svg',
} satisfies Config
