import { OWN_NAME } from '@openagt/agent-driver-claude'
/**
 * The steps of an install, in order: what each is called on the page, who runs it on the server,
 * and the script itself. A step first looks whether its work is already done and then does
 * nothing, so the same list is the first install, a second try after a failure, and an update.
 *
 * `root` is only who installs. What runs afterwards runs as the server's own user `openagent`:
 * the programs are root's, so an agent that works there cannot change OpenAgent itself.
 */

export const STEP_IDS = ['login', 'user', 'tools', 'name', 'openagent', 'agent', 'people', 'service', 'door'] as const
/** The steps of a computer reached through a server: its line to that server in place of a door of its own. */
export const THROUGH_STEP_IDS = ['login', 'user', 'tools', 'name', 'openagent', 'agent', 'people', 'service', 'line'] as const
export type StepId = (typeof STEP_IDS)[number] | (typeof THROUGH_STEP_IDS)[number]

/** The steps of a server, by whether it is reached through another server. */
export const stepIdsFor = (through: boolean): readonly StepId[] => (through ? THROUGH_STEP_IDS : STEP_IDS)

/** Who may start runs on a computer reached through a server, from that server: nobody, its own person, or every person there. */
export type Who = 'nobody' | 'me' | 'everyone'

/** What the computer's door is told for each: the server only watches, its person starts runs, or every person there does. */
export const LINE_MODE: Record<Who, 'watch' | 'full' | 'everyone'> = { nobody: 'watch', me: 'full', everyone: 'everyone' }

/** A computer reached through a server, as its install knows it. */
export interface Through {
  /** The server's door, as an origin: what the computer keeps its line to. */
  url: string
  /** The person who connects it, by their GitHub account there: the computer's owner. */
  owner: string
  who: Who
  /** A link that lets the computer's line in at the server, once; none when the computer keeps its line there already. */
  link?: string
}

/** What a script is written for. */
export interface Facts {
  /** The server's number or name: what its certificate is for. */
  address: string
  /** The OpenAgent the server gets: the one that runs on this computer. */
  version: string
  /** This computer's own name in git, when it has one. */
  name?: string
  /** This computer's own email in git, when it has one. */
  email?: string
  /** Set for a computer reached through a server, with no door of its own on the internet. */
  through?: Through
  /**
   * The user the person logs in over SSH as, on a computer reached through a server: the person
   * at that computer, who opens its OpenAgent in its own browser. Never set for a server on the internet.
   */
  desktop?: string
}

export interface StepDef {
  id: StepId
  /** The step's line on the page. */
  label: string
  as: 'root' | 'openagent'
  /** How long the step may take: a server that stopped answering is not waited for longer. */
  timeoutMs: number
  script(facts: Facts): string
}

/** The server's user everything runs as once it is installed. */
export const SERVER_USER = 'openagent'

/** Where the install keeps what it brings: Node, and OpenAgent inside it. */
const ROOT = '/opt/openagent'
/** The Node the server gets: the newest of this line, read off nodejs.org with its checksum. */
const NODE_LINE = 24

/** Where the server keeps the Claude login: root's file, which the service reads as it starts. An agent on the server works with the login, and so can read it; it cannot change the file. */
export const CLAUDE_FILE = '/etc/openagent/claude.env'
/** The name Claude Code reads a login under that was made for a computer nobody sits at. */
const CLAUDE_NAME = 'CLAUDE_CODE_OAUTH_TOKEN'

/** The door's own command, inside the OpenAgent the install brought. */
const DOOR = `${ROOT}/node/bin/node ${ROOT}/node/lib/node_modules/@openagt/start/node_modules/@openagt/remote-access/bin/remote-access`

