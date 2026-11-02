import { createRoot } from 'react-dom/client'
import './tailwind.css'
import { AppFrame } from './components/AppFrame.js'
import { App } from './App.js'

// The dashboard's entry point. Everything here is the browser's: the daemon serves a static
// `index.html` plus fingerprinted assets and answers RPCs, and the app routes itself client-side
// off the URL (lib/use-route.ts).
//
// This used to be Vike, whose net contribution was emitting that one `index.html` — the rest of it
// (`+config`, a catch-all `+route` whose return value was never read, an `+onBeforePrerenderStart`
// naming the single URL to prerender) was scaffolding for a prerender that had one page in it.
// Plain Vite emits the same file from the `index.html` beside this one.
//
// No StrictMode: the live feed, the polls and the theme listener all mount real subscriptions, and
// double-invoking them buys nothing here that the tests do not already cover.
const root = document.getElementById('root')
if (!root) throw new Error('no #root in index.html')

createRoot(root).render(
  <AppFrame>
    <App />
  </AppFrame>,
)
