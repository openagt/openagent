// ask, a plugin kept per project (#2394), on until a person switches it off: how an agent asks the
// person to decide instead of guessing. Its skill teaches the `await-choices` block, so a coding
// agent with a tool of its own to ask with, as Claude Code's, is given none: it would ask that way instead.
// The package is the skill's text and this module alone, with no build of its own: what the module
// says is what `@openagt/hooks`' `defineModule` types.
export default {
  name: 'ask',
  plugin: { scope: 'project' },
  hooks: { 'run.skills': ({ agent }) => (agent?.ownQuestionTool ? [] : [{ name: 'ask', dir: new URL('.', import.meta.url) }]) },
}
