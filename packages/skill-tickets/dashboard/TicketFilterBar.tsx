import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowDownWideNarrow, ArrowUp, ArrowUpNarrowWide, Check, ChevronDown, Search, X } from 'lucide-react'
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
  DropdownMenuItem,
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
    <label className="flex cursor-pointer select-none items-center gap-2 rounded-sm px-1 py-1 text-sm hover:bg-accent/60">
      <Checkbox checked={checked} onCheckedChange={next => onChange(next === true)} aria-label={label} />
      <span className={cn('min-w-0 flex-1 truncate', tone)}>{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
    </label>
  )
}

/** A facet's trigger: its name, and how many of its clauses are active. The PopoverTrigger clones
 *  this with its own handlers via `render`, so everything unknown is forwarded to the Button. */
function FacetTrigger({ label, active, ...props }: { label: string; active: number } & React.ComponentProps<typeof Button>) {
  return (
    <Button variant="outline" size="xs" {...props} className={cn('gap-1', active > 0 && 'border-[var(--color-primary)]/50')}>
      {label}
      {active > 0 && <span className="rounded bg-primary/15 px-1 text-[10px] text-primary">{active}</span>}
      <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
    </Button>
  )
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
      <PopoverTrigger render={<FacetTrigger label={label} active={rangeClauses(filter)} />} />
      <PopoverContent className="w-56">
        <div className="space-y-0.5">
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
        <Separator className="my-2" />
        <RangeRow label={label} buckets={buckets} filter={filter} onChange={onChange} />
        {(counts.none > 0 || filter.none) && (
          <>
            <Separator className="my-2" />
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
      className={cn('px-1', dimmed && 'opacity-40')}
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
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-3 w-3" aria-hidden />
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
  active,
  children,
}: {
  label: string
  active: number
  children: React.ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger render={<FacetTrigger label={label} active={active} />} />
      <PopoverContent className="w-56">
        <div className="space-y-0.5">{children}</div>
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
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          ref={searchRef}
          value={f.q}
          onChange={e => set({ q: e.target.value })}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder="Search tickets…"
          aria-label="Search tickets"
          className="h-7 w-56 pl-7 pr-6 text-xs"
        />
        {!searchFocused && f.q === '' && (
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted/60 px-1 font-mono text-[10px] text-muted-foreground">
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
        <CheckFacet label="Topics" active={f.topics.length + (f.topicsNone ? 1 : 0)}>
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
              <Separator className="my-2" />
              <OptionRow label="No topics" count={topicFacet.none} checked={f.topicsNone} onChange={topicsNone => set({ topicsNone })} />
            </>
          )}
        </CheckFacet>
      )}

      <CheckFacet label="Stage" active={f.stage.length}>
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
          variant="outline"
          size="xs"
          onClick={() => set({ unlinked: !f.unlinked })}
          className={cn(f.unlinked && 'border-[var(--color-primary)]/50 bg-primary/10')}
          aria-pressed={f.unlinked}
        >
          Not linked <span className="text-[10px] text-muted-foreground">{notLinked}</span>
        </Button>
      )}

      {filtered && (
        <Button variant="ghost" size="xs" onClick={() => onChange({ ...view, filters: defaultView().filters })}>
          <X className="h-3 w-3" aria-hidden /> Clear
        </Button>
      )}

      {/* Right side: how the list is ordered (the x/n tally lives beside the page title). */}
      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="xs" className="gap-1">
                Sort: {SORT_LABELS[view.sort.key]}
                {view.sort.dir === 'desc' ? <ArrowDown className="h-3 w-3" aria-hidden /> : <ArrowUp className="h-3 w-3" aria-hidden />}
                <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
              </Button>
            }
          />
          <DropdownMenuContent>
            {(Object.keys(SORT_LABELS) as SortKey[]).map(key => (
              // Picking a key starts it at its natural direction; direction changes are the
              // explicit pair below, not a hidden re-click.
              <DropdownMenuItem
                key={key}
                closeOnClick={false}
                onClick={() => {
                  if (view.sort.key !== key) onChange({ ...view, sort: sortByKey(key) })
                }}
              >
                <span className="flex h-3.5 w-3.5 items-center justify-center">
                  {view.sort.key === key && <Check className="h-3.5 w-3.5" aria-hidden />}
                </span>
                {SORT_LABELS[key]}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {/* The asc/desc pair (#1144 follow-up): two icon buttons, the applied one carrying
                the menu's own highlight tokens, with the current meaning spelled out beside them
                — "descending" says nothing until you know the key. */}
            <div className="flex items-center gap-1 px-2 py-1.5">
              {(['asc', 'desc'] as const).map(dir => (
                <button
                  key={dir}
                  type="button"
                  aria-label={DIR_LABELS[view.sort.key][dir]}
                  aria-pressed={view.sort.dir === dir}
                  onClick={() => onChange({ ...view, sort: { ...view.sort, dir } })}
                  className={cn(
                    'flex h-6 w-7 items-center justify-center rounded-sm hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)]',
                    view.sort.dir === dir && 'bg-[var(--color-accent)] text-[var(--color-accent-foreground)]',
                  )}
                >
                  {dir === 'asc' ? (
                    <ArrowUpNarrowWide className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <ArrowDownWideNarrow className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
              ))}
              <span className="ml-1 text-xs text-muted-foreground">{DIR_LABELS[view.sort.key][view.sort.dir]}</span>
            </div>
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
