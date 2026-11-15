import { configure } from '@testing-library/react'

// What every module's tests run in, set once for all of them (`moduleTests` in `./vite.ts`).

// Testing Library's async queries (`findBy*`, `waitFor`) give up after 1s by default, which is
// not enough on a loaded machine (#886). Several components assert through a Base UI menu, which
// portals and then positions itself, so the element under assertion arrives a frame or two after
// the click. That takes ~40ms idle, and CI ran 39 suites at once and blew past the second.
//
// The timeout is a ceiling, not a delay: a passing query still returns as soon as it matches, so
// this costs nothing when things are healthy and only buys patience when the machine is starved.
configure({ asyncUtilTimeout: 5000 })

// jsdom lays nothing out, so it has no `scrollIntoView` or `scrollTo`: a module that keeps the
// shown item in view (the Files pane's tabs, the Changes list's diffs) calls them.
Element.prototype.scrollIntoView ??= () => {}
Element.prototype.scrollTo ??= () => {}
