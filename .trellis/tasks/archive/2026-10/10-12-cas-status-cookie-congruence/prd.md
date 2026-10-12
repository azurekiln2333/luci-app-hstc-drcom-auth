# PRD: CAS status congruence

## Background

The CAS card can show two contradictory states at once:

- Fetch-params reports `diagnosis=already logged in` (the server redirected
  `/cas/login` to a success page, meaning a CAS session is active).
- The cookie row reports `无效或已过期，请重新登录` (invalid/expired).

Two independent checks produce these:

- `fetch_cas_params` looks at the fetched login page: if it shows a success
  page instead of the `fm1` form, it concludes "already logged in" (rc=2).
- `cas_status` -> `cas_cookie_valid` looks only at the local
  `info/cas_cookie.txt` file: no `TGC` entry means "invalid".

When the local cookie file is absent/cleared (e.g. after `cas_logout`) but the
server still holds the session, the two disagree. The user cannot tell whether
they are logged in.

## Goal

Report a single, coherent session state in the CAS card and via `cas_status`.

## Requirements

- R1 `cas_status` must not report `cookie=invalid` while also reporting that a
  server session is active. The two must be reconcilable.
- R2 Introduce an explicit session state that the panel can render, covering:
  - `active` - a usable session exists (local cookie valid, or the server
    reports an active session).
  - `inactive` - no local cookie and the server does not report an active
    session.
  - `unknown` - the state could not be determined (e.g. network error).
- R3 The panel must show one localized status string per state, in zh /
  zh-TW / en, instead of the current two possibly-contradictory rows.
- R4 Rejecting a login is unchanged: a genuine failure still surfaces via
  `diagnosis=`.
- R5 `cas_logout` must make the reported state `inactive` and a fresh
  `cas_login` must make it `active`.

## Acceptance criteria

- With a valid local cookie: `cas_status` reports state `active`.
- With no local cookie but a server-active session: `cas_status` reports state
  `active` (session active), not "invalid".
- With no local cookie and no server session: `cas_status` reports state
  `inactive`.
- After `cas_logout` the panel shows the inactive/not-logged-in state.
- Panel states are localized in zh / zh-TW / en.
- Verified on the Kwrt router.

## Out of scope

- Dr.COM (non-CAS) flow.
- Automatic background re-login (already covered by `ensure`).
