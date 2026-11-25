import { createContext } from 'react'

// Where the names in a text in markdown lead, given by the page that shows it and read by the
// module that draws markdown (`ui.render`): the files of the text's project, and its git host's
// issues and pull requests.

/**
 * What a file named in the text opens, by the name as written (`.github/workflows/deploy.yml`):
 * given where the text is a file of the project, as the Files pane's Markdown is; none for a name
 * that is no file there, or where nothing opens files.
 */
export const FileLinks = createContext<((path: string) => (() => void) | undefined) | undefined>(undefined)

/**
 * Where `#12` in an answer leads: the page of the issue or the pull request of that number at the
 * project's git host. Given by the agent's page; without it, or with no page for a number, `#12` is text.
 */
export const IssueLinks = createContext<((number: number) => string | undefined) | undefined>(undefined)
