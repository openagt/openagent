import { uiTestConfig } from './vitest.shared.ts'

// Unit tests for the dashboard's hooks and components, on the config every UI test directory shares.
export default uiTestConfig(import.meta.url)
