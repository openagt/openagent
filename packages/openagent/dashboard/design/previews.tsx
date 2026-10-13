import type { ReactNode } from 'react'
import { Button } from '../components/ui/button.js'
import { Badge } from '../components/ui/badge.js'
import { Card, CardContent, CardHeader, CardTitle, CardTitleLink } from '../components/ui/card.js'
import { Checkbox } from '../components/ui/checkbox.js'
import { Input } from '../components/ui/input.js'
import { Label } from '../components/ui/label.js'
import { RadioGroup, RadioGroupItem, RadioGroupOption } from '../components/ui/radio-group.js'
import { Select, SelectTrigger, SelectValue } from '../components/ui/select.js'
import { Switch } from '../components/ui/switch.js'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table.js'
import { Textarea } from '../components/ui/textarea.js'
import { OptionLabel } from '../components/ui/option-label.js'
import { DisclosureToggle } from '../components/DisclosureToggle.js'

// The gallery's card registry (#DESIGN). Every entry renders the REAL component wherever the
// component can stand alone, so a card cannot quietly drift from what ships. The few that cannot
// (portalled tooltips, anything behind an RPC read) are marked `replica` and say so on the
// card, because a silent hand-copy is exactly the drift this gallery exists to catch.

export interface Preview {
  path: string
  group: string
  name: string
  subtitle: string
  width: number
  height?: number
  /** True when the markup is a hand-copy rather than the shipped component. */
  replica?: boolean
  node: ReactNode
}

