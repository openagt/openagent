// A menu item's label with a short one-line description under it (#654). Shared by the
// options, notifications, and Commands menus so they read identically. Lives in ui/ so a menu
// can use it without dragging in another menu's module (and its preference wiring).
export function OptionLabel({ label, description }: { label: string; description?: string | undefined }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="leading-tight">{label}</span>
      {description && <span className="text-xs font-normal text-[var(--color-muted-foreground)]">{description}</span>}
    </span>
  )
}
