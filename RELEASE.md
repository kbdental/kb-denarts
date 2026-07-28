# KuBi Management Suite

## Release: Burn-in Baseline

**Baseline Commit:** `1389d48`

**Deployments**
- Main Backend — Version 6
- Inventory Backend — Version 3

**Included Changes**
- CR-001 — Inventory Authentication Gate
- Diagnostic improvements (`testTokenGate` — 4-scenario PASS/FAIL/SKIP)
- CHANGELOG.md introduced
- Burn-in process introduced

**Known Deferred Items**
- 2A-1b — Session Foundation
- 2A-2 — Frontend Session Migration
- 2A-3 — Static Token Retirement
- 2B — Server-side RBAC
- 2C — Audit Trail

**Support Policy During Burn-in**

Only:
- P0 Security
- P1 Operational Bugs
- Verified Regressions

No:
- Features
- Refactoring
- Architecture
- UI Changes

**Burn-in Exit Criteria**
- No P0
- No unresolved P1
- No rollback
- Stable production operation

---

Full detail: `CHANGELOG.md` (change history) · `BURN-IN-LOG.md` (active tracking, full exit criteria, restart triggers).
