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

### Reconciliation note (2026-08-08)
`kbdental/kb-management-suite` (`main`, GitHub Pages) is the clinic's actual
production deployment — it is **not** a mirror of this repo. It carries its
own independent history, including real work never ported here: an
Inventory Manager/User role split with an over-permissioning fix, and a
Drive-delete-on-remove fix for document management. Confirmed with the
clinic owner which repo is authoritative, then reconciled this fix in —
diffed both repos down to their true common ancestor (`389e7b5` here /
`95335af` there — byte-identical content confirmed), verified this fix was
the *only* change worth porting in either direction, and applied it
directly to `kb-management-suite/index.html` without disturbing its
unique fixes. Pushed to `kb-management-suite` `main` @ `2632974`
(`3b85e48..2632974`).

This repo (`kb-denarts`) is now missing those `kb-management-suite`-only
fixes (Inventory role split, Drive-delete). Not ported back here since it
wasn't asked for — flagged for a future reconciliation pass if this repo
continues to be used for development.

### Status
**Fixed, automated-test-verified, deployed to production — pending live confirmation.**

---

## CR-003 — Cross-Device Data Loss, Task Role-Assignment Save, Scroll Bug

**Date:** 2026-08-13
**Phase:** Burn-in (P1s — see BURN-IN-LOG.md, BI-002/BI-003/BI-004)

### Purpose
Reported after several days of live multi-device use: Stock In entries and
attendance marks made on one device intermittently never appeared on
others, even after repeated refreshing ("bar bar refresh krne pe 1-2 ka
show ho gaya hai... but still some employees attendance has not been
updated"). Separately, in Task Management: adding an employee's name
against a role didn't save, task data wasn't reaching Google Sheets, and
marked tasks appeared to go off screen on scroll.

### Root causes and fixes

**1. Backend: blind full-replace on every push (BI-002).**
`backend/Code.gs`'s `saveAllRows()` did `sheet.clearContents()` + a full
rewrite on every `saveBatch`/`saveAll` call. Any device pushing from a
pull that was even slightly stale would silently erase records another
device had just added — and the more often devices sync (CR-002's
immediate-sync change made this more frequent, not less), the more likely
the race. Fixed with `kbdcMergeRows_()`: merge-on-write keyed by each
row's `id` (composite-key fallback for the handful of id-less sheets —
Tasks, TaskCompletions, InventoryItems), plus `withWriteLock_()`
(`LockService`) so two near-simultaneous pushes can't both read stale
state before either writes. Deliberate trade-off, documented in code: this
favors never silently losing data over honoring deletions across devices
— a stale row lingering beats real attendance/stock data vanishing.
Deletion propagation would need an explicit tombstone mechanism; treated
as a separate follow-up, not blocking here.

**2. Task Management: role-employee assignment never synced (BI-003).**
`kbdc_role_emp_*` (the "+ Add Another Employee" feature against a role)
was pure per-device `localStorage` — never in `KBDC_BACKEND_MODULES` or
`KBDC_BLOB_KEYS` — and `kbdcSyncRoleEmployeesFromHR()` destructively
overwrote it on every page load, replacing it with only what's derivable
from HR Admin records. A manually-added name would look like it saved,
then vanish on the next reload. Fixed by wiring `kbdc_role_emp_*` into the
existing sync pipeline (new `RoleEmployees` sheet, scan-prefixed
push/pull mirroring how Tasks already works) and making the HR-derived
rebuild additive instead of destructive.

While building and testing this fix, found the *same* race twice more:
the immediate sync triggered right after adding an employee (or marking a
task complete) does its own pull *first*, and that pull can fetch a
snapshot from just before the very change it was triggered by. Both the
role-employee pull-merge and the pre-existing `TaskCompletions` pull-merge
were doing a blind "adopt whatever the pull returned," which could erase
the just-made change within its own sync cycle. Both now union-merge by id
(`kbdcUnionMergeById`, already used elsewhere in this file) instead. The
`TaskCompletions` half of this is very likely what "task data not saving
to Google Sheets" actually was.

**3. Task Management: scroll bug (BI-004) — partial.**
Added `min-height:0` to the task list's flex scroll container chain (a
flex child needs this to actually shrink and scroll internally instead of
growing past its box) — legitimate CSS correctness fix, low risk. Could
**not** conclusively reproduce the reported "marked tasks go off screen on
scroll" symptom in testing (40 seeded tasks, desktop and mobile viewport
sizes) either before or after this fix, so it may not be the complete
story. Left in as a safe improvement; flagged as needing more detail
(exact screen, a screen recording) if the symptom persists.

### Files
- `backend/Code.gs` — `saveAllRows()`, new `kbdcRowKey_()`,
  `kbdcMergeRows_()`, `withWriteLock_()`
- `kb-dental-management-suite.html` — `kbdcSyncRoleEmployeesFromHR()`,
  `EmployeePickerModal` (`handleAdd`/`handleDelete`),
  `KBDC_BACKEND_MODULES`, new `kbdcRoleEmpRowsToByCode()`,
  `kbdcAutoSyncMain()`'s pull-merge (TaskCompletions + new RoleEmployees
  block), `.tl-body` CSS, `TaskListView` root wrapper