/** A labelled row inside a card. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------- foundations

const TOKENS = [
  ['--background', 'Page canvas'],
  ['--foreground', 'Body text'],
  ['--card', 'Raised surface'],
  ['--card-foreground', 'Text on card'],
  ['--muted', 'Recessed fill'],
  ['--muted-foreground', 'Secondary text'],
  ['--border', 'Hairlines'],
  ['--primary', 'Brand / action'],
  ['--primary-foreground', 'Text on primary'],
  ['--accent', 'Hover fill'],
  ['--accent-foreground', 'Text on accent'],
  ['--success', 'Done, passing'],
  ['--warning', 'Stopped, dirty'],
  ['--danger', 'Failed, destructive'],
  ['--info', 'Unpushed, neutral note'],
] as const

function ColorTokens() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {TOKENS.map(([token, use]) => (
        <div key={token} className="flex items-center gap-3">
          <div
            className="h-10 w-10 shrink-0 rounded-md border border-border"
            style={{ background: `var(${token})` }}
          />
          <div className="min-w-0">
            <div className="truncate font-mono text-xs">{token}</div>
            <div className="truncate text-xs text-muted-foreground">{use}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// The status vocabulary, now tokenised. Each is tuned per theme against that theme's canvas
// rather than picked once from the middle of a palette ramp.
const STATUS = [
  ['Done / passing', 'bg-success', '--success'],
  ['Failed / destructive', 'bg-danger', '--danger'],
  ['Stopped / warning', 'bg-warning', '--warning'],
  ['Unpushed / informational', 'bg-info', '--info'],
  ['Running / live', 'bg-primary', '--primary'],
] as const

function StatusPalette() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {STATUS.map(([label, fill, value]) => (
          <div key={label} className="flex items-center gap-2.5">
            <span className={`h-8 w-8 shrink-0 rounded-md ${fill}`} />
            <div className="min-w-0">
              <div className="truncate text-xs font-medium">{label}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">{value}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        One token per meaning. Before these existed &quot;good&quot; was six different greens and
        <code> amber-500</code> meant both &quot;stopped&quot; and &quot;building, fine&quot;.
      </p>
    </div>
  )
}

const TYPE = [
  ['text-2xl font-semibold tabular-nums', 'KPI value', '24px / 600'],
  ['text-xl font-semibold', 'Page title', '20px / 600'],
  ['text-sm font-semibold', 'Card title', '14px / 600'],
  ['text-sm', 'Body', '14px / 400'],
  ['text-xs text-muted-foreground', 'Meta, captions', '12px / 400'],
  ['text-xs font-medium uppercase tracking-wide text-muted-foreground', 'Tile label', '12px / 500 caps'],
] as const

function TypeScale() {
  return (
    <div className="space-y-3">
      {TYPE.map(([cls, label, spec]) => (
        <div key={label} className="flex items-baseline justify-between gap-4 border-b border-border pb-2 last:border-0">
          <span className={cls}>{label}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{spec}</span>
        </div>
      ))}
    </div>
  )
}

function RadiusScale() {
  const radii = [
    ['rounded-sm', 'Chart bars'],
    ['rounded', 'Icon buttons'],
    ['rounded-md', 'Buttons, inputs'],
    ['rounded-lg', 'Cards'],
    ['rounded-full', 'Pills, dots'],
  ] as const
  return (
    <div className="flex flex-wrap gap-4">
      {radii.map(([cls, use]) => (
        <div key={cls} className="flex flex-col items-center gap-1.5">
          <div className={`h-12 w-12 border border-border bg-muted ${cls}`} />
          <span className="font-mono text-xs">{cls}</span>
          <span className="text-xs text-muted-foreground">{use}</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- components

function Buttons() {
  return (
    <div className="space-y-5">
      <Row label="Variants">
        <Button>Start agent</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
      </Row>
      <Row label="Sizes">
        <Button size="default">Default</Button>
        <Button size="sm">Small</Button>
        <Button size="xs">Extra small</Button>
        <Button size="icon" aria-label="Icon">
          <span className="text-xs">IC</span>
        </Button>
        <Button size="icon-sm" aria-label="Icon small">
          <span className="text-[10px]">S</span>
        </Button>
      </Row>
      <Row label="States">
        <Button disabled>Disabled</Button>
        <Button variant="outline" disabled>
          Disabled outline
        </Button>
      </Row>
      <p className="text-xs text-muted-foreground">
        There is no destructive variant, so every irreversible action in the app (remove worktree,
        delete preset, stop a run) is styled ad hoc at the call site.
      </p>
    </div>
  )
}

function Badges() {
  return (
    <div className="space-y-5">
      <Row label="Event kinds">
        <Badge>driver</Badge>
        <Badge>tool</Badge>
        <Badge>gate</Badge>
        <Badge>end</Badge>
      </Row>
      <Row label="Status (as used today)">
        <Badge className="border-transparent bg-success/15 text-success">DONE</Badge>
        <Badge className="border-transparent bg-danger/15 text-danger">FAILED</Badge>
        <Badge className="border-transparent bg-warning/15 text-warning">STOPPED</Badge>
        <Badge className="border-transparent bg-primary/15 text-primary">RUNNING</Badge>
      </Row>
      <p className="text-xs text-muted-foreground">
        The Badge primitive carries no variant prop, so status colouring is applied by hand at each
        call site — the reason the same status reads differently in different rails.
      </p>
    </div>
  )
}

function Cards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Agent activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Header plus content, the dashboard default.</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Active agents
          </div>
          <div className="text-2xl font-semibold tabular-nums text-primary">3</div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatTiles() {
  const tiles = [
    ['Projects', 12, false],
    ['Active agents', 3, true],
    ['Queue entries', 47, false],
    ['Total agents', 218, false],
  ] as const
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {tiles.map(([label, value, accent]) => (
        <Card key={label}>
          <CardContent className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </div>
            <div className={`text-2xl font-semibold tabular-nums${accent ? ' text-primary' : ''}`}>{value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

const UNITS = [
  { value: 'h', label: 'hours' },
  { value: 'd', label: 'days' },
]

/** The fields a form is made of. Every one is the shipped component; the select's list is portalled at runtime, so only its trigger shows here. */
function FormControls() {
  return (
    <div className="space-y-5">
      <Row label="Radio group: one pick among a few that stay in view">
        <RadioGroup aria-label="Wait after a start" defaultValue="skill">
          <RadioGroupOption value="skill">
            As the skill says <span className="text-xs text-muted-foreground">(6 hours)</span>
          </RadioGroupOption>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="every" aria-label="A wait you set" />
            <Input type="number" defaultValue={6} aria-label="How long" className="h-8 w-20 px-2" />
            <span className="text-sm">hours</span>
          </div>
          <RadioGroupOption value="work">No wait</RadioGroupOption>
        </RadioGroup>
      </Row>
      <Row label="Radio group, disabled">
        <RadioGroup aria-label="Disabled" defaultValue="a" disabled>
          <RadioGroupOption value="a">Picked</RadioGroupOption>
          <RadioGroupOption value="b">Not picked</RadioGroupOption>
        </RadioGroup>
      </Row>
      <Row label="Select: one pick from a list that opens (trigger shown; the list is a menu popup)">
        <Select items={UNITS} defaultValue="h">
          <SelectTrigger aria-label="Unit" className="w-36">
            <SelectValue />
          </SelectTrigger>
        </Select>
        <Select items={UNITS} defaultValue="d">
          <SelectTrigger size="sm" aria-label="Unit, small" className="w-28">
            <SelectValue />
          </SelectTrigger>
        </Select>
        <Select items={UNITS} defaultValue="h" disabled>
          <SelectTrigger size="sm" aria-label="Unit, disabled" className="w-28">
            <SelectValue />
          </SelectTrigger>
        </Select>
      </Row>
      <Row label="Switch: on or off, at once. Checkbox: one line of a form or a list">
        <Switch aria-label="On" defaultChecked />
        <Switch aria-label="Off" />
        <Switch aria-label="Disabled" disabled />
        <Checkbox aria-label="Ticked" defaultChecked />
        <Checkbox aria-label="Not ticked" />
        <Checkbox aria-label="Disabled" disabled />
      </Row>
      <Row label="Label, input, textarea">
        <div className="w-full max-w-md space-y-2">
          <Label htmlFor="ds-name">
            A name <span className="text-xs text-muted-foreground">optional</span>
          </Label>
          <Input id="ds-name" placeholder="answer-comments" />
          <Label htmlFor="ds-prompt">What the agent is told</Label>
          <Textarea id="ds-prompt" rows={3} placeholder="Answer each new comment below." />
          <Input disabled placeholder="Disabled" />
        </div>
      </Row>
    </div>
  )
}

