# PRD: Split the panel into three tabs

## Background

The LuCI page is currently one long scroll of six cards. Daily-use controls
(WAN, account, network check) are mixed with rarely-used diagnostics
(authorize URL, CAS request preview, manual auth) and one-off settings
(language, server addresses).

## Goal

Reorganize into three tabs, keeping every existing control and behavior.

## Tabs

### Tab 1 - Online Auth
Daily-use configuration:
- Basic Settings card: WAN interface, device type
- Account card: username, password
- Network Check card: enable, check interval, ping host

### Tab 2 - Diagnostics
Manual actions and inspection:
- Web authorize URL card (fetch authorize URL + status)
- CAS card: CAS URL, public key URL, update public key, CAS login
  parameters (fetch), assembled request preview, login, login status,
  logout
- Dr.COM auth card: Authenticate button + status

### Tab 3 - Settings
- Language
- Server card: Dr.COM server IP, User-Agent

## Requirements

- R1 Three tabs, labeled (zh): 上网认证 / 诊断 / 设置; localized in zh,
  zh-TW, en.
- R2 Every existing option, button and status row is preserved and still
  works.
- R3 The CAS request preview still renders on initial load and after the
  params button; status refreshes still never rebuild it.
- R4 Remember the last selected tab within the page session (no reload
  required to switch).

## Out of scope

- Changing any auth logic or backend command.
