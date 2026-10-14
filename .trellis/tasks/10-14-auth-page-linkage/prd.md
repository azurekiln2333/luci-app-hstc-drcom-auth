# Fix authentication page linkage and public-key settings

## Goal

Unify active-account behavior across Online Auth and Diagnostics, compact the
CAS response preview, drop a redundant description, move public-key controls
into Settings, and audit cross-page state linkage.

## Requirements

### R1 — Diagnostics CAS card can pick the active account

- The Diagnostics CAS card must offer the same active-account selector as the
  Online Auth page, sharing one current account (`main.active_account`).
- Extract the account dropdown HTML and its `change` handler from `online.js`
  into a shared helper in `common.js`; both `online.js` and `diag.js` must call
  it. Duplicating two copies is forbidden.
- `diag.js` `load` must also fetch `accounts_list`.
- After switching: `account_set_active` → `refreshCasStatus` +
  `loadCasRequest` + `refreshDashboard`, and clear the stale request/response
  boxes left over from the previous account.

### R2 — Smaller CAS response preview

- `.drcom-preview-frame` height 320px → about 160px.
- The response source area must also be height-limited with `overflow:auto`.
- The iframe `sandbox` must stay the empty string; it must not be relaxed.

### R3 — Remove `casUrlDesc`

- Delete the `casUrlDesc` key in all three languages (zh / zh-tw / en).
- Delete the `o.description = tr('casUrlDesc')` line for `hscas_url` in
  `diag.js`.

### R4 — Public key becomes its own card on the Settings page

- Move `hscas_public_key_url`, the update-public-key button and the public-key
  status from `diag.js` into a new section in `settings.js`.
- Add the new i18n section title in all three languages.
- `settings.js` `load` must read `public_key_status`.
- Backend commands must not change.
- Investigate: the public-key path is currently per account
  (`info/accounts/acc1/public_key.pem`) while the CAS public key is logically
  global. Report whether this is a problem. Do not change the backend without
  approval.

### R5 — Audit linkage across the four pages

- Audit the four pages (Online Auth / Accounts / Diagnostics / Settings) for
  state linkage: e.g. does switching or deleting an account on the Accounts
  page propagate, is the Online Auth status consistent after a CAS login on the
  Diagnostics page.
- Fix issues that fall inside R1–R4 directly; only report anything outside that
  scope.

## Constraints

- Minimal change; follow existing style (tab indent, `var`, `h.xxx` helpers,
  `tr()` translation); no new dependencies; do not refactor unrelated code.
- Every new UI string must exist in all three languages.
- Do not commit, do not push, do not install to the router. Stop for git diff
  review.

## Acceptance Criteria

- [ ] The Diagnostics CAS card shows the active-account dropdown; switching it
      updates status and clears stale request/response output.
- [ ] `online.js` and `diag.js` share one account-selector helper (no copy).
- [ ] Response preview is about 160px and the source block scrolls; `sandbox`
      remains empty.
- [ ] `casUrlDesc` no longer exists in any language or in `diag.js`.
- [ ] Public key controls live in a new Settings section with a tri-lingual
      title; `settings.js` loads `public_key_status`.
- [ ] All changed JS passes `node --check`; runnable `scripts/test_*.sh` pass.
- [ ] Report covers changed files, per-requirement implementation, the
      public-key path finding, the R5 findings list and test results.
