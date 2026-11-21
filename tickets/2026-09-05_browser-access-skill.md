Priority: 2
Topics: skills, browser
Issue: [#1758](https://github.com/openagt/openagent/issues/1758)

# New skill: browser access (with limited permissions)

## TLDR

A skill giving agents a browser for tasks like browsing Twitter or Reddit, ideally a separate browser session with its own authenticated sessions. Ideas:
- Let the user limit write access, e.g. by blocking POST requests.
- A dashboard listing which websites are authenticated (auth vs tracking cookies may be hard to tell apart; maybe enabling/disabling cookies/localStorage per site is the switch for auth).

Low priority (labelled `low-prio`): focus on the core flows first.

## Why it matters

Lets agents act on the web on the user's behalf while keeping their logins and write access under control.
