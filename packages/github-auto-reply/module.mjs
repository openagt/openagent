// github-auto-reply, a plugin kept per project (#2394): an agent whose pull request got a
// maintainer's comment, a red check or a conflict answers it. Where its Enabled row is on, the
// project's runs get its skill.
// The package is the skill's text and this module alone, with no build of its own: what the module
// says is what `@openagt/hooks`' `defineModule` types.
export default {
  name: 'github-auto-reply',
  plugin: { scope: 'project' },
  hooks: { 'run.skills': () => [{ name: 'reply', dir: new URL('.', import.meta.url) }] },
}