/** A list with columns, and a card whose title opens the card's page. */
function Tables() {
  return (
    <div className="space-y-5">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Status</TableHead>
            <TableHead>Asked</TableHead>
            <TableHead className="text-right">Cost</TableHead>
            <TableHead>Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="text-success">done</TableCell>
            <TableCell>/plan-tickets</TableCell>
            <TableCell className="text-right tabular-nums">$0.15</TableCell>
            <TableCell className="text-muted-foreground">4h ago</TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="text-danger">failed</TableCell>
            <TableCell>/triage quick</TableCell>
            <TableCell className="text-right tabular-nums">$0.15</TableCell>
            <TableCell className="text-muted-foreground">1d ago</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitleLink segment="queue" onOpen={() => {}}>
            A card whose title opens its page
          </CardTitleLink>
          <p className="text-xs text-muted-foreground">The arrow shows on hover and focus, and always on a phone.</p>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">A summary; the whole is on the page.</p>
        </CardContent>
      </Card>
    </div>
  )
}

function Disclosures() {
  return (
    <div className="space-y-3">
      <DisclosureToggle open={false} onToggle={() => {}}>
        See actual prompt sent
      </DisclosureToggle>
      <DisclosureToggle open onToggle={() => {}}>
        Context (open)
      </DisclosureToggle>
      <div className="pt-2">
        <OptionLabel label="Worktree" description="Run each session in its own git worktree" />
      </div>
    </div>
  )
}

