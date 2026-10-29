Topics: install, skills
Issue: [#2239](https://github.com/openagt/openagent/issues/2239)

# Personal installation instead of a per-project one

## TLDR

Let one person use OpenAgent on a project without adding it to the project's repository. The requester wants to use some of OA's skills on Vike (for example, account rotation) without pushing OA onto the project's other contributors.

OA is already mostly personal: `npx @openagt/start` pushes nothing on its own. The records (tickets, queue, logs) stay on the machine unless sharing is turned on, the default skills are linked into each run and hidden from git, and other devices read the laptop's runs live. The one gap: a skill ticked in the dashboard is committed into the repository, and reaches agents only once pushed.

Proposed rule (in the issue, awaiting the requester's thoughts): everything stays on your machine until you share it.

- A ticked skill is "Just me" by default, linked into runs like the default ones; "Add to the project" commits it for everyone.
- One Sharing page per project lists it all: records on this computer or on origin, and each skill Just me or Everyone.
- Later: records kept in a private repository of one's own (e.g. `brillout/vike-openagent`), so the history stays while the laptop is off.

## Why it matters

People who don't own a project, or who don't want to impose OA on everyone else working on it, can't use OA there. A personal installation lets one contributor adopt OA on a shared project without the others having to agree.