/** `value` as one word of a shell script, whatever it holds. */
export function quoted(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Held by every script root runs, for as long as it runs: a script still at work after this computer stopped waiting for it is not joined by a second one.
 * In a folder only root writes: the server's user cannot put a file of its own there first.
 */
const LOCK = '/run/openagent-install.lock'

/**
 * A whole script around `body`. The body is a function called once the shell has read all of
 * it, with nothing to read from: the script itself comes in where a program it starts would
 * otherwise read, and would be eaten by the first one that does.
 *
 * Root finds its programs in the system's own folders only, and nothing the server's user can
 * write is ever on its way to one.
 */
function script(as: StepDef['as'], vars: Record<string, string>, body: string): string {
  const system = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  return [
    'set -euo pipefail',
    'umask 022',
    'export DEBIAN_FRONTEND=noninteractive',
    `export PATH="${as === 'root' ? system : `$HOME/.local/bin:${ROOT}/node/bin:${system}`}"`,
    ...Object.entries(vars).map(([name, value]) => `${name}=${quoted(value)}`),
    'fail() { echo "$1" >&2; exit 1; }',
    ...(as === 'root' ? [`exec 9>${LOCK}`, 'flock -n 9 || fail "Another install is still at work on this server. Try again in a moment."'] : []),
    'main() {',
    body.trim(),
    '}',
    'main </dev/null',
    '',
  ].join('\n')
}

const MINUTE = 60_000

/** Defines `started`, which waits until OpenAgent answers on the server; when it does not, it shows what the service last said and answers no. */
const STARTED = `
  started() {
    for _ in $(seq 30); do
      curl -fsS -o /dev/null http://127.0.0.1:4200/ 2>/dev/null && return 0
      sleep 1
    done
    journalctl -u openagent -n 20 --no-pager >&2 || true
    return 1
  }`
const NOT_STARTED = 'fail "OpenAgent did not start on this server."'

/**
 * What the service says to the OpenAgent it starts: this computer is a server one was installed
 * on. Servers are connected from a person's own computer, so a server's own page offers none.
 */
export const SERVER_MARK = 'OPENAGENT_SERVER'

/**
 * The helper that makes a user and an OpenAgent of their own for a person the owner invites,
 * and takes them away again. Root's program: the server's user may run it as root, and nothing
 * else as root.
 */
export const PERSON_HELPER = `${ROOT}/bin/openagent-person`
/** How the door is told where the helper is. A computer with none gives nobody a user of their own: a laptop, a computer at home. */
export const PERSON_HELPER_ENV = 'OPENAGENT_PERSON_HELPER'
/** How a person's OpenAgent is told whose it is: their GitHub account. */
export const PERSON_MARK = 'OPENAGENT_PERSON'
/** Root's folder of the persons: a file each, `<user>.env`, which their OpenAgent's service reads. */
export const PERSONS_DIR = '/etc/openagent/persons'
/** The rule that lets the server's user run the helper as root. */
export const SUDOERS_FILE = '/etc/sudoers.d/openagent-person'
/** The service a person's OpenAgent runs as, one for each person's user: `openagent-person@<user>.service`. */
export const PERSON_UNIT_FILE = '/etc/systemd/system/openagent-person@.service'
/** The service that puts the firewall's rules in place as the server starts, before OpenAgent does. */
export const FIREWALL_UNIT_FILE = '/etc/systemd/system/openagent-firewall.service'
/** How long the server gets for what makes or takes away a person's user: the first one installs Claude Code for them. */
export const PERSON_TIMEOUT_MS = 5 * MINUTE

/** What the service file holds. `KillMode=process`: a run is a process of its own and goes on when OpenAgent starts again, as on a laptop. */
export const SERVICE_UNIT = `[Unit]
Description=OpenAgent
After=network-online.target openagent-firewall.service
Wants=network-online.target

[Service]
User=${SERVER_USER}
WorkingDirectory=/home/${SERVER_USER}
Environment=PATH=/home/${SERVER_USER}/.local/bin:${ROOT}/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=${SERVER_MARK}=1
Environment=${PERSON_HELPER_ENV}=${PERSON_HELPER}
EnvironmentFile=-${CLAUDE_FILE}
ExecStart=${ROOT}/node/bin/openagent
Restart=always
RestartSec=5
KillMode=process
AmbientCapabilities=CAP_NET_BIND_SERVICE
ProtectProc=invisible

[Install]
WantedBy=multi-user.target`

/**
 * What a person's OpenAgent runs as: their own user, on the first port of their block, with the
 * Claude login their own user keeps. Root's file comes last, so what it says (the port, whose it
 * is) is what counts, whatever the person's own file says. Each OpenAgent sees only its own
 * user's programs: a run's prompt is on its command line.
 */
export const PERSON_UNIT = `[Unit]
Description=OpenAgent of %i
After=network-online.target openagent-firewall.service
Wants=network-online.target

[Service]
User=%i
WorkingDirectory=/home/%i
Environment=PATH=/home/%i/.local/bin:${ROOT}/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=${SERVER_MARK}=1
EnvironmentFile=-/home/%i/.config/openagent/claude.env
EnvironmentFile=${PERSONS_DIR}/%i.env
ExecStart=${ROOT}/node/bin/openagent --port \${PORT}
Restart=always
RestartSec=2
KillMode=process
ProtectProc=invisible

[Install]
WantedBy=multi-user.target`

/** What puts the firewall's rules in place at every start: after the system's own firewall, which empties all rules as it starts, and before any OpenAgent. */
export const FIREWALL_UNIT = `[Unit]
Description=OpenAgent's firewall: each person's agents reach only their own OpenAgent
After=nftables.service
Before=openagent.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${PERSON_HELPER} firewall

[Install]
WantedBy=multi-user.target`

/**
 * Root's file that names the person's own user on a computer reached through a server: the firewall
 * lets that user call the owner's OpenAgent too, from the computer's own browser. None on a server
 * on the internet, which nobody sits at.
 */
export const DESKTOP_FILE = '/etc/openagent/desktop-user'

/** The one thing the server's user may run as root. */
export const SUDOERS = `${SERVER_USER} ALL=(root) NOPASSWD: ${PERSON_HELPER}`

/**
 * The helper itself, a script root runs:
 *
 * - `add <account> <port>` makes the person's user (`oa-<account>`), puts Claude Code in its home,
 *   and starts the person's OpenAgent on `<port>`, the first of a block of 100 ports that are
 *   theirs: their OpenAgent, and the lines of their computers. It answers the user's name once
 *   that OpenAgent answers. Asked again, it does only what is not done yet.
 * - `remove <account>` stops it all and deletes the user with everything in its home.
 * - `firewall` puts the rules in place anew.
 *
 * The rules: a call on this server to the owner's ports (4200–4299) is made only by the server's
 * own user or root, and on a computer reached through a server also by the person's own user
 * there ({@link DESKTOP_FILE}); a call to a person's block only by that person's user, the
 * server's user (the door, which passes the person's calls on) or root. Root stays let in everywhere:
 * the install itself asks OpenAgent whether it answers. And only those users answer from those
 * ports: a person's program that took a port the owner's OpenAgent let go of a moment is heard
 * by nobody.
 *
 * Every word it is given is checked before anything is done with it: a person's user writes
 * nothing root runs or reads as a script, and the files root writes are written whole.
 */
export const HELPER = `#!/bin/bash
# OpenAgent's helper for the people a server's owner invites, written by OpenAgent's install.
set -euo pipefail
umask 022
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
PERSONS=${PERSONS_DIR}

fail() { echo "$1" >&2; exit 1; }
usage() { echo "usage: openagent-person add <github account> <port> | remove <github account> | firewall" >&2; exit 2; }

# A GitHub account as the door keeps it: letters, digits and single dashes, at most 39.
account_ok() { [ \${#1} -le 39 ] && [[ $1 =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; }
# The first port of a block of 100 a person has, never the owner's: 4300, 4400, up to 9900.
port_ok() { [[ $1 =~ ^[4-9][0-9]00$ ]] && [ "$1" -ge 4300 ]; }
user_ok() { [[ $1 =~ ^oa-[a-z0-9-]{1,29}$ ]]; }
is_user() { id -u "$1" >/dev/null 2>&1; }
# A person's user: their account after "oa-", and when that is too long for a user name, its start and a mark of all of it.
user_of() {
  if [ \${#1} -le 29 ]; then echo "oa-$1"; else echo "oa-\${1:0:20}-$(printf %s "$1" | sha256sum | cut -c1-8)"; fi
}
# The port a person's file names; nothing for a file that names none.
port_in() { sed -n 's/^PORT=\\([4-9][0-9]00\\)$/\\1/p' "$1" | head -n 1; }
# One at a time: two invites at once would give one port twice.
lock() { exec 9>/run/openagent-person.lock; flock -w 600 9 || fail "Another change of the people on this server is still at work."; }

# Two rules for a block of ports: who may call them, and who may answer from them.
block() {
  printf '    oifname "lo" tcp dport %s meta skuid != { %s } reject with tcp reset\\n' "$1" "$2"
  printf '    oifname "lo" tcp sport %s meta skuid != { %s } drop\\n' "$1" "$2"
}
rules() {
  local file user port desktop owners='"${SERVER_USER}", "root"'
  desktop=$(head -n 1 ${DESKTOP_FILE} 2>/dev/null || true)
  # The person at a computer reached through a server opens its OpenAgent in their own browser, as their own user.
  if [[ $desktop =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] && [ "$desktop" != ${SERVER_USER} ] && [ "$desktop" != root ] && is_user "$desktop"; then owners="$owners, \\"$desktop\\""; fi
  block 4200-4299 "$owners"
  for file in "$PERSONS"/*.env; do
    [ -e "$file" ] || continue
    user=$(basename "$file" .env)
    port=$(port_in "$file")
    # Only what this helper wrote names a user it made: anything else in the folder is no person.
    if user_ok "$user" && [ -n "$port" ] && port_ok "$port" && is_user "$user"; then block "$port-$((port + 99))" "\\"$user\\", \\"${SERVER_USER}\\", \\"root\\""; fi
  done
}
apply_firewall() {
  local said
  said=$(rules)
  # Taken away and put back in one go: there is no moment without the rules.
  nft -f - <<EOF
table inet openagent
delete table inet openagent
table inet openagent {
  chain out {
    type filter hook output priority 0; policy accept;
$said
  }
}
EOF
}

add() {
  local account=$1 port=$2 user file home unit before tmp other
  account_ok "$account" || fail "$account is not a GitHub account."
  port_ok "$port" || fail "$port is not the first port of a person's block."
  user=$(user_of "$account")
  file=$PERSONS/$user.env
  unit=openagent-person@$user.service
  lock
  install -d -m 755 /etc/openagent "$PERSONS"
  for other in "$PERSONS"/*.env; do
    [ -e "$other" ] && [ "$other" != "$file" ] || continue
    [ "$(port_in "$other")" != "$port" ] || fail "Port $port is another person's on this server."
  done
  # A user of that name that this helper did not make is someone else's, and is not taken over.
  if is_user "$user" && [ ! -e "$file" ]; then fail "This server has a user $user that OpenAgent did not make."; fi
  before=$(cat "$file" 2>/dev/null || true)
  tmp=$(mktemp "$PERSONS/.new.XXXXXX")
  printf 'OPENAGENT_PERSON=%s\\nPORT=%s\\n' "$account" "$port" > "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$file"
  is_user "$user" || useradd --create-home --shell /bin/bash "$user"
  home=$(getent passwd "$user" | cut -d: -f6)
  [ "$home" = "/home/$user" ] || fail "The user $user has no home of its own."
  # Claude Code's own installer, into the person's home, as for the server's own user: it keeps itself up to date there.
  if [ ! -e "$home/.local/bin/claude" ]; then
    runuser -u "$user" -- env -i HOME="$home" USER="$user" LOGNAME="$user" PATH=/usr/local/bin:/usr/bin:/bin bash -c 'cd && curl -fsSL https://claude.ai/install.sh | bash' </dev/null >/dev/null 2>&1 ||
      fail "Claude Code could not be installed for @$account."
  fi
  systemctl enable --quiet "$unit"
  apply_firewall
  if [ "$before" != "$(cat "$file")" ] || ! systemctl is-active --quiet "$unit"; then systemctl restart "$unit"; fi
  for _ in $(seq 30); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$port/" 2>/dev/null; then echo "$user"; return 0; fi
    sleep 1
  done
  journalctl -u "$unit" -n 20 --no-pager >&2 || true
  fail "@$account's OpenAgent did not start on this server."
}

remove() {
  local account=$1 user file
  account_ok "$account" || fail "$account is not a GitHub account."
  user=$(user_of "$account")
  file=$PERSONS/$user.env
  lock
  # Only a user this helper made is taken away: one it keeps a file of.
  if [ ! -e "$file" ]; then
    if is_user "$user"; then fail "This server has a user $user that OpenAgent did not make: it is left as it is."; fi
    return 0
  fi
  systemctl disable --now --quiet "openagent-person@$user.service" 2>/dev/null || true
  if is_user "$user"; then
    # Its runs too: they go on by themselves when only its OpenAgent stops.
    pkill -KILL -u "$user" 2>/dev/null || true
    for _ in $(seq 20); do pgrep -u "$user" >/dev/null || break; sleep 0.5; done
    userdel --remove "$user" >/dev/null 2>&1 || true
    if is_user "$user"; then fail "The user $user could not be removed."; fi
  fi
  rm -rf --one-file-system "/home/$user"
  rm -f "$file"
  apply_firewall
}

case "\${1:-}" in
  add) [ $# -eq 3 ] || usage; add "$2" "$3" ;;
  remove) [ $# -eq 2 ] || usage; remove "$2" ;;
  firewall) [ $# -eq 1 ] || usage; lock; apply_firewall ;;
  *) usage ;;
esac`

export const STEPS: readonly StepDef[] = [
  {
    id: 'login',
    label: 'Log in',
    as: 'root',
    timeoutMs: 2 * MINUTE,
    script: () =>
      script(
        'root',
        {},
        `
  . /etc/os-release 2>/dev/null || true
  case "\${ID:-}" in
    ubuntu | debian) ;;
    *) fail "OpenAgent installs on Ubuntu and Debian. This server runs \${PRETTY_NAME:-something else}." ;;
  esac
  case "$(uname -m)" in
    x86_64 | aarch64) ;;
    *) fail "OpenAgent has no install for this server's chip, $(uname -m)." ;;
  esac
  [ -d /run/systemd/system ] || fail "This server does not start its programs with systemd, which OpenAgent's service needs."
  # Nothing is changed under an agent at work: its own programs would be replaced while it runs.
  # Any person's agent: every OpenAgent on the server runs the Node and the OpenAgent the install brought.
  if pgrep -f 'agent-runner/bin/agent-runner run' >/dev/null 2>&1; then
    fail "An agent is working on this server. Stop it, or wait until it ends, then try again."
  fi
  echo "\${PRETTY_NAME:-$ID}, $(uname -m)"
`,
      ),
  },
  {
    id: 'user',
    label: `The user ${SERVER_USER}`,
    as: 'root',
    timeoutMs: 2 * MINUTE,
    script: () =>
      script(
        'root',
        {},
        `
  id ${SERVER_USER} >/dev/null 2>&1 || useradd --create-home --shell /bin/bash ${SERVER_USER}
`,
      ),
  },
  {
    id: 'tools',
    label: 'git, gh, Node and Chrome',
    as: 'root',
    timeoutMs: 20 * MINUTE,
    script: () =>
      script(
        'root',
        {},
        `
  . /etc/os-release
  # A server that was just made often installs its own updates in its first minutes: the install waits its turn.
  apt() { apt-get -y -q -o DPkg::Lock::Timeout=600 "$@"; }
  apt update
  apt install git curl ca-certificates xz-utils procps nftables sudo
  dir=$(mktemp -d)
  trap 'rm -rf "$dir"' EXIT

  # From GitHub's own package source, signed with its key: the gh these systems bring themselves is years old.
  if ! command -v gh >/dev/null; then
    install -d -m 755 /etc/apt/keyrings
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o "$dir/gh.gpg"
    install -m 644 "$dir/gh.gpg" /etc/apt/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list
    apt update
    apt install gh
  fi

  have=$(${ROOT}/node/bin/node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)
  if [ "$have" != ${NODE_LINE} ]; then
    arch=x64
    [ "$(uname -m)" = aarch64 ] && arch=arm64
    from=https://nodejs.org/dist/latest-v${NODE_LINE}.x
    curl -fsSL "$from/SHASUMS256.txt" -o "$dir/SHASUMS256.txt"
    file=$(grep -o "node-v[0-9.]*-linux-$arch\\.tar\\.xz" "$dir/SHASUMS256.txt" | head -n 1 || true)
    [ -n "$file" ] || fail "nodejs.org lists no Node ${NODE_LINE} for this server's chip."
    curl -fsSL "$from/$file" -o "$dir/$file"
    (cd "$dir" && grep " $file\\$" SHASUMS256.txt | sha256sum -c - >/dev/null) || fail "The Node that was downloaded is not the one nodejs.org lists."
    rm -rf ${ROOT}/node.new
    mkdir -p ${ROOT}/node.new
    # Root's, whoever the download names as the files' owner: on a server that owner could be the user the agents run as.
    tar -xJf "$dir/$file" -C ${ROOT}/node.new --strip-components=1 --no-same-owner
    rm -rf ${ROOT}/node
    mv ${ROOT}/node.new ${ROOT}/node
    touch ${ROOT}/restart
  fi
  for bin in node npm npx; do ln -sf ${ROOT}/node/bin/$bin /usr/local/bin/$bin; done

  # A browser that is there and does not start is none: Ubuntu's own package is only a pointer to its snap store.
  browser() { for name in google-chrome chromium chromium-browser; do "$name" --version >/dev/null 2>&1 && return 0; done; return 1; }
  if ! browser; then
    if [ "$(uname -m)" = x86_64 ]; then
      curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o "$dir/chrome.deb"
      apt install "$dir/chrome.deb"
    elif [ "$ID" = debian ]; then
      # Google ships no Chrome for this chip: Chromium is the same browser without its name.
      apt install chromium
    else
      apt install chromium-browser
    fi
    browser || fail "Chrome was installed, and it does not start on this server."
  fi
`,
      ),
  },
  {
    id: 'name',
    label: 'Your name and email for git',
    as: 'openagent',
    timeoutMs: 2 * MINUTE,
    script: ({ name = '', email = '' }) =>
      script(
        'openagent',
        { NAME: name, EMAIL: email },
        `
  # A run's record and an agent's work are commits, and git makes none without a name and an email.
  # Only what the server's git lacks is given: what someone set there stays. Nothing is written until both are sure.
  # Asked outside every folder: what a project's own git says is that project's alone.
  has() { [ -n "$(cd / && git config --get "$1" || true)" ]; }
  none() {
    fail "The server's git has no $1, and this computer's git has none to give: nothing an agent does there could be saved. Give this computer both, then try again:
  git config --global user.name 'Your Name'
  git config --global user.email 'you@example.com'"
  }
  has user.name || [ -n "$NAME" ] || none name
  has user.email || [ -n "$EMAIL" ] || none email
  has user.name || git config --global -- user.name "$NAME"
  has user.email || git config --global -- user.email "$EMAIL"
`,
      ),
  },
  {
    id: 'openagent',
    label: 'OpenAgent',
    as: 'root',
    timeoutMs: 20 * MINUTE,
    script: ({ version }) =>
      script(
        'root',
        { VERSION: version },
        `
  # Read off its file, not asked of OpenAgent itself: nothing a package brought runs as root, neither here nor at the install.
  have=$(${ROOT}/node/bin/node -p 'require("${ROOT}/node/lib/node_modules/@openagt/start/package.json").version' 2>/dev/null || true)
  if [ "$have" != "$VERSION" ]; then
    ${ROOT}/node/bin/npm install --global --ignore-scripts --no-fund --no-audit --loglevel=error "@openagt/start@$VERSION"
    touch ${ROOT}/restart
  fi
  ln -sf ${ROOT}/node/bin/openagent /usr/local/bin/openagent
`,
      ),
  },
  {
    id: 'agent',
    label: 'Claude Code',
    as: 'openagent',
    timeoutMs: 10 * MINUTE,
    script: () =>
      script(
        'openagent',
        {},
        `
  # Claude Code's own installer, into this user's home: it keeps itself up to date there, as on a laptop.
  command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash
  command -v claude >/dev/null || fail "Claude Code's installer ended without a claude command."
`,
      ),
  },
  {
    id: 'people',
    label: 'Users for invited people',
    as: 'root',
    timeoutMs: 3 * MINUTE,
    script: ({ desktop = '' }) =>
      script(
        'root',
        { HELPER, SUDOERS, PERSON_UNIT, FIREWALL_UNIT, DESKTOP: desktop },
        `
  install -d -m 755 ${ROOT}/bin /etc/openagent ${PERSONS_DIR}
  # Each file root's, written whole and moved in, and only when it changed.
  changed() { [ "$(cat "$1" 2>/dev/null || true)" != "$2" ]; }
  put() {
    tmp=$(mktemp "$(dirname "$1")/.openagent.XXXXXX")
    printf '%s\\n' "$3" > "$tmp"
    chmod "$2" "$tmp"
    mv -f "$tmp" "$1"
  }
  helper=0 units=0 persons=0 desk=0
  if changed ${PERSON_HELPER} "$HELPER"; then put ${PERSON_HELPER} 755 "$HELPER"; helper=1; fi
  if changed ${SUDOERS_FILE} "$SUDOERS"; then
    # Checked before it is in place: a rule sudo cannot read would leave nobody able to use sudo. A name with a dot is not read by sudo meanwhile.
    tmp=$(mktemp /etc/sudoers.d/.openagent.XXXXXX)
    printf '%s\\n' "$SUDOERS" > "$tmp"
    chmod 440 "$tmp"
    visudo -cf "$tmp" >/dev/null || { rm -f "$tmp"; fail "sudo does not take the rule that lets OpenAgent make a user for each person."; }
    mv -f "$tmp" ${SUDOERS_FILE}
  fi
  if changed ${PERSON_UNIT_FILE} "$PERSON_UNIT"; then put ${PERSON_UNIT_FILE} 644 "$PERSON_UNIT"; units=1; persons=1; fi
  if changed ${FIREWALL_UNIT_FILE} "$FIREWALL_UNIT"; then put ${FIREWALL_UNIT_FILE} 644 "$FIREWALL_UNIT"; units=1; fi
  # The person at a computer reached through a server, by the user they log in as: no other user is ever named here.
  if [ -n "$DESKTOP" ]; then
    { [[ $DESKTOP =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] && id -u "$DESKTOP" >/dev/null 2>&1; } || fail "This computer has no user $DESKTOP to let open OpenAgent in its browser."
    if changed ${DESKTOP_FILE} "$DESKTOP"; then put ${DESKTOP_FILE} 644 "$DESKTOP"; desk=1; fi
  elif [ -e ${DESKTOP_FILE} ]; then
    rm -f ${DESKTOP_FILE}
    desk=1
  fi
  [ "$units" = 0 ] || systemctl daemon-reload
  systemctl enable --quiet openagent-firewall
  if [ "$helper" = 1 ] || [ "$units" = 1 ] || [ "$desk" = 1 ] || ! systemctl is-active --quiet openagent-firewall; then
    systemctl restart openagent-firewall || fail "The firewall's rules could not be put in place."
  fi
  # A person's OpenAgent runs the Node and the OpenAgent the install brought: when they changed, or how it is started did, it starts again. Its runs go on.
  if [ "$persons" = 1 ] || [ -e ${ROOT}/restart ]; then
    for unit in $(systemctl list-units --type=service --state=active --plain --no-legend 'openagent-person@*' | awk '{print $1}'); do
      systemctl restart "$unit"
    done
  fi
`,
      ),
  },
  {
    id: 'service',
    label: 'The service',
    as: 'root',
    timeoutMs: 3 * MINUTE,
    script: ({ through }) =>
      script(
        'root',
        { UNIT: SERVICE_UNIT },
        `${STARTED}
  file=/etc/systemd/system/openagent.service
  if [ "$(cat "$file" 2>/dev/null || true)" != "$UNIT" ]; then
    printf '%s\\n' "$UNIT" > "$file"
    systemctl daemon-reload
    touch ${ROOT}/restart
  fi${
    // A computer reached through a server opens no door to the internet: its own firewall is left as it is.
    through
      ? ''
      : `
  # A firewall that is on lets the door's two ports through; one that is off is left off.
  if command -v ufw >/dev/null && ufw status | grep '^Status: active' >/dev/null; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
  fi`
  }
  systemctl enable --quiet openagent
  if [ -e ${ROOT}/restart ] || ! systemctl is-active --quiet openagent; then
    systemctl restart openagent
    rm -f ${ROOT}/restart
  fi
  started || ${NOT_STARTED}
`,
      ),
  },
  {
    id: 'door',
    label: 'The door',
    as: 'openagent',
    timeoutMs: 6 * MINUTE,
    script: ({ address }) =>
      script(
        'openagent',
        { ADDRESS: address },
        `
  open() { case "$(${DOOR} status)" in *'"listening":true'*'"address":"'"$ADDRESS"'"'*) return 0 ;; *) return 1 ;; esac; }
  open && exit 0
  ${DOOR} https "$ADDRESS" >/dev/null
  # A certificate takes a moment: its office reads the proof on port 80 first.
  for _ in $(seq 150); do
    open && exit 0
    sleep 2
  done
  ${DOOR} status | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.error(JSON.parse(s).problem??"The door did not open."))' || true
  fail "The door needs ports 80 and 443 of this server open to the internet: check the firewall of the company the server is rented from."
`,
      ),
  },
]

/**
 * The door is told where the helper is when it lets a person in or takes one out over SSH, as
 * the service tells it: a shell that logs in has nothing of the service's.
 */
const WITH_HELPER = `${PERSON_HELPER_ENV}=${PERSON_HELPER}`

/**
 * The last step of a computer reached through a server, in place of a door of its own: the
 * person who connects it is named its owner, it keeps a line open to the server as theirs, and
 * the line says who there may start runs on it.
 */
export const LINE_STEP: StepDef = {
  id: 'line',
  label: 'Its line to the server',
  as: 'openagent',
  timeoutMs: 2 * MINUTE,
  script: ({ through }) => {
    if (!through) throw new Error('only a computer reached through a server has a line step')
    return script(
      'openagent',
      { URL: through.url, OWNER: through.owner, LINK: through.link ?? '', MODE: LINE_MODE[through.who] },
      `
  # Named once, as a server's owner is at its first Invite; the same person again changes nothing.
  ${DOOR} owner "$OWNER" >/dev/null
  # A line it already keeps there is kept: a link comes only for a computer that has none, or lost it.
  # On standard input, never on a command line: it lets a computer in.
  [ -z "$LINK" ] || printf '%s\n' "$LINK" | ${DOOR} line add - >/dev/null
  ${WITH_HELPER} ${DOOR} line "$MODE" "$URL" >/dev/null
`,
    )
  },
}

/** The steps of a server, in order: a computer reached through a server has its line where a server on the internet has its door. */
export function stepsFor(through: boolean): readonly StepDef[] {
  return through ? [...STEPS.filter(step => step.id !== 'door'), LINE_STEP] : STEPS
}

/** The label a step is shown with on a server's row: the line names the server it goes to. */
export function stepLabel(step: StepDef, through: string | undefined): string {
  return step.id === 'line' && through !== undefined ? `Its line to ${new URL(through).host}` : step.label
}

/**
 * The script that tells the door of a computer reached through a server who there may start runs
 * on it, and with `remove`, takes away the user of each person its line made, with everything in it.
 * Run as the server's own user.
 */
export function whoScript(url: string, who: Who, remove: readonly string[] = []): string {
  return script(SERVER_USER, { URL: url, MODE: LINE_MODE[who] }, `
  ${WITH_HELPER} ${DOOR} line "$MODE" "$URL" >/dev/null
${remove.map(account => `  ${WITH_HELPER} ${DOOR} remove-person ${quoted(account)} >/dev/null
`).join('')}  ${DOOR} status
`)
}

/**
 * The script that asks the server's door for a link a new machine gets in with, for a person when
 * one is named: that person then gets a user and an OpenAgent of their own first. Run as the server's own user.
 */
export function linkScript(person?: string): string {
  return person === undefined ? script(SERVER_USER, {}, `\n  ${DOOR} add\n`) : script(SERVER_USER, { FOR: person }, `\n  ${WITH_HELPER} ${DOOR} add --for "$FOR"\n`)
}

/** The script that names the server's owner at its door, and answers the devices and persons. Run as the server's own user. */
export function ownerScript(account: string): string {
  return script(SERVER_USER, { ACCOUNT: account }, `\n  ${DOOR} owner "$ACCOUNT"\n`)
}

/** The script that takes a person out at the server's door, with their devices, their user and all it holds, and answers the ones still in. Run as the server's own user. */
export function removePersonScript(account: string): string {
  return script(SERVER_USER, { ACCOUNT: account }, `\n  ${WITH_HELPER} ${DOOR} remove-person "$ACCOUNT"\n`)
}

/** The script that asks the server's door which devices are in. Run as the server's own user. */
export function devicesScript(): string {
  return script(SERVER_USER, {}, `\n  ${DOOR} status\n`)
}

/** The script that takes one device out at the server's door, and answers the ones still in. Run as the server's own user. */
export function removeDeviceScript(id: string): string {
  return script(SERVER_USER, { ID: id }, `\n  ${DOOR} remove "$ID"\n`)
}

/** A script that puts a login on the server or takes it off, and who runs it there. */
export interface LoginScript {
  as: StepDef['as']
  script: string
}

/** How long a login's script may take: a server that stopped answering is not waited for longer. */
export const LOGIN_TIMEOUT_MS = 2 * MINUTE

/** `gh` reads and writes its own file in the server user's home, whatever that user's shell says of another place or another login. */
const GH_OWN = 'unset GH_TOKEN GITHUB_TOKEN GH_CONFIG_DIR XDG_CONFIG_HOME'
const GH_FILE = '"$HOME/.config/gh/hosts.yml"'

/**
 * Give the server a GitHub login: `gh` keeps it in its own file, and git asks `gh` for it. The
 * server then holds this one login, and answers whose it is; when any of that fails, it holds none.
 *
 * The login is a word of the script, which the server's shell reads where a program would read:
 * it is on no command line, and no program the script starts finds it among what it was given.
 */
export function githubLoginScript(login: string): LoginScript {
  return {
    as: SERVER_USER,
    script: script(
      SERVER_USER,
      { LOGIN: login },
      `
  ${GH_OWN}
  ${GH_STOP_ASKING}
  rm -f ${GH_FILE}
  given() {
    printf '%s\\n' "$LOGIN" | gh auth login --hostname github.com --git-protocol https --with-token &&
      gh auth setup-git --hostname github.com &&
      gh api --hostname github.com user --jq .login
  }
  # All of it or none: a login that is on the server and not known of on this computer could not be taken off from there.
  given || { rm -f ${GH_FILE}; exit 1; }
`,
    ),
  }
}

/** How long a person has to type the code at GitHub: GitHub's own limit is fifteen minutes. */
export const GITHUB_CODE_TIMEOUT_MS = 16 * MINUTE

/** Where the server's `gh` writes while it waits for the code to be typed, and the one that waits right now. */
const GH_ASKING = '"$HOME/.cache/openagent-github-login"'

/** Whether the process `$1` is a `gh` that asks GitHub for a login: a number kept in a file may be another process's by now. */
const GH_IS_ASKING = `asking() { ps -o args= -p "$1" 2>/dev/null | grep -q 'gh auth login'; }`

/**
 * End the server's `gh` that still waits for a code, when one does, and forget it: every script
 * that changes the server's GitHub login starts with this, so a code from an earlier press brings
 * nothing once the login was asked for anew, copied or taken off, and its wait changes nothing.
 */
const GH_STOP_ASKING = `${GH_IS_ASKING}
  waiting=$(cat ${GH_ASKING}.pid 2>/dev/null || true)
  case "$waiting" in
    '' | *[!0-9]*) ;;
    *) if asking "$waiting"; then kill "$waiting" 2>/dev/null || true; fi ;;
  esac
  rm -f ${GH_ASKING}.pid`

/**
 * Have the server ask GitHub for a login of its own: its `gh` is started and left waiting, and
 * GitHub answers with a short code that a person types at github.com/login/device. The script
 * prints `<process> <file> <code>` and ends; {@link githubWaitScript} sees the rest. One that
 * still waits from an earlier press is ended first. The login the server had goes, as with a
 * copy: the server has one GitHub login, the last one asked for.
 */
export function githubCodeScript(): LoginScript {
  return {
    as: SERVER_USER,
    script: script(
      SERVER_USER,
      {},
      `
  ${GH_OWN}
  command -v gh >/dev/null || fail "gh is not on this server yet. Press Update on its row first."
  mkdir -p "$HOME/.cache"
  ${GH_STOP_ASKING}
  rm -f ${GH_FILE}
  log=$(umask 077; mktemp ${GH_ASKING}.XXXXXX)
  nohup setsid gh auth login --hostname github.com --git-protocol https --web >"$log" 2>&1 &
  pid=$!
  echo "$pid" > ${GH_ASKING}.pid
  for _ in $(seq 1 150); do
    grep -q 'one-time code' "$log" && break
    # Asked whether it lives, not what it is called: it is this script's own, and in its first moment it has no name of its own yet.
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.2
  done
  code=$(grep -oE 'one-time code: [A-Z0-9]{4}-[A-Z0-9]{4}' "$log" | head -n 1 | awk '{print $NF}' || true)
  if [ -z "$code" ]; then
    kill "$pid" 2>/dev/null || true
    tail -n 5 "$log" >&2
    rm -f "$log" ${GH_ASKING}.pid
    fail "GitHub gave the server no code."
  fi
  echo "$pid $log $code"
`,
    ),
  }
}

/**
 * Wait until the server's `gh` has its answer from GitHub, for the code {@link githubCodeScript}
 * printed, and say whose login it is. All of it or none, as with a copy.
 */
export function githubWaitScript(pid: string, log: string): LoginScript {
  return {
    as: SERVER_USER,
    script: script(
      SERVER_USER,
      { PID: pid, LOG: log },
      `
  ${GH_OWN}
  ${GH_IS_ASKING}
  while asking "$PID"; do sleep 1; done
  # Asked for anew, copied or taken off in the meantime: the server's login is that change's to say, and none of it is this wait's.
  if [ "$(cat ${GH_ASKING}.pid 2>/dev/null || true)" != "$PID" ]; then
    rm -f "$LOG"
    fail "The login was asked for anew, or changed another way, before the code was typed."
  fi
  rm -f ${GH_ASKING}.pid
  # The login the server had was taken off before GitHub was asked: one that is there now came from GitHub.
  given() {
    gh auth setup-git --hostname github.com &&
      gh api --hostname github.com user --jq .login
  }
  if ! given; then
    grep -v 'one-time code' "$LOG" | tail -n 3 >&2 || true
    rm -f "$LOG" ${GH_FILE}
    fail "No login came from GitHub: the code was not typed in time, or it was refused."
  fi
  rm -f "$LOG"
`,
    ),
  }
}

/** Take the GitHub login off the server. */
export function githubLogoutScript(): LoginScript {
  return {
    as: SERVER_USER,
    script: script(
      SERVER_USER,
      {},
      `
  ${GH_OWN}
  ${GH_STOP_ASKING}
  rm -f ${GH_FILE}
`,
    ),
  }
}

/**
 * Give the server a Claude login: Claude Code is first asked, as the server's own user, whether
 * it reads the login; then the login is written to root's file and OpenAgent is started again
 * with it. A run that is at work goes on with the login it started with. When OpenAgent does not
 * start with it, the file is put back as it was.
 *
 * Claude Code is the server user's own program: root asks it as that user, for half a minute at
 * most, and without the lock root holds, which a program that never ended would hold with it.
 */
export function claudeLoginScript(login: string): LoginScript {
  return {
    as: 'root',
    script: script(
      'root',
      { LOGIN: login },
      `${STARTED}
  # What is written where the service reads its settings is a login's letters and nothing else.
  case "$LOGIN" in '' | *[!A-Za-z0-9_-]*) fail "What was sent is no Claude login." ;; esac
  said=$(${CLAUDE_NAME}="$LOGIN" timeout 30 runuser -u ${SERVER_USER} -- env HOME=/home/${SERVER_USER} /home/${SERVER_USER}/.local/bin/claude auth status 2>&1 9>&- || true)
  printf '%s' "$said" | grep -Eq '"loggedIn": *true' || fail "Claude Code on this server does not take the login."
  install -d -m 755 "$(dirname ${CLAUDE_FILE})"
  rm -f ${CLAUDE_FILE}.old
  [ ! -e ${CLAUDE_FILE} ] || cp -p ${CLAUDE_FILE} ${CLAUDE_FILE}.old
  (umask 077 && printf '${CLAUDE_NAME}=%s\\n' "$LOGIN" > ${CLAUDE_FILE}.new)
  mv ${CLAUDE_FILE}.new ${CLAUDE_FILE}
  with_it() {
    systemctl restart openagent && started &&
      tr '\\0' '\\n' < "/proc/$(systemctl show -p MainPID --value openagent)/environ" | grep -q '^${CLAUDE_NAME}='
  }
  if ! with_it; then
    # As it was: a login that is on the server and not known of on this computer could not be taken off from there.
    if [ -e ${CLAUDE_FILE}.old ]; then mv ${CLAUDE_FILE}.old ${CLAUDE_FILE}; else rm -f ${CLAUDE_FILE}; fi
    systemctl restart openagent || true
    fail "OpenAgent did not start with the login. The server's Claude login is as it was before."
  fi
  rm -f ${CLAUDE_FILE}.old
`,
    ),
  }
}

/**
 * The Claude accounts a server's runs may use beside its own login, in the file its OpenAgent
 * reads them from (`accountsPath` of the server's user: the service's home is that user's). Runs
 * take the next free one when one hits its limit; the server's own login is the one with none.
 * Read and changed as the server's user, by the server's own Node, in the format OpenAgent keeps:
 * the file is written whole and then moved over the old one, readable by that user alone. What
 * comes back is the accounts without their logins.
 */
const ACCOUNTS_JS = `
const fs = require('fs')
const file = process.env.FILE
let accounts = []
try {
  const kept = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (Array.isArray(kept.accounts)) accounts = kept.accounts.filter(a => a && typeof a === 'object' && typeof a.name === 'string' && (a.token === undefined || typeof a.token === 'string'))
} catch {}
if (!accounts.some(a => a.token === undefined)) accounts = [{ name: ${JSON.stringify(OWN_NAME)} }, ...accounts]
const name = process.env.NAME || ''
if (process.env.OP === 'add') {
  if (accounts.some(a => a.name.toLowerCase() === name.toLowerCase())) {
    console.error('There is an account named ' + name + ' on the server already.')
    process.exit(3)
  }
  accounts.push({ name, token: fs.readFileSync(0, 'utf8').trim(), added: new Date().toISOString() })
}
if (process.env.OP === 'remove') accounts = accounts.filter(a => a.name !== name || a.token === undefined)
if (process.env.OP !== 'read') {
  const next = file + '.' + process.pid + '.new'
  fs.writeFileSync(next, JSON.stringify({ accounts }, null, 2) + '\\n', { mode: 0o600 })
  fs.chmodSync(next, 0o600)
  fs.renameSync(next, file)
}
console.log(JSON.stringify(accounts.map(({ token, ...rest }) => ({ ...rest, own: token === undefined }))))
`

/** Where the server's user keeps its Claude accounts: as `accountsPath` finds it for a user with no XDG_CONFIG_HOME. */
const ACCOUNTS_FILE = '"$HOME/.openagent-claude-accounts.json"'

/** The server's Claude accounts, as its file says them: names, since when, how full; never a login. */
export function claudeAccountsScript(): LoginScript {
  return { as: SERVER_USER, script: script(SERVER_USER, { JS: ACCOUNTS_JS }, `\n  OP=read FILE=${ACCOUNTS_FILE} node -e "$JS"\n`) }
}

/**
 * Add a Claude account on the server: Claude Code, the server user's own, is first asked whether it
 * reads the login; then it goes into the file on the Node program's input, never on a command line,
 * which every user of the server can read. A name the file has already is refused.
 */
export function claudeAccountAddScript(name: string, login: string): LoginScript {
  return {
    as: SERVER_USER,
    script: script(
      SERVER_USER,
      { NAME: name, LOGIN: login, JS: ACCOUNTS_JS },
      `
  case "$LOGIN" in '' | *[!A-Za-z0-9_-]*) fail "What was sent is no Claude login." ;; esac
  said=$(${CLAUDE_NAME}="$LOGIN" timeout 30 claude auth status 2>&1 || true)
  printf '%s' "$said" | grep -Eq '"loggedIn": *true' || fail "Claude Code on this server does not take the login."
  printf '%s' "$LOGIN" | OP=add NAME="$NAME" FILE=${ACCOUNTS_FILE} node -e "$JS"
`,
    ),
  }
}

/** Take an added Claude account off the server. Its login stays good until its year is over; the server's own login is not one to take off here. */
export function claudeAccountRemoveScript(name: string): LoginScript {
  return { as: SERVER_USER, script: script(SERVER_USER, { NAME: name, JS: ACCOUNTS_JS }, `\n  OP=remove NAME="$NAME" FILE=${ACCOUNTS_FILE} node -e "$JS"\n`) }
}

/** Take the Claude login off the server, and start OpenAgent again without it. */
export function claudeLogoutScript(): LoginScript {
  return {
    as: 'root',
    script: script(
      'root',
      {},
      `${STARTED}
  [ -e ${CLAUDE_FILE} ] || exit 0
  rm -f ${CLAUDE_FILE} ${CLAUDE_FILE}.old
  systemctl restart openagent
  started || ${NOT_STARTED}
`,
    ),
  }
}
