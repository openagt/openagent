import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Search, X } from 'lucide-react'
import {
  EFFORT_BUCKETS,
  PRIORITY_BUCKETS,
  STAGES,
  UNCERTAINTY_BUCKETS,
  bucketUnionRange,
  defaultView,
  hasAnyFilter,
  rangeClauses,
  rangeFacetCounts,
  sortByKey,
  stageFacetCounts,
  toggled,
  topicFacetCounts,
  unlinkedCount,
  withBucketToggled,
  withNone,
  withRange,
  type RangeBucket,
  type RangeFilter,
  type SortKey,
  type TicketFilters,
  type TicketRow,
  type TicketsView,
} from './lib/ticket-filter.js'
import {
  cn,
  Button,
  Checkbox,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RangeSlider,
  Separator,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@openagt/dashboard/module'

// The /tickets toolbar (#1144): search, faceted filters, sort, grouping — the page's whole viewing
// state in one row. All state lives in the caller's TicketsView (mirrored to the URL there); this
// component only reads the pool to put counts on the options.

/** A facet option row inside a popover: checkbox, label, count right-aligned. */
function OptionRow({
  label,
  count,
  checked,
  onChange,
  tone,
}: {
  label: string
  count: number
  checked: boolean
  onChange: (next: boolean) => void
  tone?: string | undefined
}) {
  return (
    // The whole row is the target: 32 high, 44 on a phone, as a menu's items are.
    <label className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm select-none transition-colors hover:bg-accent max-md:min-h-11">
      <Checkbox checked={checked} onCheckedChange={next => onChange(next === true)} aria-label={label} />
      <span className={cn('min-w-0 flex-1 truncate', tone)}>{label}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
    </label>
  )
}

/** A ghost chip of the filter row: filled while what it says is applied. */
const CHIP_ON = 'bg-accent text-accent-foreground'

/** A facet's trigger: its name, and once set, what it is set to. The PopoverTrigger clones
 *  this with its own handlers via `render`, so everything unknown is forwarded to the Button. */
function FacetTrigger({ label, value, ...props }: { label: string; value: string | undefined } & React.ComponentProps<typeof Button>) {
  return (
    <Button variant="ghost" {...props} className={cn('gap-1.5', value !== undefined && CHIP_ON)}>
      {label}
      {value !== undefined && <span className="max-w-40 truncate font-normal">{value}</span>}
      <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
    </Button>
  )
}

/** What a set facet says on its chip: the picked options, or the count of them past two. */
function picked(labels: readonly string[]): string | undefined {
  if (labels.length === 0) return undefined
  return labels.length > 2 ? `${labels.length}` : labels.join(', ')
}

/** What a set numeric facet says on its chip: its range, or its picked buckets, and "none". */
function rangeValue(filter: RangeFilter, buckets: readonly RangeBucket[], noneLabel: string): string | undefined {
  const parts = filter.range ? [`${filter.range[0]}–${filter.range[1]}`] : buckets.filter(bucket => filter.buckets.includes(bucket.id)).map(bucket => bucket.label)
  return picked(filter.none ? [...parts, noneLabel] : parts)
}

/**
 * One numeric facet (#1144): quick bucket checkboxes, a fine-grained min-max slider, and the
 * "names no value" row. Buckets and slider drive the same selection, so the update helpers clear
 * one when the other engages; `none` composes with either.
 */
function RangeFacet({
  label,
  noneLabel,
  buckets,
  filter,
  counts,
  onChange,
}: {
  label: string
  noneLabel: string
  buckets: readonly RangeBucket[]
  filter: RangeFilter
  counts: { buckets: Record<string, number>; none: number }
  onChange: (next: RangeFilter) => void
}) {
  return (
    <Popover>
      <PopoverTrigger render={<FacetTrigger label={label} value={rangeValue(filter, buckets, noneLabel)} />} />
      <PopoverContent className="w-56">
        <div>
          {buckets.map(bucket => (
            <OptionRow
              key={bucket.id}
              label={`${bucket.label} (${bucket.min}–${bucket.max})`}
              count={counts.buckets[bucket.id] ?? 0}
              checked={filter.buckets.includes(bucket.id)}
              onChange={() => onChange(withBucketToggled(filter, bucket.id))}
            />
          ))}
        </div>
        <Separator className="my-1" />
        <RangeRow label={label} buckets={buckets} filter={filter} onChange={onChange} />
        {(counts.none > 0 || filter.none) && (
          <>
            <Separator className="my-1" />
            <OptionRow label={noneLabel} count={counts.none} checked={filter.none} onChange={next => onChange(withNone(filter, next))} />
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * A numeric facet's slider. It mirrors the bucket selection whenever it can: a contiguous union
 * (one bucket, or adjacent ones) IS a range, so the thumbs sit on it and dragging refines from
 * there (withRange takes over and clears the buckets). Only a selection that skips a middle
 * bucket — which no [min,max] pair can express — dims the slider; still live, not disabled, so
 * the gray reads as "not currently applied" rather than a dead end.
 */
function RangeRow({
  label,
  buckets,
  filter,
  onChange,
}: {
  label: string
  buckets: readonly RangeBucket[]
  filter: RangeFilter
  onChange: (next: RangeFilter) => void
}) {
  const union = bucketUnionRange(filter, buckets)
  const dimmed = filter.buckets.length > 0 && union === null
  const displayed = filter.range ?? union
  return (
    <div
      className={cn('px-2 py-1', dimmed && 'opacity-40')}
      data-dimmed={dimmed || undefined}
      title={dimmed ? 'The selected buckets skip a middle span — dragging the range replaces them' : undefined}
    >
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Range: {displayed ? `${displayed[0]}–${displayed[1]}` : dimmed ? 'not one span' : 'any'}</span>
        {filter.range && (
          <button
            type="button"
            aria-label={`Clear the ${label.toLowerCase()} range`}
            onClick={() => onChange(withRange(filter, null))}
            className="focus-ring relative rounded-sm text-muted-foreground after:absolute after:-inset-1 hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
      <RangeSlider
        aria-label={`${label} range`}
        value={displayed ?? [0, 10]}
        onValueChange={next => onChange(withRange(filter, next))}
      />
    </div>
  )
}

/** A plain checkbox-list facet (topics, stage, project): options with counts, nothing more. */
function CheckFacet({
  label,
  value,
  children,
}: {
  label: string
  /** What the facet is set to, as its chip says it; none while it is not set. */
  value: string | undefined
  children: React.ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger render={<FacetTrigger label={label} value={value} />} />
      <PopoverContent className="w-56">
        <div>{children}</div>
      </PopoverContent>
    </Popover>
  )
}

const SORT_LABELS: Record<SortKey, string> = { date: 'Date', priority: 'Priority', title: 'Title', effort: 'Effort' }

/** What each direction *means* per key — "descending" says nothing until you know the key. */
const DIR_LABELS: Record<SortKey, Record<'asc' | 'desc', string>> = {
  date: { desc: 'Newest first', asc: 'Oldest first' },
  priority: { desc: 'Highest first', asc: 'Lowest first' },
  title: { asc: 'A to Z', desc: 'Z to A' },
  effort: { asc: 'Easiest first', desc: 'Hardest first' },
}

export function TicketFilterBar({
  view,
  rows,
  onChange,
}: {
  /** The page's viewing state; every control edits a copy and hands it back. */
  view: TicketsView
  /** The full unfiltered pool, for the option counts. */
  rows: TicketRow[]
  onChange: (next: TicketsView) => void
}) {
  const f = view.filters
  const set = (patch: Partial<TicketFilters>) => onChange({ ...view, filters: { ...f, ...patch } })

  // `/` focuses the search from anywhere on the page (unless something is already being typed
  // into) — the shortcut every issue tracker has taught. A keycap chip on the field advertises
  // it, and steps aside once the field is focused or filled.
  const searchRef = useRef<HTMLInputElement>(null)
  const [searchFocused, setSearchFocused] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const topicFacet = topicFacetCounts(rows, f)
  const stageCounts = stageFacetCounts(rows, f)
  const notLinked = unlinkedCount(rows, f)
  const anyEffort = rows.some(r => r.ticket.effort !== undefined)
  const anyUncertainty = rows.some(r => r.ticket.uncertainty !== undefined)
  const filtered = hasAnyFilter(f)

  return (
    <div className="flex flex-wrap items-center gap-1">
      <div className="relative mr-1 max-sm:mr-0 max-sm:mb-1 max-sm:w-full">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          name="search-tickets"
          ref={searchRef}
          value={f.q}
          onChange={e => set({ q: e.target.value })}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder="Search tickets…"
          aria-label="Search tickets"
          className="pr-8 pl-8 sm:w-56"
        />
        {!searchFocused && f.q === '' && (
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded-sm border border-hairline px-1.5 font-mono text-xs text-muted-foreground">
            /
          </kbd>
        )}
      </div>

      <RangeFacet
        label="Priority"
        noneLabel="No priority"
        buckets={PRIORITY_BUCKETS}
        filter={f.priority}
        counts={rangeFacetCounts(rows, f, 'priority')}
        onChange={priority => set({ priority })}
      />

      {(topicFacet.topics.length > 0 || topicFacet.none > 0) && (
        <CheckFacet label="Topics" value={picked(f.topicsNone ? [...f.topics, 'No topics'] : f.topics)}>
          {topicFacet.topics.map(([topic, count]) => (
            <OptionRow
              key={topic}
              label={topic}
              count={count}
              checked={f.topics.includes(topic)}
              onChange={() => set({ topics: toggled(f.topics, topic) })}
            />
          ))}
          {(topicFacet.none > 0 || f.topicsNone) && (
            <>
              <Separator className="my-1" />
              <OptionRow label="No topics" count={topicFacet.none} checked={f.topicsNone} onChange={topicsNone => set({ topicsNone })} />
            </>
          )}
        </CheckFacet>
      )}

      <CheckFacet label="Stage" value={picked(STAGES.filter(stage => f.stage.includes(stage.id)).map(stage => stage.label))}>
        {STAGES.map(stage => (
          <OptionRow
            key={stage.id}
            label={stage.label}
            count={stageCounts[stage.id]}
            checked={f.stage.includes(stage.id)}
            onChange={() => set({ stage: toggled(f.stage, stage.id) as typeof f.stage })}
          />
        ))}
      </CheckFacet>

      {(anyEffort || rangeClauses(f.effort) > 0) && (
        <RangeFacet
          label="Effort"
          noneLabel="No effort"
          buckets={EFFORT_BUCKETS}
          filter={f.effort}
          counts={rangeFacetCounts(rows, f, 'effort')}
          onChange={effort => set({ effort })}
        />
      )}

      {(anyUncertainty || rangeClauses(f.uncertainty) > 0) && (
        <RangeFacet
          label="Uncertainty"
          noneLabel="No uncertainty"
          buckets={UNCERTAINTY_BUCKETS}
          filter={f.uncertainty}
          counts={rangeFacetCounts(rows, f, 'uncertainty')}
          onChange={uncertainty => set({ uncertainty })}
        />
      )}

      {(notLinked > 0 || f.unlinked) && (
        <Button
          variant="ghost"
          onClick={() => set({ unlinked: !f.unlinked })}
          className={cn(f.unlinked && CHIP_ON)}
          aria-pressed={f.unlinked}
          title={`${notLinked} not linked to an issue`}
        >
          Not linked
        </Button>
      )}

      {filtered && (
        <Button variant="ghost" className="text-muted-foreground" onClick={() => onChange({ ...view, filters: defaultView().filters })}>
          <X className="size-4" aria-hidden /> Clear
        </Button>
      )}

      {/* Right side: how the list is ordered (the x/n tally lives beside the page title). */}
      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" className="gap-1.5">
                Sort: {SORT_LABELS[view.sort.key]}
                {view.sort.dir === 'desc' ? <ArrowDown className="size-3.5" aria-hidden /> : <ArrowUp className="size-3.5" aria-hidden />}
                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
              </Button>
            }
          />
          <DropdownMenuContent>
            {/* A key starts at its natural direction; the direction is the pair under the keys, each
                saying what it means for the key ("descending" says nothing until you know the key). */}
            {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
              <DropdownMenuCheckboxItem
                key={key}
                closeOnClick={false}
                checked={view.sort.key === key}
                onCheckedChange={() => {
                  if (view.sort.key !== key) onChange({ ...view, sort: sortByKey(key) })
                }}
              >
                {SORT_LABELS[key]}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            {(['desc', 'asc'] as const).map(dir => (
              <DropdownMenuCheckboxItem
                key={dir}
                closeOnClick={false}
                checked={view.sort.dir === dir}
                onCheckedChange={() => onChange({ ...view, sort: { ...view.sort, dir } })}
              >
                {DIR_LABELS[view.sort.key][dir]}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={view.group === 'project'}
              onCheckedChange={() => onChange({ ...view, group: view.group === 'project' ? 'none' : 'project' })}
            >
              Group by project
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
