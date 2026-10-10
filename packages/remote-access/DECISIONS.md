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

## Getting in
- A device gets in by scanning a QR code once, and stays in. No password and no account.
  Picked over a password, one more thing to keep and to leak.
- A device that is already in shows the code for the next one.
- Each device has its own key, and is removed alone. Picked over one key shared by every
  device, where taking one phone out meant a new key for all.
- A device that is in sees and does what the computer's own browser does. Picked over a
  device that only watches.

## Phone on Wi-Fi
- The link on the Wi-Fi is plain HTTP, behind a switch that is off until a person turns it
  on, and turning it on says first what plain HTTP means. A lock of its own comes later.
  Picked over a private network app on the phone, one more thing to install and sign in to.
- The code holds the computer's name on the network when it has one, and its number
  otherwise, with a link under the code to use the number. Picked over the number alone,
  which the network changes, and then every device has to scan again.
