Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The browser
- The agent drives the browser by typing commands (`browser open`, `read`, `click`,
  `type`, …), which work with any coding agent and outside any scheduler. Picked over the
  scheduler starting a Chrome beside every run and plugging its browser tools into the
  agent, which works with one coding agent and only under the scheduler.
- A person watching a run sees the browser live in a Browser tab beside the run's chat: the
  browser's toolbar over the live picture, and can click and type in it. The chat keeps one
  line where the agent opened it, which opens the tab. Picked over the browser as a message
  in the chat where the agent opened it, and over a frame above the message box: a tab has
  room for the browser's console under the picture, which comes next.
- The picture is streamed from the computer the agent runs on, so the tab shows the same
  on that computer, on a phone and on another computer.
- A run that stops to ask a question keeps its browser, and its live screen, for the
  answer. Picked over closing the browser at every end of a run.
- The skill calls the command by its full name and a version range,
  `npx @openagt/skill-browser@0.1`: the name is ours on npm, so no other package can run
  under it, and nothing is installed in the project. Picked over `npx browser` with the
  package as a dependency of the project, which ran whatever package holds that name on
  npm where the install was missing, and which a project without Node could not have.
