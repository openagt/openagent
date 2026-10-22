import { configure } from '@testing-library/react'

// Testing Library's async queries (`findBy*`, `waitFor`) give up after 1s by default, which is
// not enough on a loaded machine (#886). Several components here assert through a Base UI menu,
// which portals and then positions itself, so the element under assertion arrives a frame or two
// after the click. That takes ~40ms idle, and CI ran 39 suites at once and blew past the second:
// `PreviewBar.test.tsx:43` failed with "Unable to find an element with the text: api" at 1079ms,
// turning main red for a component that works.
//
// The timeout is a ceiling, not a delay: a passing query still returns as soon as it matches, so
// this costs nothing when things are healthy and only buys patience when the machine is starved.
configure({ asyncUtilTimeout: 5000 })
