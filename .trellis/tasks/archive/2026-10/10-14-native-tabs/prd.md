# PRD: Use native LuCI tabs like mosdns

## Background

The panel draws its own tab bar (`cbi-tabmenu` + custom `.drcom-tab-btn`
styling). On Kwrt, apps like mosdns show the native LuCI tab row under the
navigation breadcrumb, without the extra border and following the theme
automatically. mosdns achieves this purely through menu registration:

```json
"admin/services/mosdns":          { "action": { "type": "firstchild" } }
"admin/services/mosdns/basic":    { "type": "view", "path": "mosdns/basic" }
"admin/services/mosdns/rules":    { "type": "view", "path": "mosdns/rules" }
...
```

LuCI renders the tab row itself; each tab is a real route.

## Goal

Replace the hand-drawn tabs with native LuCI navigation, matching mosdns.

## Requirements

- R1 Menu registers a parent `admin/services/hstc-drcom-auth` with
  `"type": "firstchild"` and one child per tab, each a `view` under
  `hstc-drcom-auth/<name>`.
- R2 The single view file is split into per-tab modules under
  `resources/view/hstc-drcom-auth/`: `online`, `accounts`, `diag`, `settings`.
- R3 Shared helpers (translation dictionaries, exec helpers, CAS status
  refresh, request/response rendering, interface collection, account
  helpers) move to a common module required by the tab views.
- R4 The custom tab markup/CSS (`drcom-tabs-nav`, `drcom-tab-btn`,
  `drcom-tab-pane`) is removed; no custom tab bar remains.
- R5 Tabs and their order: Online Auth, Accounts, Diagnostics, Settings.
- R6 Every existing control and behaviour is preserved, including
  per-account CAS state, the one-click login, the request/response display
  and the status card.
- R7 The route changes from `drcom-auth` to `hstc-drcom-auth`.

## Acceptance criteria

- `/cgi-bin/luci/admin/services/hstc-drcom-auth` shows the native tab row
  with 4 tabs, each reachable by URL.
- Tab row has no custom border/styling; it matches other mosdns-style apps.
- All four tabs render their content and the previously working actions
  still work (verified on the router).
- No leftover references to the removed custom tab CSS/classes.

## Out of scope

- Changing auth logic or backend commands.
