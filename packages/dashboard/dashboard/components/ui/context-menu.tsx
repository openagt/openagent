import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu'

// A right-click menu: Base UI's, opened where the pointer is. Its contents are the dropdown menu's
// own parts (`DropdownMenuContent`, `DropdownMenuItem`, a submenu), which are Base UI's menu parts
// too, so a right-click menu looks and behaves as every other menu of the dashboard.
export const ContextMenu = BaseContextMenu.Root
export const ContextMenuTrigger = BaseContextMenu.Trigger