### Risk
**Backend change: moderate, mitigated by testing.** This changes write
semantics for every sheet in the spreadsheet — merge-on-write plus a
script lock instead of blind overwrite. Verified with 9 unit tests
directly modeling realistic multi-device scenarios, including the exact
"two devices, one's record disappears" case. The known, accepted
trade-off (deletions may not propagate across devices) is the main
residual risk and is documented in code comments for whoever picks this
up next.
**Frontend changes: low.** Additive sync wiring plus two merge-instead-of-
replace fixes, following existing patterns already in use in this exact
file (`kbdcUnionMergeById`). CSS fix is a single well-understood property
addition.

### Rollback
Frontend: revert to `KBDC_APP_VERSION '2026-08-08-1'` (previous commit).
Backend: revert `backend/Code.gs` to the CR-002 version and redeploy —
no data migration needed either direction, since old and new formats
read/write the same row shape.

### Deployment
`KBDC_APP_VERSION` bumped to `2026-08-13-1`.

**The backend fix (BI-002) requires the clinic to manually redeploy the
Apps Script** (Deploy → Manage deployments → Edit → New version) —
pushing the updated `backend/Code.gs` to this repo does not, by itself,
change what the live Apps Script Web App is running. Until that redeploy
happens, the cross-device data-loss issue is **not** fixed in production,
even though everything else in this change is.

### Verification
- Both frontend and backend syntax-checked clean
- 28 automated tests across 5 test files, all passing:
  - Backend merge logic: 9 unit tests, incl. a direct two-device
    attendance-race reproduction
  - Attendance immediate-sync (carried over from CR-002, re-verified): 6
  - Task list scroll: 5
  - Role-employee save + cross-device sync: 5 — **test-the-test**
    performed (temporarily reverted the union-merge fix, confirmed the
    test correctly fails, restored and re-verified passing)
  - Task-completion race: 3 — same test-the-test discipline applied
- Reconciled and applied identically to both `kb-management-suite`
  (production) and this repo — diffed both files at the exact points
  touched to confirm they were byte-identical before patching, so the same
  edits apply cleanly to both

### Status
**Deployed to production and redeployed by the clinic; owner-confirmed
"✓ Backed up" observed live afterward.** Scroll bug (BI-004): partial fix
applied, exact symptom not confirmed reproduced.

### Follow-up (same day): lock scope narrowed
A live `"Failed to fetch"` was observed shortly after the clinic's
redeploy. Root cause of that specific error is most likely a brief
instability window some fresh Apps Script deployments have while they
finish propagating (self-resolving) — but it surfaced a real, independent
scalability issue worth fixing regardless: `saveBatch` held one
script-wide lock across every sheet in a device's push, so a device
writing Attendance would wait on an unrelated device writing Tasks even
though they touch different sheets. Moved the lock inside `saveAllRows`
itself so it's held only for one sheet's read-merge-write at a time.
Apps Script's `LockService` has no per-sheet/named lock (only
script-wide), so this doesn't eliminate cross-sheet serialization
entirely, but it cuts each lock's hold time down to a single sheet
instead of an entire multi-sheet batch. Verified: all 9 merge-logic unit
tests still pass unchanged (pure lock-scope change). Required (and got)
a second clinic redeploy.

---

## CR-004 — Task Checkbox Un-clicking Itself After Marking Done

**Date:** 2026-08-13
**Phase:** Burn-in (P1 — see BURN-IN-LOG.md, BI-005)

### Purpose
Reported immediately after CR-003 shipped: clicking a task as done in Task
Management immediately un-clicks itself, and nothing lands in Google
Sheets — it comes back showing nothing done.

### Root cause
Same race class as CR-003's role-assignment and task-completion fixes,
missed on the first pass because it lives in a different place: the Tasks
sheet's pull-merge (`kbdcTasksRowsToByRole` / the `byRole` block in
`kbdcAutoSyncMain`) is what actually holds each task's `done` flag — and
it was still doing the old "blind adopt whatever the pull returned"
instead of merging. `toggleTaskDone()` sets `done:true` locally and
immediately triggers a sync; that sync's own pull can fetch a Tasks
snapshot from just before this completion reached the backend
(`done:false`), and the blind overwrite would revert the just-toggled
local list within its own sync cycle — visually, the checkbox un-clicking
itself.

### Fix
Union-merge the Tasks pull by `taskCode` instead of blindly adopting
remote. Task rows don't carry an `id` field, so each task is mapped to a
synthetic `id: taskCode` for the merge only (reusing the existing,
already-tested `kbdcUnionMergeById` rather than writing new merge logic),
then mapped back. Neither side carries a per-task `updatedAt`, so on a
genuine conflict `kbdcUnionMergeById`'s existing documented default
applies: local wins — which is exactly what protects a fresh toggle from
being reverted by a stale pull.

### Files
- `kb-dental-management-suite.html` — `kbdcAutoSyncMain()`'s Tasks
  pull-merge block

### Risk
**Low.** Reuses an existing, already-tested merge helper via a key
mapping; touches only the Tasks pull-merge, nothing else.

### Verification
- 5 new tests directly reproducing the reported symptom: checkbox
  reverting after a stale pull, a genuinely remote-only task still
  correctly folding in (confirms this isn't just "local wins wholesale"),
  and the completion log entry staying intact — all passing
- **Test-the-test:** reverted the fix, confirmed the test correctly fails
  (`done:false` — exact reproduction of the reported symptom), restored
  and re-verified passing
- Full syntax check; full existing regression suite (24 tests across 5
  files) re-run and still passing
- Applied identically to `kb-management-suite` (production) and this repo

### Deployment
`KBDC_APP_VERSION` bumped to `2026-08-13-2`. Frontend-only change — no
backend/Apps Script redeploy needed for this one.

### Status
**Fixed, tested, deployed to production.**

---
