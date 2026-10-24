# Authentication Flow

## Scope / Trigger

Read this contract before changing Online Auth, Diagnostics, or the authentication
scripts. A standalone CAS session is not Dr.COM network authentication.

## Signatures

```sh
/etc/init.d/drcom_auth authenticate [account-id]
/etc/init.d/drcom_auth ticket [account-id]
```

`authenticate` runs the complete manual flow. `ticket` runs only the Dr.COM stage
used by Diagnostics. Omitting the account selects the active account once.

## Contracts

- Capture the selected account when a UI action starts and pass its ID explicitly.
- Render one private configuration snapshot for the invocation. Every stage uses
  the same `DRCOM_CONFIG_FILE`; CAS also supports `DRCOM_CAS_CONFIG_FILE`.
- Reuse the existing stage implementations in order: obtain the authorize URL,
  refresh CAS parameters, log in to CAS, run the Dr.COM ticket flow, then verify
  the portal state. Do not implement a separate HTTP login in the UI.
- An already active CAS session may skip its CAS POST, but must still complete
  the Dr.COM stage and final verification.
- Report success only with exit code zero and `authenticated=1`,
  `stage=complete`, and `portal=online`. A valid TGC alone proves none of these.
- Only a connectivity probe returning HTTP 204 proves the portal is online.
  Portal account details and future billing dates must never override a failed probe.
- Stop on the first failed stage. Keep credentials, execution tokens, and request
  bodies out of the one-click result. Remove the temporary configuration on exit.
- Manual authentication may clear the selected account's bad-credentials marker;
  automatic retry must continue respecting it.

## Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Invalid or deleted account | Fail before any HTTP request; never use a different account |
| Active account changes during authentication | All stages retain the captured account |
| Saved CAS execution token is stale | Fetch fresh parameters before the manual CAS POST |
| CAS reports already logged in | Continue to Dr.COM without reusing stale CAS parameters |
| Authorization, CAS, or Dr.COM fails | Return nonzero; do not run subsequent stages |
| Final portal state is offline | Return nonzero; never show the success message |
| Double click | Start one authentication operation |
| Diagnostic selection changes during a request | Ignore the old result and refresh callbacks |

## Good / Base / Bad Cases

- Good: selected B authenticates while global A remains unchanged; every child
  reads B's snapshot, and the verified result refreshes both status displays.
- Base: an active CAS cookie still proceeds through the Dr.COM login and probe.
- Bad: `cas_ensure` returns `cookie=valid`; treating that as full authentication
  leaves the network offline and is forbidden.

## Tests Required

- `sh scripts/test_authenticate.sh`: execute the real init entry point and stage
  scripts with mocked external services. Assert order, fresh parameters, active
  CAS handling, account isolation, stage failures, and final online verification.
- `node scripts/test_cas_account_isolation.cjs`: invoke the real LuCI button
  handlers. Assert selected-account dispatch, duplicate prevention, rejected
  results, status refresh, and stale diagnostic callback protection.
- Include both commands in the release quality gate.

## Wrong vs Correct

Wrong: call `cas_ensure`, then display "authenticated" when the cookie is valid.

Correct: call `authenticate <captured-account>`, require the complete verified
result, and refresh Dr.COM and CAS status after the operation.
