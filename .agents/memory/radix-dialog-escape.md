---
name: Radix Dialog Escape interception
description: How to stop a Radix Dialog from closing on Escape when a child (e.g. an inline text editor) needs Escape for its own purpose.
---

A child element inside a Radix `DialogContent` cannot prevent the dialog from
closing on Escape by calling `e.stopPropagation()` or even
`e.nativeEvent.stopImmediatePropagation()` in its own React `onKeyDown`. Radix's
dismiss layer listens for Escape at the document level (outside React's
synthetic event flow / before the bubble reaches the child's handler), so those
calls do not reliably suppress the close.

**The reliable fix:** handle it at the `DialogContent` level via the
`onEscapeKeyDown` prop and `e.preventDefault()` conditionally. To know whether the
child is in a state that needs Escape (e.g. inline editing), lift that state to
the parent as a ref: the child reports changes via an `onEditingChange` callback,
the parent stores it in a `useRef`, and `onEscapeKeyDown` checks `ref.current`.
Use a ref (not state) so the handler always reads the current value without
re-subscribing.

**Why:** Radix Escape handling is document-level and runs ahead of child React
handlers; only the component that owns the dialog can cancel its dismiss.

**How to apply:** Any time a Dialog/Popover/Drawer from Radix wraps an inline
editor, modal-within-modal, or anything that wants Escape, gate the dismiss at
the content node with a ref-backed flag rather than fighting event propagation
in the child.
