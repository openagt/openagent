// Every font of Settings › Appearance ships with the dashboard and is served from its own origin.
// A family's files are fetched only once the page uses it; the page's own font is preloaded
// (vite.config.ts). Each is the variable font (`fontFace`, src/appearance.ts), except IBM Plex
// Mono, which has none and comes at its four weights.
import '@fontsource-variable/ibm-plex-sans'
import '@fontsource-variable/figtree'
import '@fontsource-variable/inter'
import '@fontsource-variable/geist'
import '@fontsource-variable/plus-jakarta-sans'
import '@fontsource-variable/manrope'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/geist-mono'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/ibm-plex-mono/700.css'
import '@fontsource-variable/fira-code'
import '@fontsource-variable/source-code-pro'
import '@fontsource-variable/source-serif-4/opsz.css'
import '@fontsource-variable/newsreader'
import '@fontsource-variable/literata'
