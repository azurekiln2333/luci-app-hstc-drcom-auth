# PRD: Real Dr.COM status from the portal

## Background

The status card's "Dr.COM auth" row currently reuses the CAS login result
(`cas_state.env`), which is nearly the same as the CAS row and is not the real
portal state.

The Dr.COM portal at `DRCOM_SERVER_IP` (default 192.168.2.34, port 80) answers a
status query on `/` with an HTML page containing:

- a marker comment `<!--Dr.COMWebLoginID_N.htm-->` where N is the state:
  1 = not logged in (login page), 2 = login failed, 3 = online
- `uid='...'`, `v4ip='...'`, `stime='...'` describing the current session

## Goal

Query the portal directly and report the true Dr.COM state.

## Requirements

- R1 Add a backend command that fetches `http://DRCOM_SERVER_IP/` and parses
  the marker plus uid/ip/start-time, printing key=value lines.
- R2 `overview` reports the real Dr.COM state from that command, not from
  `cas_state.env`.
- R3 The status card shows: online (with account/ip) / offline / failed /
  unknown, localized in zh, zh-TW, en.
- R4 Never block the panel: use a short curl timeout and degrade to unknown on
  any error.
- R5 The response body of the last CAS login is also exposed and rendered in a
  code block under the request (carried over from the previous request).

## Acceptance criteria

- With the portal reachable, `overview` reports `drcom=online|offline|failed`
  matching `Dr.COMWebLoginID_N`.
- With the portal unreachable, it reports `drcom=unknown` and the panel still
  loads quickly.
- The status card reflects a login performed from the Diagnostics tab without a
  manual reload.
- Verified on the Kwrt router.

## Out of scope

- Logging out via the portal.
