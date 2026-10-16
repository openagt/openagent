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
- A person watching a run sees the browser live in a Browser pane beside the run's chat: the
  browser's toolbar over the live picture, and can click and type in it. The chat keeps one
  line where the agent opened it, which opens the pane. Picked over the browser as a message
  in the chat where the agent opened it, and over a frame above the message box: a pane has
  room for the browser's console under the picture.
- The page's console is under the picture, behind a thin bar that is closed at first and
  says how many errors the page has; a click opens it. The agent reads the same lines
  with `browser console`. Picked over a console that is always open, which takes the room
  of the picture, most of all on a phone.
- The picture is streamed from the computer the agent runs on, so the pane shows the same
  on that computer, on a phone and on another computer.
- The person's pointer reaches the page as a mouse, not as bare clicks: where it moved,
  when it went down and when it came up. So the page hovers under it as it would under
  their own mouse, a drag drags (a slider, a selection), a second click in a place is said
  to be the second, and the pointer takes the shape the page gives it there. Picked over
  passing on clicks alone, where nothing ever hovered, nothing could be dragged and the
  pointer stayed an arrow over every link.
- The line the chat shows for the browser says the address short: without its scheme,
  without its query (a `?…` stands for it), and cut in the middle when it is still longer
  than a line. Picked over the address whole, which on a search page was three hundred
  characters and wrapped over five lines of the chat.
- The agent's own pointer is drawn on the picture where the agent last clicked or typed,
  and stays there until it acts again or the page goes elsewhere. Picked over drawing
  nothing, where a person looking a moment later cannot tell where the agent is working.
- The browser outlives the run that opened it: it stays ten minutes after the run ends,
  and longer while someone is still watching it, so the person can look at the page the
  agent left and click around in it themselves. A browser on someone's screen counts as
  used, whether or not they click. Picked over closing it at the end of the run, which
  took the page away two seconds after the agent finished, exactly when the person went
  to look at it.
- A page that asks something only a person can give — a sign-in, a "prove you are a
  human" check, a code from their phone — is handed to the person: the agent says what
  the page wants and asks, its browser stays open for the answer, and the person does it
  in the live view themselves. Picked over the agent trying to get through such a page
  itself, and over giving up on it without asking.
- The skill calls the command by its full name and a version range,
  `npx @openagt/skill-browser@0.1`: the name is ours on npm, so no other package can run
  under it, and nothing is installed in the project. Picked over `npx browser` with the
  package as a dependency of the project, which ran whatever package holds that name on
  npm where the install was missing, and which a project without Node could not have.