// Tooltip and dropdown popups are portalled, so they render to nothing server-side. These use the
// popup's exact class string from ui/tooltip.tsx — a replica, flagged as one on the card.
function Overlays() {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="rounded-md border border-border bg-card px-2 py-1 text-xs text-card-foreground shadow-md">
        Copy branch name
      </div>
      <div className="min-w-48 rounded-md border border-border bg-card p-1 text-card-foreground shadow-md">
        <div className="rounded-sm px-2 py-1.5 text-sm">
          <OptionLabel label="Autopilot" description="Accept safe edits without asking" />
        </div>
        <div className="rounded-sm bg-accent px-2 py-1.5 text-sm text-accent-foreground">
          <OptionLabel label="Eco" description="Prefer the cheaper model" />
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- data display

function EmptyStates() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardContent>
          <p className="text-sm text-muted-foreground">No finished agents yet.</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted-foreground">Nothing on the agent queue.</p>
          <Button size="sm" variant="outline">
            Add an entry
          </Button>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Empty states are bare sentences today: no icon, no explanation of what would fill the space,
        and only sometimes a next action.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- registry

export const PREVIEWS: Preview[] = [
  {
    path: 'foundations/color-tokens.html',
    group: 'Foundations',
    name: 'Color tokens',
    subtitle: '15 semantic tokens, light + dark',
    width: 900,
    node: <ColorTokens />,
  },
  {
    path: 'foundations/status-palette.html',
    group: 'Foundations',
    name: 'Status palette',
    subtitle: 'One token per meaning, tuned per theme',
    width: 900,
    node: <StatusPalette />,
  },
  {
    path: 'foundations/typography.html',
    group: 'Foundations',
    name: 'Type scale',
    subtitle: '6 roles from KPI value to caption',
    width: 900,
    node: <TypeScale />,
  },
  {
    path: 'foundations/radius.html',
    group: 'Foundations',
    name: 'Radius scale',
    subtitle: '5 steps, sm through full',
    width: 900,
    node: <RadiusScale />,
  },
  {
    path: 'components/button.html',
    group: 'Components',
    name: 'Button',
    subtitle: '3 variants, 5 sizes, disabled',
    width: 900,
    node: <Buttons />,
  },
  {
    path: 'components/badge.html',
    group: 'Components',
    name: 'Badge',
    subtitle: 'Event kinds and status pills',
    width: 900,
    node: <Badges />,
  },
  {
    path: 'components/card.html',
    group: 'Components',
    name: 'Card',
    subtitle: 'Header + content, and the bare tile form',
    width: 900,
    node: <Cards />,
  },
  {
    path: 'components/stat-tile.html',
    group: 'Components',
    name: 'Stat tile',
    subtitle: 'The Overview KPI row, accent on active',
    width: 900,
    node: <StatTiles />,
  },
  {
    path: 'components/form-controls.html',
    group: 'Components',
    name: 'Form controls',
    subtitle: 'Radio group, select, switch, checkbox, label, input, textarea',
    width: 900,
    node: <FormControls />,
  },
  {
    path: 'components/table.html',
    group: 'Components',
    name: 'Table + card title link',
    subtitle: 'A list with columns, and a card that opens its page',
    width: 900,
    node: <Tables />,
  },
  {
    path: 'components/disclosure.html',
    group: 'Components',
    name: 'Disclosure + option label',
    subtitle: 'Collapsible toggles and menu labels',
    width: 900,
    node: <Disclosures />,
  },
  {
    path: 'components/overlays.html',
    group: 'Components',
    name: 'Tooltip + menu popup',
    subtitle: 'Portalled surfaces (replica)',
    width: 900,
    replica: true,
    node: <Overlays />,
  },
  {
    path: 'patterns/empty-states.html',
    group: 'Patterns',
    name: 'Empty states',
    subtitle: 'What the rails show with no data',
    width: 900,
    node: <EmptyStates />,
  },
]
