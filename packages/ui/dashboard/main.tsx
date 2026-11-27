import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import './tailwind.css'
import './lib/fonts.js'
import { AppFrame } from './components/AppFrame.js'
import { App } from './App.js'
import { onPageSwap } from './components/ViewToggle.js'
import { TeamSignInPage } from './components/TeamSignIn.js'
import { readTeamState, setDrawnSignedIn, TeamContext, useTeamState, type TeamState } from './lib/team.js'
import type { ReactNode } from 'react'

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
// Leaving the page animates only for the switch to the website's landing page (ViewToggle).
addEventListener('pageswap', onPageSwap)

const root = document.getElementById('root')
if (!root) throw new Error('no #root in index.html')

// Team mode first (lib/team.ts): on a shared machine a browser not signed in gets the sign-in and
// nothing of the dashboard. One small read of this computer's own server, before the first frame.
void readTeamState().then(team => {
  const signedOut = team.on && team.person === undefined
  setDrawnSignedIn(!signedOut)
  // Rendered at once once that is read: the first frame has the sidebar, so the switch from the
  // website's landing page has the logo and toggle to keep still.
  const reactRoot = createRoot(root)
  flushSync(() =>
    reactRoot.render(
      team.on && signedOut ? (
        <TeamSignInPage team={team} />
      ) : (
        <Team first={team}>
          <AppFrame>
            <App />
          </AppFrame>
        </Team>
      ),
    ),
  )
})

/** The team's state for the dashboard's parts that show it: the person's menu, Settings › Team. */
function Team({ first, children }: { first: TeamState; children: ReactNode }) {
  const value = useTeamState(first)
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>
}
