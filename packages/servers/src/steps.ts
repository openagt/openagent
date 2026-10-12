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

/** Where the server keeps the Claude login: root's file, which the service reads as it starts. An agent on the server works with the login, and so can read it; it cannot change the file. */
export const CLAUDE_FILE = '/etc/openagent/claude.env'
/** The name Claude Code reads a login under that was made for a computer nobody sits at. */
const CLAUDE_NAME = 'CLAUDE_CODE_OAUTH_TOKEN'

/** The door's own command, inside the OpenAgent the install brought. */
const DOOR = `${ROOT}/node/bin/node ${ROOT}/node/lib/node_modules/@openagt/dashboard/node_modules/@openagt/remote-access/bin/remote-access`

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

/** What the service file holds. `KillMode=process`: a run is a process of its own and goes on when OpenAgent starts again, as on a laptop. */
export const SERVICE_UNIT = `[Unit]
Description=OpenAgent
After=network-online.target
Wants=network-online.target

[Service]
User=${SERVER_USER}
WorkingDirectory=/home/${SERVER_USER}
Environment=PATH=/home/${SERVER_USER}/.local/bin:${ROOT}/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=-${CLAUDE_FILE}
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
  apt install git curl ca-certificates xz-utils procps
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
  have=$(${ROOT}/node/bin/node -p 'require("${ROOT}/node/lib/node_modules/@openagt/dashboard/package.json").version' 2>/dev/null || true)
  if [ "$have" != "$VERSION" ]; then
    ${ROOT}/node/bin/npm install --global --ignore-scripts --no-fund --no-audit --loglevel=error "@openagt/dashboard@$VERSION"
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
    id: 'service',
    label: 'The service',
    as: 'root',
    timeoutMs: 3 * MINUTE,
    script: () =>
      script(
        'root',
        { UNIT: SERVICE_UNIT },
        `${STARTED}
  file=/etc/systemd/system/openagent.service
  if [ "$(cat "$file" 2>/dev/null || true)" != "$UNIT" ]; then
    printf '%s\\n' "$UNIT" > "$file"
    systemctl daemon-reload
    touch ${ROOT}/restart
  fi
  # A firewall that is on lets the door's two ports through; one that is off is left off.
  if command -v ufw >/dev/null && ufw status | grep '^Status: active' >/dev/null; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
  fi
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

/** The script that asks the server's door for a link a new machine gets in with. Run as the server's own user. */
export function linkScript(): string {
  return script(SERVER_USER, {}, `\n  ${DOOR} add\n`)
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
    asking "$pid" || break
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
