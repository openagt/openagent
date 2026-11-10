import { uiTestConfig } from '../../dashboard/dashboard/vitest.shared.ts'

// The UI tests of this package's pages, on the config every UI test directory shares, with the
// scrolling jsdom lacks (vitest.setup.ts).
export default uiTestConfig(import.meta.url, { setupFiles: ['./vitest.setup.ts'] })
