// A menu item's label with a short one-line description under it (#654). Shared by the
// options and Commands menus so they read identically. Lives in ui/ so a menu
// can use it without dragging in another menu's module (and its preference wiring).
export function OptionLabel({ label, description }: { label: string; description?: string | undefined }) {
  return (
    <span className="flex flex-col">
      <span className="leading-5">{label}</span>
      {description && (
        <span data-line2 className="text-xs leading-4 font-normal text-[var(--color-muted-foreground)]">
          {description}
        </span>
      )}
    </span>
  )
}
