Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## The package
- Everything that opens OpenAgent to a network is here, in a package of its own. OpenAgent
  itself listens on its own computer only. Picked over a flag and a shared key inside
  OpenAgent, where every new way in was a change to its core.
- Everything that sets a server up over SSH is here too. At the end it saves the server as a
  machine like any other, with the link the server's door gives. Picked over SSH inside
  OpenAgent, which then knew of servers; and over a package of its own beside the door's, where
  one Settings entry for a person's devices was drawn from two packages.

## Getting in
- A device gets in by scanning a QR code once, and stays in. No password and no account.
  Picked over a password, one more thing to keep and to leak.
- A device that is already in shows the code for the next one.
- Each device has its own key, and is removed alone. Picked over one key shared by every
  device, where taking one phone out meant a new key for all.
- A device that is in sees and does what the computer's own browser does; on a server, a
  device of an invited person does so on that person's own OpenAgent there. Picked over a
  device that only watches.
- Another computer's OpenAgent gets in as a device does: with the same code, typed with where
  it is where a phone scans it, and a key of its own that is removed alone. Picked over a
  second kind of key that opens less: a key that starts an agent already runs anything on
  the computer.
- A computer somewhere else gets in by typing where and a code that another device of the
  person's shows, through their server. Picked over typing where alone and pressing Allow on
  a device of the person's, which needs that device at hand, and lets anyone who knows the
  address knock.
- A code is eight letters and digits, with none that reads as another, and works once, for ten
  minutes. An address that tries five wrong codes in a minute waits a minute, and the code goes
  on working. Picked over six digits that stop working after a few wrong tries, which a
  stranger could do on purpose.

- A computer is listed once among the devices, whatever it holds there, and is taken out
  whole. Picked over a row for its OpenAgent and one for its line, where one laptop showed
  twice.
- A computer that gets in again takes the place of what it had there. Picked over a new
  entry each time, which left the old ones to be removed by hand.

## Persons
- A person on a computer is a name, typed at the invite, whatever git host they use; the owner
  names themselves the same way the first time. Picked over their GitHub account, which left out
  a person on another git host.
- Only the computer's owner invites. Picked over anyone who is in inviting; letting the owner
  allow others to invite can come later.
- A computer only one person uses is unchanged: OpenAgent asks who the owner is only the first
  time a device is let in for someone else. Picked over asking every computer who its person is.
- Removing a person removes everything of theirs on a server: their user, their logins, their
  copies of projects, and work they did not push. Picked over taking only their access away.

## On this Wi-Fi
- The link on the Wi-Fi is plain HTTP, behind a switch that is off until a person turns it
  on, and turning it on says first what plain HTTP means. A lock of its own comes later.
  Picked over a private network app on the phone, one more thing to install and sign in to.
- The code holds the computer's name on the network when it has one, and its number
  otherwise, with a link under the code to use the number. Picked over the number alone,
  which the network changes, and then every device has to scan again.
- Another computer on the same Wi-Fi is found there, and connected with one press and an
  Allow on it, both screens showing the same number: a door is said on the Wi-Fi while its
  switch is on, and takes asks from the Wi-Fi with no code. A code is typed only for a
  computer somewhere else. Picked over a code typed at home too.
- An ask waits two minutes for Allow or Deny, then both screens say so. Picked over one
  minute, short for a computer in another room, and ten, a popup left long after it was
  forgotten.
- A computer that asks again takes the place of its own ask, and after Deny it waits a minute
  to ask again; at most three asks wait at once. Picked over no limit, where anyone on the
  Wi-Fi fills the screen with asks, and over a day's wait after Deny.
- An ask shows on the computer's own screen and on its owner's devices, never on an invited
  person's. Picked over the computer's own screen alone, and over every device that is in.

## On a server
- On a server the door speaks HTTPS, with a certificate for the server's number that it
  asks Let's Encrypt for and renews itself. Picked over a name the person buys and points
  at the server, one more thing to set up; a field for a name can come later.

## Reaching a computer from its server
- A computer keeps one connection open to its server, and the server asks the computer through
  it. So a phone on the server's page starts a run on the computer, while nothing on a network
  reaches the computer. Picked over opening the computer itself to the internet, and over a
  private network app on every device, one more thing to install and sign in to.
- Through that connection the server does everything a machine is asked, until the person turns
  one switch off; then it only reads. Picked over a server that only watches until it is let
  do more.
- A line the server no longer lets in reads as off on the computer, which says why. Picked
  over a switch that goes on saying on over a line that carries nothing.
- Another computer that is in at the server reaches a computer on a line there through the
  server, so a laptop on any internet starts a run on a computer at home. Picked over opening
  the computer at home to the internet first, which needs a port on its router and fails where
  the internet provider shares one address between many homes.
