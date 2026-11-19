Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The hooks
- One package, `hooks`, declares every hook, the run options and the settings catalog, and
  holds the loader that calls the hooks. Picked over a `core` package beside a contract
  package per seam.
- `hooks` declares all of them: a hook a module needs is added here. Picked over modules
  adding hooks of their own through declaration merging.
- A hook's handlers go by a number, `order`, the way universal-middleware orders middleware
  around its handler. Picked over a fixed list of lifecycle stages.
- The run is one pipeline of steps, `run.step`: below 0 they prepare the run, at 0 are the
  agent's turns, above 0 they finish it. Picked over separate "before run", "context" and
  "after run" hooks.
- The accounts a run works as come first, at `RunOrder.ACCOUNTS`, in the run's environment
  (`RunContext.env`): its agent's, and the run's own git, from its project's clone and its
  checkout's fetch on (#2394). Picked over the accounts after the checkout, where the run's
  first fetch went as the person's own login, and over each step of the run asking a module
  for git access of its own.
- A hook's name starts with its area: `run.`, `store.`, `account.`, `app.`, `ui.`.
- The UI has four hooks, each taking a place: `ui.view` (a component), `ui.action` (something
  to do), `ui.option` (something to pick in a shared menu) and `ui.render` (how a kind of
  content looks). `hooks` types each place's props, so a new place needs no new hook. Picked
  over a hook per place.
- A hook is code the loader calls, or an answer that must be fresh (what needs the person). A
  fact a module owns and other modules read is a setting, declared in the catalog here and
  saved through the store. Picked over a hook per fact (`people`, `schedule`, `linkName`).
- Each module owns a slice of a run's options, declared here: its control under the message
  box writes it, its step reads it, the run's record keeps it. Picked over environment
  variables and the `${BASE:+--base "$BASE"}` lines of a project's start line.
- "What needs setting up" and "waiting on you" are one hook, `app.attention`. Picked over a
  hook for each.

## Modules
- A module is core, always on, or a plugin with an Enabled row, and that row is the source of
  truth for whether the plugin is on. Picked over each plugin keeping a switch of its own.
- Modules are installed globally, with their distribution. Picked over modules from a
  project's own dependencies.
- A module's background work is its own, started from `app.lifecycle`. Picked over one clock
  in the core that every module's work hangs on.
- A module's UI part is an entry of its own, apart from its Node part, so a run's process
  never loads React.

## The store
- A store backend wraps the one below it in the chain: it keeps the scopes it owns and passes
  the rest on. Picked over a store that replaces another, since a shared project's data lives
  on its branch while every other project's stays in `~/.openagent`.
- Two kinds of write: a live append, kept on this computer (a run's diary while it works), and
  a save, which a git store commits and pushes.
- Three scopes: the person's, which follows them to every computer; this computer's; a
  project's.

## Presets
- A preset is a saved set of run options, and can go without enabled plugins
  (`plugins.without`). A setting that needs to differ per preset becomes a run option of its
  module, with the setting as its default. Picked over presets that override any setting.
