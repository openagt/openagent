Topics: remote-access, servers, security
Issue: [#2140](https://github.com/openagt/openagent/issues/2140)

# People on a shared computer: each person's own runs, logins and laptops

## TLDR

A computer several people use (a server, or a computer at home several people start agents on from their own laptops) gives each person their own runs, logins and laptops' lines. A person is their GitHub account; a run uses the GitHub and Claude logins of whoever started it; each person keeps their own copy of a project there. Others' runs reach a person through GitHub (`agent-data`), read only. Only the computer's owner invites. Whoever connects a computer to a shared one picks who may use it: only them, or everyone there. A computer only one person uses is unchanged: OpenAgent asks who you are only at the first Invite.

## Why it matters

Today a server has one OpenAgent and no idea of people. Whoever is invited can reach every laptop connected to it and acts with the server's logins (a GitHub login copied from the laptop pushes as the laptop's owner), and the line's address on the server (`remote-access/src/line-in.ts`) takes no key, so any agent there can call it. Until this is built, a server a laptop is connected to is not shared.

## The catch

Agents run as the same user as OpenAgent, so a limit enforced only in the page is no limit for someone who can start a run. Each person's agents must run as a system user of their own.

## Picks made since

- **Each person has their own OpenAgent**, running as a system user of their own (the owner stays the computer's own user, `openagent` on a server; each invited person gets `oa-<account>`). Picked over one OpenAgent that starts each run as whoever pressed Start: the system keeps people apart, not a check in every page.
- **The firewall keeps agents apart**: an agent reaches only its own person's OpenAgent and lines. Picked over a check in OpenAgent's code. `/proc` shows each user only their own processes (a prompt is on a run's command line).
- An invited person sees the shared computer from their own computer as the owner does: their own logins there, devices and line. Their logins reach it through the door with their device's key; the owner's still go over SSH.
- Removing a person removes everything of theirs there: user, logins, projects, unpushed work.
- **A computer is personal (only its person) or a server (shared).** Only a server offers "Everyone". A computer is shared by setting it up as a server from a laptop over SSH, as the VPS is. Linux first; a Mac later.
- A person's logins reach a shared computer copied from their server by default; they can make one of its own there instead, and a copy never replaces it.
- When people can no longer reach a shared computer, its owner is asked whether their users go or stay switched off.

## Build order (one pull request each)

1. **Persons**: a device belongs to a person (a GitHub account); the owner is named at the first Invite; Invite asks "Who is it for?" ("Me", or "Someone else: their GitHub account"); devices listed by person; the door passes who a call is from in its own header, stripping any a request brings. Changes nothing yet about what a person can do; the Invite dialog says so.
2. **A user per person**: Invite for someone else makes their user on the server, with their own OpenAgent on a port of its own, made by a small root helper `openagent` may run. Their GitHub login must be their account; Claude via `claude setup-token`. The firewall closes the gap of an agent calling `127.0.0.1:4200` with no key. Since a person's page is their own OpenAgent, this brings most of PRs 3 and 4's "own runs, projects and machines".
3. **Who sees and does what**: whatever PR 2 leaves of a person's page showing and acting on only their own runs.
4. **Everyone on a shared computer**: a computer set up as a server and kept on a line to the VPS (no public door) gets a [Server] badge and "Who can start runs on it": Nobody, Only me, or Everyone on the server. A run someone else starts there runs as their own user with their logins, copied once with a shown-once notice. Also does PR 5's home computer in server mode.
5. **A home computer from a laptop, through a server**: laptop → server → that computer.

The issue holds the full plans for PRs 1, 2 and 4 by package (`remote-access`, `servers`, `openagent`) and links the conversation behind the picks.