- Whoever connects a computer to a server several people use picks who there may start runs on
  it: nobody, only them, or everyone. A run of another person's there runs as that person's own
  user on the computer, with their own logins, never its owner's.
- When people can no longer reach a computer shared with everyone, its owner is asked whether
  their users go, or stay switched off. Picked over always removing them, and over always
  keeping them.

## Logging in to a server
- OpenAgent logs in with this computer's own SSH keys. Picked over a password field, which
  can come later.
- The first time this computer meets a server, the server's key is taken as it is, shown,
  and remembered. A server that later shows another key is refused. Picked over showing the
  key and waiting for a click, and over taking only servers this computer already met.
- SSH is only for the install, an update, a device's code and the list of its devices. For
  everything else this computer reaches the server through the server's door, with a key of
  its own.

## On the server
- Everything runs as a user of its own, `openagent`. `root`, or a user that becomes root,
  is only for the install and an update.
- The install brings git, gh, Node, Chrome and the coding agent.
- The server's git gets this computer's name and email, when it has none: a commit made on
  the server reads like one made on this computer. Picked over the name of the GitHub login
  the server holds, which a server with no login lacks; and over a name of the server's
  own, which ties its commits to nobody on GitHub.
- A server's own Settings offers no server to connect: servers are connected from the
  person's own computer. Picked over a server that connects other servers.
- Each person invited to a server has a user of their own there, with an OpenAgent of their
  own, and that user holds their GitHub and Claude logins: a run uses the logins of the person
  who started it. Picked over one OpenAgent that starts each run as the user of whoever started
  it, where a check in every page would keep people apart instead of the system.
- The owner stays the server's own user, `openagent`; only an invited person gets a new one.
  Picked over moving the owner to a user of their own too.
- An agent on the server reaches only its own person's OpenAgent and lines: the server's
  firewall says so. Picked over a check in OpenAgent's code, which every new port would need
  again.
- Each person sees only their own programs running on the server: a run's prompt is on its
  command line.
- Removing a person removes everything of theirs on the server: their user, their logins, their
  copies of projects, and work they did not push. Picked over taking only their access away,
  which left their files on the server.

## A computer shared from home
- A computer at home or in an office is shared by setting it up as a server, as one on the
  internet is: from a laptop over SSH; it then starts on its own, and Update keeps it current.
  It has no door of its own: it is reached through its line to a server. Picked over a command
  that installs OpenAgent pasted once on it, the system's password window, and sandboxes in
  place of users.
- A computer with no SSH yet gets one line to paste on it once, which turns SSH on, adds the
  laptop's key and lets its user install without a password. Picked over the same three steps
  told in words, and over a line that installs OpenAgent on the computer itself.
- A computer is personal or a server: only a server offers "Everyone", and a personal computer
  keeps its one switch. Linux first; a Mac later. Picked over three choices on every computer,
  with "Everyone" greyed where it cannot work.

## The server's logins
- A person's logins reach another person's computer copied from their own server, before their
  first run there; they can make a login of its own there instead, and a copy never replaces it.
  The Claude login copied is the one made for the server, never a laptop's own. Picked over a
  copy alone, and over a login made on each computer alone.

## A device gets in
- A person, a phone or a browser gets into a server with a code this computer asks the
  server for, over SSH: one press on the server's row, "Invite", shows the code as a QR code
  and a link to send. Picked over letting this computer's browser in by itself at the end of
  the install and adding the phone from the server's own Settings, one more step for the
  phone.

## In Settings
- Everything of a person's is in one Settings entry, Devices: this computer and how their
  devices reach it, then their phones, their other computers and their servers, each listed
  once, with a page of its own. Picked over a Devices entry for what gets into this computer
  and a Machines entry for where its runs go, two ends of one link under two names.
- A computer is one row whichever way runs go: runs go there, it starts runs here, or both.
  Picked over a row for each way.
- A computer's name is its own: renamed from any page, it is kept on that computer, and every
  page, on every device, shows the name it says. Picked over each page keeping a name of its
  own for it, which showed one computer under another name on each device.
- Each server this computer is in at has its switch for reaching this computer from
  anywhere, whoever set the server up: the person's other computers too. Picked over the
  switch on the computer that installed the server alone.
- A server is set up from the person's own computer, with nothing left to do on the
  server's own page: its page here lists the devices that are in on it, each with when it was
  last seen and a way to take it out. The server's own Settings lists them too. Picked
  over the server's page alone, a second place to go to for every set-up; and over this
  computer alone, where a lost phone stays in while that computer is away.

- An invited person sees the server on their own computer as the owner does: their own devices
  there, their own line. What only the owner does is not there: the install, an update, an
  invite.

## An install or an update
- Each step shows its own state while it runs: waiting, running, done or failed. Picked over
  one wait for the whole install.
- When the server falls behind this computer, its row says so and has an "Update" button.
  Picked over a server that updates by itself, which can come later.
