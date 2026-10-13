# PRD: Correct Dr.COM online detection

## Background

`portal_status` decided online/offline from the `Dr.COMWebLoginID_N` marker,
assuming 1 = login page. On the real HSTC portal the page **always** carries
`<!--Dr.COMWebLoginID_1.htm-->` (it is the default page template), while the
login/logout endpoints appear as plain JS constants
(`authloginpath`, `authlogoutpath`, `authsuccess`, `authfail`). So an online
session was reported as offline.

Evidence from the live portal while online:

```
time='6091'      // remaining seconds, increases over time
flow='1239356630' // traffic, increases
uid='202411039159'
v4ip='192.168.101.190'
stime='2026-10-13 10:02:02'   // session start
etime='2026-10-13 12:00:18'   // session end
lip='192.168.33.128'
```

## Goal

Report the true online state.

## Requirements

- R1 Treat the session as **online** when the page has a non-empty `uid` and a
  non-empty `stime`, and either:
  - `etime` is in the future, or
  - `time` (remaining) is greater than 0.
- R2 Treat it as **offline** when `uid`/`stime` are empty (pure login page).
- R3 Keep `Dr.COMWebLoginID_N` in the output for diagnostics, but do not use it
  as the primary decision when the session fields contradict it.
- R4 Report `online` with the account, IP and start time; `offline` otherwise;
  `unknown` when the portal is unreachable.
- R5 Correct the status card wording accordingly.

## Acceptance criteria

- With an active portal session, `portal_status` reports `portal=online`,
  while `stime`/`v4ip`/`uid` are populated.
- With no session (no `uid`/`stime`) it reports `portal=offline`.
- Unreachable portal reports `portal=unknown` with a short timeout.
- Verified on the Kwrt router while actually online.

## Out of scope

- Logging out via the portal.
