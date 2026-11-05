Non-obvious decisions only, grouped by business-logic flow. Anything not listed is left
to the implementer's judgment. Flag conflicts instead of silently deviating. Keep
outdated decisions (no history).

A bullet is a person's pick, and says what it was picked over. What the code does
belongs in the code and its tests, not here; a choice made while implementing is the
implementer's judgment, not a decision. An AI writes a bullet only for a pick a person
already made, and lists it in its pull request; for anything else it proposes and asks.

## Trying and installing
- Trying OpenAgent is `npx @openagt/dashboard`, which installs nothing; installing it is
  this package, after which the dashboard starts when the person logs in; `npx
  @openagt/uninstall` takes off everything the install put on the computer. Picked over
  one command that does both.

## The address
- The installed dashboard is opened at a name of OpenAgent's own, with the lock and no
  port: this computer answers the name itself (its hosts file), with a certificate made on
  this computer for that name alone, and its port 443 sent to the dashboard. The person
  gives their password once for it. Picked over the public website calling the dashboard
  on `localhost`, which Safari blocks and other browsers ask about, and which lets whoever
  takes the website over reach every computer; over a DNS record pointing the name at this computer,
  which needs the port, plain HTTP and is blocked by some home routers; over one name per
  computer with a real certificate, which needs a service of ours; and over a relay of
  ours, which sees everything.
- The name is the website's own, `openagent.build`: on an installed computer it shows the
  dashboard, with a "Landing page | Dashboard" toggle under the logo, and the landing page
  is the dashboard's copy of the website. Elsewhere it is the public website, whose
  "Dashboard" leads to installing. Picked over a name of its own for the dashboard
  (`dash.openagent.build`), a second address to know; the price is that an installed
  computer shows the website of its installed version, and nothing when the dashboard is
  down.
- The toggle is under the logo at the same place and size on both pages, the top of the
  dashboard's sidebar, so a switch moves neither; the switch slides the lit side over and
  fades the rest (the browser's page transitions; a browser without them just switches).
  Picked over each page placing the toggle in its own layout, where the whole top of the
  page jumped at each switch.
- The toggle shows only on a computer with OpenAgent installed; the public website has the
  logo alone, and its big Dashboard button leads to installing. Picked over the toggle on
  every page, which offered a dashboard to switch to where there is none.
