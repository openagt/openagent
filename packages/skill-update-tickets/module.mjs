// update-tickets, a plugin kept per project (#2394) until it is one of the tickets' commands: where
// its Enabled row is on, the project's runs get its skill.
// The package is the skill's text and this module alone, with no build of its own: what the module
// says is what `@openagt/hooks`' `defineModule` types.
export default {
  name: 'update-tickets',
  plugin: { scope: 'project' },
  hooks: { 'run.skills': () => [{ name: 'update-tickets', dir: new URL('.', import.meta.url) }] },
}
