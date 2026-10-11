/**
 * The steps of an install, in order: what each is called on the page, who runs it on the server,
 * and the script itself. A step first looks whether its work is already done and then does
 * nothing, so the same list is the first install, a second try after a failure, and an update.
 *
 * `root` is only who installs. What runs afterwards runs as the server's own user `openagent`:
 * the programs are root's, so an agent that works there cannot change OpenAgent itself.
 */

export const STEP_IDS = ['login', 'user', 'tools', 'openagent', 'agent', 'service', 'door'] as const
export type StepId = (typeof STEP_IDS)[number]

/** What a script is written for. */
export interface Facts {
  /** The server's number or name: what its certificate is for. */
  address: string
  /** The OpenAgent the server gets: the one that runs on this computer. */
  version: string
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

/** The door's own command, inside the OpenAgent the install brought. */
const DOOR = `${ROOT}/node/bin/node ${ROOT}/node/lib/node_modules/@openagt/dashboard/node_modules/@openagt/remote-access/bin/remote-access`

/** `value` as one word of a shell script, whatever it holds. */
export function quoted(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * A whole script around `body`. The body is a function called once the shell has read all of
 * it, with nothing to read from: the script itself comes in where a program it starts would
 * otherwise read, and would be eaten by the first one that does.
 */
function script(vars: Record<string, string>, body: string): string {
  return [
    'set -euo pipefail',
    'export DEBIAN_FRONTEND=noninteractive',
    `export PATH="$HOME/.local/bin:${ROOT}/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"`,
    ...Object.entries(vars).map(([name, value]) => `${name}=${quoted(value)}`),
    'fail() { echo "$1" >&2; exit 1; }',
    'main() {',
    body.trim(),
    '}',
    'main </dev/null',
    '',
  ].join('\n')
}

const MINUTE = 60_000

/** What the service file holds. `KillMode=process`: a run is a process of its own and goes on when OpenAgent starts again, as on a laptop. */
export const SERVICE_UNIT = `[Unit]
Description=OpenAgent
After=network-online.target
Wants=network-online.target

[Service]
User=${SERVER_USER}
WorkingDirectory=/home/${SERVER_USER}
Environment=PATH=/home/${SERVER_USER}/.local/bin:${ROOT}/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=${ROOT}/node/bin/openagent
Restart=always
RestartSec=5
KillMode=process
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target`

export const STEPS: readonly StepDef[] = [
  {
    id: 'login',
    label: 'Log in',
    as: 'root',
    timeoutMs: 2 * MINUTE,
    script: () =>
      script(
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
  if pgrep -u ${SERVER_USER} -f 'agent-runner/bin/agent-runner run' >/dev/null 2>&1; then
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
        {},
        `
  id ${SERVER_USER} >/dev/null 2>&1 || useradd --create-home --shell /bin/bash ${SERVER_USER}
`,
      ),
  },
  {
    id: 'tools',
    label: 'git, Node and Chrome',
    as: 'root',
    timeoutMs: 20 * MINUTE,
    script: () =>
      script(
        {},
        `
  . /etc/os-release
  # A server that was just made often installs its own updates in its first minutes: the install waits its turn.
  apt() { apt-get -y -q -o DPkg::Lock::Timeout=600 "$@"; }
  apt update
  apt install git curl ca-certificates xz-utils procps
  dir=$(mktemp -d)
  trap 'rm -rf "$dir"' EXIT

  have=$(${ROOT}/node/bin/node -p 'process.versions.node.split(".")[0]' 2>/dev/null || true)
  if [ "$have" != ${NODE_LINE} ]; then
    arch=x64
    [ "$(uname -m)" = aarch64 ] && arch=arm64
    from=https://nodejs.org/dist/latest-v${NODE_LINE}.x
    curl -fsSL "$from/SHASUMS256.txt" -o "$dir/SHASUMS256.txt"
    file=$(grep -o "node-v[0-9.]*-linux-$arch\\.tar\\.xz" "$dir/SHASUMS256.txt" | head -n 1)
    [ -n "$file" ] || fail "nodejs.org lists no Node ${NODE_LINE} for this server's chip."
    curl -fsSL "$from/$file" -o "$dir/$file"
    (cd "$dir" && grep " $file\\$" SHASUMS256.txt | sha256sum -c - >/dev/null) || fail "The Node that was downloaded is not the one nodejs.org lists."
    rm -rf ${ROOT}/node.new
    mkdir -p ${ROOT}/node.new
    tar -xJf "$dir/$file" -C ${ROOT}/node.new --strip-components=1
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
    id: 'openagent',
    label: 'OpenAgent',
    as: 'root',
    timeoutMs: 20 * MINUTE,
    script: ({ version }) =>
      script(
        { VERSION: version },
        `
  have=$(${ROOT}/node/bin/openagent --version 2>/dev/null || true)
  if [ "$have" != "$VERSION" ]; then
    # No script of a package runs as root: OpenAgent needs none.
    npm install --global --ignore-scripts --no-fund --no-audit --loglevel=error "@openagt/dashboard@$VERSION"
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
        {},
        `
  # Claude Code's own installer, into this user's home: it keeps itself up to date there, as on a laptop.
  command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash
  command -v claude >/dev/null || fail "Claude Code's installer ended without a claude command."
`,
      ),
  },
  {
    id: 'service',
    label: 'The service',
    as: 'root',
    timeoutMs: 3 * MINUTE,
    script: () =>
      script(
        { UNIT: SERVICE_UNIT },
        `
  file=/etc/systemd/system/openagent.service
  if [ "$(cat "$file" 2>/dev/null || true)" != "$UNIT" ]; then
    printf '%s\\n' "$UNIT" > "$file"
    systemctl daemon-reload
    touch ${ROOT}/restart
  fi
  # A firewall that is on lets the door's two ports through; one that is off is left off.
  if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
  fi
  systemctl enable --quiet openagent
  if [ -e ${ROOT}/restart ] || ! systemctl is-active --quiet openagent; then
    systemctl restart openagent
    rm -f ${ROOT}/restart
  fi
  for _ in $(seq 30); do
    curl -fsS -o /dev/null http://127.0.0.1:4200/ 2>/dev/null && exit 0
    sleep 1
  done
  journalctl -u openagent -n 20 --no-pager >&2 || true
  fail "OpenAgent did not start on this server."
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

/** The script that asks the server's door for a link a new machine gets in with. Run as the server's own user. */
export function linkScript(): string {
  return script({}, `\n  ${DOOR} add\n`)
}
