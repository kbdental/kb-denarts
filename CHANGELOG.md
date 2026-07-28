# KuBi Management Suite — Change Log

Human-readable release log for changes to the Management Suite and its backends.
This is separate from git history: git records *what* changed line-by-line;
this file records *why* a change was made, how it was tested, and how to roll
it back — in plain language, for anyone reviewing the product's hardening
history as it moves toward commercial pilot.

Each entry is a Change Record (CR-NNN), added in order, never edited after
the fact — a correction becomes a new entry, so this file stays an accurate
history of what was actually done and when.

---

## CR-001 — Inventory Backend Authentication Gate

**Date:** 2026-07-28
**Phase:** KuBi Phase 2A-1a (Authentication & Secret Hardening)

### Purpose
Close a critical exposure found during the Phase 1 Commercial Readiness Audit
and confirmed during Phase 2A backend mapping: the Inventory backend
(a separate Google Apps Script deployment from the Main backend) had **no
authentication check at all** — unlike Main, which already gates every
request behind a shared `API_TOKEN`. Anyone with the Inventory backend's URL
could read or overwrite all inventory data with no credential whatsoever.

### Files
- Inventory backend `Code.gs` (Google Apps Script project bound to the
  "K.B. Dental Inventory (Suite)" spreadsheet) — live code updated
- `backend/inventory-backend/Code.gs.v2-BACKUP-before-2A-1a.gs` — exact
  backup of the prior (unauthenticated) code, for reference/rollback
- `backend/inventory-backend/Code.gs.NEW-2A-1a.gs` — the deployed code,
  tracked in this repo

### Change
Added the same `API_TOKEN` shared-secret gate already proven in the Main
backend (byte-for-byte identical check), plus a diagnostic-only
`testTokenGate()` function (not reachable over HTTP) that reports
PASS/FAIL/SKIP for four scenarios without ever logging the token's value.
No other logic — `saveAllRows`, `readAllRows`, `sanitizeSheetName`,
`getOrCreateSheet`, `doGet`, `respond` — was touched.

### Risk
**Low.** Purely additive check; the only real risk was a token mismatch
between the Inventory project's `API_TOKEN` Script Property and what the
app/`stock-out.html` already send — mitigated by copying the value directly
from the Main project's already-configured property, and re-verifying it
matched exactly before deploying.

### Rollback
Apps Script **Version 2** (the prior, unauthenticated deployment) remains
selectable under Manage Deployments. Note: rolling back to Version 2
re-opens the exact hole this change closes — treat it as a last resort, not
a default undo. If an issue arises, the correct fix is almost always to
adjust the `API_TOKEN` Script Property, not to revert the code.

### Deployment
Live **Version 3** (up from Version 2).

### Verification
Diagnostic (`testTokenGate`, run twice — once before and once after
confirming the token value matched Main exactly):
- ✓ Missing token → rejected
- ✓ Invalid token → rejected
- ✓ Valid token → accepted
- ✓ `API_TOKEN` Script Property confirmed configured

Live, in-app regression testing performed by the clinic owner after deploying Version 3:
- ✓ Inventory Test Connection
- ✓ Inventory Sync
- ✓ Stock Out
- ✓ Inventory Save
- ✓ Inventory Read

### Related commits
- `5ca4a3f` — Add Inventory backend 2A-1a: backup + proposed `API_TOKEN` gate
- `5894f08` — 2A-1a: `testTokenGate()` reports explicit PASS/FAIL for all 4 scenarios

### Status
**Completed.**

---
