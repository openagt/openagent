// Try this checkout on a server before anything is published: `pnpm try-on-server <address>`.
//
// It does what the server's Update does, with this checkout's build in place of npm's: it packs
// `@openagt/start` and every package of this repository it needs, as a publish would pack them,
// copies them to the server, installs them there with npm taking OpenAgent's own packages from
// these files (a version not on npm yet installs too), and starts OpenAgent again.
//
// What it installs says `-dev.<commit>` after its version, in the server's page too, so the next
// Update replaces all of it with what npm has. The server's user and how it is reached are the
// saved server's, as Settings > Devices set them up: root over SSH with this computer's key.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const [address, ...rest] = process.argv.slice(2)
if (!address || address.startsWith('-')) {
  console.error('usage: pnpm try-on-server <server address> [--no-build]')
  process.exit(1)
}
const build = !rest.includes('--no-build')

const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
const changed = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim() !== ''
// A build with changes not committed says so: the commit alone would name code it does not hold.
const mark = `dev.${commit}${changed ? '.changed' : ''}`

/** The saved server's user, as Settings > Devices set it up; root when it is not saved here. */
function userAt(at) {
  const file = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'openagent-servers.json') : join(homedir(), '.openagent-servers.json')
  if (!existsSync(file)) return 'root'
  const saved = JSON.parse(readFileSync(file, 'utf8')).servers?.find(server => server.address === at)
  return saved?.user ?? 'root'
}
const login = `${userAt(address)}@${address}`

/** Every package of the repository by its name: its folder and what it says of itself. */
const packages = new Map()
// The same folders as pnpm-workspace.yaml: the drivers sit one level deeper.
for (const parent of ['packages', join('packages', 'agent-driver')]) {
  for (const folder of readdirSync(join(repo, parent))) {
    const file = join(repo, parent, folder, 'package.json')
    if (!existsSync(file)) continue
    const manifest = JSON.parse(readFileSync(file, 'utf8'))
    if (!manifest.private) packages.set(manifest.name, { dir: join(repo, parent, folder), manifest })
  }
}

/** `@openagt/start` and every package of the repository it needs, however deep. */
const needed = new Set()
const visit = name => {
  if (needed.has(name)) return
  // One left out would come from npm, and pass for this build under its stamp.
  if (!packages.has(name)) throw new Error(`${name} is a workspace package this script did not find`)
  needed.add(name)
  const { dependencies = {}, optionalDependencies = {} } = packages.get(name).manifest
  for (const [dep, spec] of Object.entries({ ...dependencies, ...optionalDependencies })) if (String(spec).startsWith('workspace:')) visit(dep)
}
visit('@openagt/start')

const run = (cmd, args, opts = {}) => {
  const done = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (done.status !== 0) {
    console.error(`\n${cmd} ${args.join(' ')} failed`)
    process.exit(done.status ?? 1)
  }
}

if (build) {
  console.log('Building this checkout…')
  run('pnpm', ['build'], { cwd: repo })
}

console.log(`Packing ${needed.size} packages…`)
const packed = mkdtempSync(join(tmpdir(), 'try-on-server-'))
/** Each package's packed file by its name, as the server gets it. */
const files = {}
for (const name of needed) {
  const before = new Set(readdirSync(packed))
  // pnpm, as a publish packs: it writes the real versions in place of `workspace:*`.
  run('pnpm', ['pack', '--pack-destination', packed], { cwd: packages.get(name).dir, stdio: ['ignore', 'ignore', 'inherit'] })
  const file = readdirSync(packed).find(entry => !before.has(entry))
  if (!file) throw new Error(`pnpm pack wrote nothing for ${name}`)
  files[name] = file
}

// On the server: a folder of its own where npm installs start with OpenAgent's packages taken from
// these files, then that whole tree takes the installed one's place, the old one kept until the new
// one is in. Run as root with --ignore-scripts, as the install does: nothing a package brought runs as root.
const ROOT = '/opt/openagent'
const AWAY = '/tmp/openagent-try'
const overrides = Object.fromEntries(Object.entries(files).filter(([name]) => name !== '@openagt/start').map(([name, file]) => [name, `file:${AWAY}/${file}`]))
const manifest = { private: true, dependencies: { '@openagt/start': `file:${AWAY}/${files['@openagt/start']}` }, overrides }
const remote = `set -eu
ROOT=${ROOT}
NM=$ROOT/node/lib/node_modules
STAGE=${AWAY}/stage
rm -rf "$STAGE" && mkdir -p "$STAGE"
cat > "$STAGE/package.json" <<'MANIFEST'
${JSON.stringify(manifest, null, 2)}
MANIFEST
cd "$STAGE"
PATH=$ROOT/node/bin:$PATH npm install --ignore-scripts --no-fund --no-audit --loglevel=error --install-strategy=shallow
NEW="$NM/@openagt/start.try"
rm -rf "$NEW"
cp -a "$STAGE/node_modules/@openagt/start" "$NEW"
# Every version this build brought says it is a try: npm's own then never passes for it at the next Update.
$ROOT/node/bin/node -e '
  const { readdirSync, readFileSync, writeFileSync, existsSync } = require("fs")
  const { join } = require("path")
  const stamp = dir => {
    const file = join(dir, "package.json")
    const manifest = JSON.parse(readFileSync(file, "utf8"))
    manifest.version = manifest.version.replace(/-.*$/, "") + "-${mark}"
    writeFileSync(file, JSON.stringify(manifest, null, 2) + "\\n")
  }
  const walk = dir => {
    stamp(dir)
    const ours = join(dir, "node_modules", "@openagt")
    if (existsSync(ours)) for (const name of readdirSync(ours)) walk(join(ours, name))
  }
  walk(process.argv[1])
' "$NEW"
rm -rf "$NM/@openagt/start.old"
mv "$NM/@openagt/start" "$NM/@openagt/start.old"
mv "$NEW" "$NM/@openagt/start"
rm -rf "$NM/@openagt/start.old" "$STAGE"
ln -sf $ROOT/node/bin/openagent /usr/local/bin/openagent
systemctl restart openagent
for unit in $(systemctl list-units --type=service --state=active --plain --no-legend 'openagent-person@*' | awk '{print $1}'); do systemctl restart "$unit"; done
for i in $(seq 1 30); do systemctl is-active --quiet openagent && break; sleep 1; done
systemctl is-active --quiet openagent || { echo "OpenAgent did not start again: journalctl -u openagent says:"; journalctl -u openagent -n 30 --no-pager; exit 1; }
echo "OpenAgent $($ROOT/node/bin/node -p "require('$NM/@openagt/start/package.json').version") runs on the server."
`

console.log(`Copying them to ${login}…`)
run('ssh', ['-o', 'BatchMode=yes', login, `rm -rf ${AWAY} && mkdir -p ${AWAY}`])
run('scp', ['-q', '-o', 'BatchMode=yes', ...Object.values(files).map(file => join(packed, file)), `${login}:${AWAY}/`])
console.log('Installing them there and starting OpenAgent again…')
run('ssh', ['-o', 'BatchMode=yes', login, 'bash -s'], { input: remote, stdio: ['pipe', 'inherit', 'inherit'] })
run('ssh', ['-o', 'BatchMode=yes', login, `rm -rf ${AWAY}`])
rmSync(packed, { recursive: true, force: true })
console.log(`Done: ${basename(repo)} at ${commit}${changed ? ' with changes not committed' : ''} runs on ${address}. The next Update there puts npm's back.`)
