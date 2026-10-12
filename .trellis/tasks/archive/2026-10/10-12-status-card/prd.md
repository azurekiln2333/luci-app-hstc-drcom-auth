# PRD: Status card and merged account/connect card

## Background

The Online Auth tab currently has: Basic Settings, Account (username/password),
Network Check (with a one-click login button and a result row). The user wants
the account fields, the one-click action and its result together, and a single
status card at the very top so the current state is visible at a glance.

## Goal

Reorganize the Online Auth tab and add a top status card.

## Requirements

- R1 A **Status** card is the first card on the Online Auth tab, showing:
  - network status (reachable / unreachable, based on the ping host)
  - Dr.COM auth status (from the last Dr.COM auth result)
  - CAS auth status (logged in / not logged in)
  - CAS cookie status (cookie present / absent, with mtime when present)
- R2 The account card and the one-click actions are merged into one card:
  username, password, the "Log In and Authenticate" button and its result row.
- R3 The merged card is placed first (before Basic Settings) unless the Status
  card is above it; ordering: Status, Account+Connect, Basic Settings,
  Network Check.
- R4 All four status rows refresh on load and via the existing refresh action;
  no status refresh may refetch CAS params or rebuild the request preview.
- R5 Localized (zh, zh-TW, en).

## Multi-account

- R6 Accounts are stored as multiple UCI sections (`config account 'acc1'`)
  with `option active_account 'acc1'` selecting the one in use.
- R7 A new **Accounts** tab manages accounts: add, edit, delete, and pick the
  active one.
- R8 The Online Auth card shows an account **dropdown** (active account) plus
  a hint linking to the Accounts tab to add a new account.
- R9 The rendered `config.sh` keeps exposing single `USERNAME`/`PASSWORD`
  (from the active account) so the shell scripts need no change; a legacy
  single `main.username`/`main.password` must migrate to an account section.
- R10 CAS state is per account: each account gets its own cookie jar, params
  and login state under `info/accounts/<account>/`. Achieved by making
  `COOKIE_DIR` account-specific in the rendered `config.sh` so
  `cas_auth.sh` needs no change. Raw debug responses may stay shared.

## Acceptance criteria

- Status card appears first with four labelled rows.
- Online Auth shows an account dropdown; the connect button and result are in
  the same card.
- Accounts tab can add/edit/delete and select the active account; the chosen
  account's credentials reach `config.sh` and a login succeeds with it.
- Network status reflects the ping host result; CAS/cookie rows match
  `cas_status` output.
- Verified on the Kwrt router.

## Out of scope

- Backend changes beyond exposing network status (may reuse ping).
