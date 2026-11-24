# @openagt/profiles

Agent profiles for OpenAgent: a profile is a name and a saved set of run options, made once and used
in any project, or in none. A run on a profile gets its options under the ones picked for that run
alone. `Default` is the one a run is on when none is picked; it is never removed or renamed.

What it brings:

- **The Profiles page** (`/profiles`), last of the modules' rows in the sidebar: one row per profile,
  each edited in a dialog. The editor keeps the name and draws every module's control of the message
  box on the profile's options (`composer.control`, `in: 'profile'`), so a profile sets whatever a
  module lets a run pick: the accounts, the skills, the plugins its runs go without.
- **The Profile line** of the gear's menu under the message box, its first: in the launcher it picks
  the profile of every next run started on this computer (the `profiles.picked` setting, which
  agent-driver reads where a run's options name none); in a session it says the one the run is on.
- **The Overview's line** on the profiles: how many, by name, a press from their page.

The profiles are kept with the person (the `profiles.saved` setting), so each of their computers has
the same ones. It is this computer's package (`for: 'computer'`), with a server part for the reads and
saves (`./server`) and no Node part of its own.
