# KuBi Management Suite — Burn-in Log

**Period:** 2026-07-28 → ~2026-08-18 (2–3 weeks)
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

## Log

| Date | Module | Issue | Severity | Root Cause | Fixed In | Status |
|---|---|---|---|---|---|---|
| _(none yet)_ | | | | | | |

---

*When 2A-1b eventually starts: design document first (Objectives, Current vs
target authentication model, Trust boundaries, Token lifecycle, Logout
behaviour, Failure modes, Rollback strategy, Migration plan, Test plan),
reviewed and approved before any code is written.*
