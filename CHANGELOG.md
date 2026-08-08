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

## CR-002 — Attendance Check-in/Check-out: Immediate Sync

**Date:** 2026-08-08
**Phase:** Burn-in (Acknowledged P1 — see BURN-IN-LOG.md, BI-001)

### Purpose
An employee's check-in was sitting on their own device for up to 30 seconds
— longer if their browser tab was backgrounded/screen-locked shortly after,
which mobile browsers commonly throttle — before it reached the backend.
Reported case: an employee checked in at 09:58, and over three hours later
the owner's admin dashboard still showed them as "Absent."

### Files
- `kb-dental-management-suite.html` — `clockIn()`, `clockOut()` (employee
  self-service), `clockInAdm()`, `clockOutAdm()` (owner/admin marking
  attendance on an employee's behalf)

### Change
All four functions already saved the check-in/check-out correctly to local
state and `localStorage` — the gap was that nothing then pushed it to the
backend immediately; it relied entirely on the next periodic 30-second sync
tick. Added `try{ kbdcAutoSyncMain(); }catch(e){}` immediately after each
save, mirroring an already-proven identical pattern used elsewhere in this
codebase (task-completion toggling). No other logic changed.

### Risk
**Low.** Purely additive — fires an already-existing, already-tested sync
function slightly earlier than it would have run anyway. Wrapped in
try/catch so a sync failure can never block the check-in/check-out itself
from completing.

### Rollback
Revert to `KBDC_APP_VERSION '2026-07-24-1'` (previous commit) if needed —
no backend or deployment changes involved, purely a frontend file.

### Deployment
`KBDC_APP_VERSION` bumped to `2026-08-08-1` so open devices refresh.

### Verification
- Syntax-checked, zero unrelated diff (confirmed via full `git diff`)
- New regression test (`test-checkin-immediate-sync.js`): 6/6 pass —
  selecting an employee and checking in triggers a backend sync call in
  ~40ms (measured), not after a 30s wait; check-in itself still records
  correctly; no JS errors
- **Test-the-test:** temporarily reverted just this fix and re-ran the same
  test — it correctly failed (no sync call arrived), confirming the test
  actually catches the regression it's meant to catch, then the fix was
  restored and re-verified passing
- **Live device confirmation:** pending — this fixes the mechanism that
  caused the reported symptom, but has not yet been confirmed against the
  original real-world case (Vishal Tiwari / live clinic devices)

### Status
**Fixed, automated-test-verified — pending live confirmation.**

---
