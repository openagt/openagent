Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The package
- Everything that sets a server up over SSH is here, in a package of its own. At the end it
  saves the server as a machine like any other, with the link the server's door gives.
  Picked over SSH inside OpenAgent, which then knew of servers.

## Logging in
- OpenAgent logs in with this computer's own SSH keys. Picked over a password field, which
  can come later.
- The first time this computer meets a server, the server's key is taken as it is, shown,
  and remembered. A server that later shows another key is refused. Picked over showing the
  key and waiting for a click, and over taking only servers this computer already met.
- SSH is only for the install and an update. Afterwards this computer reaches the server
  through the server's door, with a key of its own.

## On the server
- Everything runs as a user of its own, `openagent`. `root`, or a user that becomes root,
  is only for the install and an update.
- The install brings git, Node, Chrome and the coding agent.

## An update
- When the server falls behind this computer, its row says so and has an "Update" button.
  Picked over a server that updates by itself, which can come later.
