# KuBi Management Suite — Burn-in Log

**Period:** 2026-07-28 → ~2026-08-18 (2–3 weeks)
**Baseline:** git tag `BurnIn-Start` — `git show BurnIn-Start` or `git diff BurnIn-Start` at any time to compare against this exact starting point
**Status:** 🟡 In progress

## Scope — what gets worked on during this period

Only these categories:

- **P0** — Security defects
- **P1** — Bugs affecting clinic operations
- **Regression** — Anything that previously worked but now fails

Nothing else. Specifically **not** in scope until burn-in is closed out:

- ❌ New modules
- ❌ UI redesign
- ❌ Session architecture (2A-1b)
- ❌ Multi-tenancy
- ❌ Performance optimizations, unless fixing a real observed issue
- ❌ Refactoring for cleanliness alone

## Exit criteria — agreed before burn-in start

Burn-in is considered successful, and 2A-1b can begin, when **all** of the following hold:

- [ ] No P0 security incidents
- [ ] No unresolved P1 operational bugs
- [ ] No data corruption
- [ ] No authentication failures
- [ ] No rollback required
- [ ] Stable daily use across normal clinic operations

## What restarts the burn-in clock

If any of these occur, the burn-in period **restarts from zero** after the fix is deployed and verified:

- P0 security issue
- Data loss or corruption
- Authentication bypass
- Rollback required
- Production outage caused by a code change

Everything else (P1/P2 bugs, regressions, usability issues) is logged and fixed **without** restarting the clock.

## Issue Type classification

Every logged issue gets exactly one Type, to make patterns visible later:

`Security` · `Regression` · `Functional Bug` · `Performance` · `Usability` · `Data Integrity` · `Configuration` · `User Error`

## Log

| ID | Date | Module | Severity | Type | Root Cause | Fixed In | Verified | Status |
|---|---|---|---|---|---|---|---|---|
| _(none yet)_ | | | | | | | | |

## End-of-burn-in metrics (fill in when closing out)

- **Mean Time to Resolution (MTTR):** average of (Verified date − Date reported) across all logged issues. An approximate value is fine.
- **Defect Density:** count of issues by severity —
  - P0: —
  - P1: —
  - P2: —

Target picture for a healthy burn-in: P0 = 0, P1 = 0 or very few, remaining issues mostly P2/usability.

---

## Looking ahead (for reference only — not started until burn-in exit criteria are met)

1. **Phase 2A-1b** — Session foundation: design document first (Objectives, Current vs target authentication model, Trust boundaries, Token lifecycle, Logout behaviour, Failure modes, Rollback strategy, Migration plan, Test plan) → reviewed and approved → then implementation in small, testable increments.
2. **Phase 2A-2** — Frontend migration to session-based authentication.
3. **Phase 2A-3** — Remove the shared static token completely.
4. **Phase 2B** — Role-Based Access Control (server-side enforcement).
5. **Phase 2C** — Audit trail and immutable activity logging.

Each phase follows the same pattern as CR-001: design → smallest safe change → diagnostics → testing → deployment → verification → documentation.
