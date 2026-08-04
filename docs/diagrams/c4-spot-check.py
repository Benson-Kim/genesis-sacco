#!/usr/bin/env python3
"""P-DIAG.1 spot-check: no invented boxes in the C4 diagrams.

Run from the repository root:

    python3 docs/diagrams/c4-spot-check.py

Checks (stdlib only, no dependencies):

1. Every ``genesis/...`` module path cited in c4-context.md,
   c4-container.md and c4-component.md exists under
   ``backend/src/`` — an untraceable box is a rejected MR
   (PHASE B2 common rules: never invent structure).
2. Router completeness, both directions: the set of router modules
   wired via ``include_router`` in ``genesis/api/app.py`` equals the
   set of ``genesis/api/*.py`` router modules cited in
   c4-component.md. The wired set is derived from the actual
   ``app.include_router(<name>)`` calls resolved through the module's
   ``from genesis.api.<mod> import <obj> [as <alias>]`` imports, so an
   aliased or renamed router import (e.g. ``import jobs_router as
   ...``) can never silently drop out of the set (!38 review R2 —
   partial drift, not just total drift, must be detected).
3. Pinned function claims (P-DIAG drift MR): every named
   function/class the diagrams claim for the corrections/recovery
   component boxes (and the cross-cutting seams they cite) is defined
   in the module the box names — a claim without a matching ``def`` /
   ``class`` is a FAIL. Extend ``PINNED_CLAIMS`` whenever a diagram
   names a new load-bearing callable.
4. Sequence-diagram citations (!38 review R2): every layer-relative
   module path (``api|application|domain|infrastructure/<mod>.py``)
   cited in the P-DIAG.5 sequence diagrams
   (sequence-committee-voting.md, sequence-snapshot-bind-reverify.md,
   sequence-outbox-dispatch.md) exists under
   ``backend/src/genesis/``.

This script is the falsifiable half of the P-DIAG.1 EXIT criterion:
the CI ``docs:diagrams`` render job is a SYNTAX gate only; the
semantics (real modules, real routers) are pinned by this check plus
the per-element code citations in the companion tables.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DIAGRAMS = [
    REPO_ROOT / "docs/diagrams/c4-context.md",
    REPO_ROOT / "docs/diagrams/c4-container.md",
    REPO_ROOT / "docs/diagrams/c4-component.md",
]
BACKEND_SRC = REPO_ROOT / "backend/src"
APP_PY = BACKEND_SRC / "genesis/api/app.py"
COMPONENT_MD = REPO_ROOT / "docs/diagrams/c4-component.md"

#: P-DIAG.5 sequence diagrams (!39) — their Source-of-truth footers
#: cite layer-relative module paths (``application/foo.py``); check 4
#: verifies each exists under backend/src/genesis/ (!38 review R2).
SEQUENCE_DIAGRAMS = [
    REPO_ROOT / "docs/diagrams/sequence-committee-voting.md",
    REPO_ROOT / "docs/diagrams/sequence-snapshot-bind-reverify.md",
    REPO_ROOT / "docs/diagrams/sequence-outbox-dispatch.md",
]

# A cited module path: genesis/<pkg>/<module>.py (also matches bare
# genesis/api etc. only when the .py suffix is present — package
# citations like "genesis/domain" are checked as directories below).
MODULE_RE = re.compile(r"\bgenesis/[a-z_/]+\.py\b")
# ``$`` needs re.MULTILINE: a package citation at end-of-LINE must
# match, not only one at end-of-file (!38 review R2).
PACKAGE_RE = re.compile(r"\bgenesis/[a-z_]+(?=[^./a-z_]|$)", re.MULTILINE)
# Sequence-diagram citations are layer-relative (audience rule: the
# footer table cites ``application/dividends.py:declare_dividend``).
SEQ_MODULE_RE = re.compile(r"\b(?:api|application|domain|infrastructure)/[a-z_]+\.py\b")
# Router wiring in app.py — resolved via the import map so aliased
# imports (``import jobs_router as accounting_jobs_router``) are never
# silently dropped (!38 review R2).
IMPORT_RE = re.compile(
    r"^from genesis\.api\.([a-z_]+) import ([a-z_]+)(?:\s+as\s+([a-z_]+))?\s*$",
    re.MULTILINE,
)
INCLUDE_CALL_RE = re.compile(r"\bapp\.include_router\(([a-z_]+)\)")

#: Check 3 — function/class claims the diagrams make, pinned to code.
#: module path (under backend/src/) -> names that must be defined via
#: ``def`` / ``async def`` / ``class`` in that file.
PINNED_CLAIMS: dict[str, tuple[str, ...]] = {
    # Diagram 19 — corrections (P13.15 !46, issue #21 !51, issue #24 !52)
    "genesis/application/corrections.py": (
        "post_misc_fee",
        "request_repayment_adjustment",
        "approve_repayment_adjustment",
        "reject_repayment_adjustment",
        "request_write_off",
        "cast_write_off_vote",
        "void_write_off",
        "post_write_off",
        "record_recovery_receipt",
    ),
    "genesis/application/ledger.py": (
        "post_fee",
        "post_reversal",
        "post_loan_write_off",
        "post_loan_recovery",
        "disburse_loan",
    ),
    "genesis/application/guarantees.py": (
        "release_guarantees_for_loan",
        "live_pledged_total",
    ),
    # Diagram 20 — recovery cases (P13.16 !47) + the diagram-7 seam
    "genesis/application/recovery.py": (
        "open_recovery_case",
        "assign_recovery_case",
        "add_recovery_note",
        "list_worklist",
        "run_recovery_close_pass",
    ),
    "genesis/domain/recovery.py": ("transition",),
    "genesis/application/arrears.py": ("run_arrears_for_tenant",),
    # Diagram 11 — the P13.10 report builders (!40; !38 review R3 refresh)
    "genesis/application/reports.py": (
        "_build_par_aging",
        "_build_membership_register",
        "_build_income_statement",
        "_build_sasra_return",
    ),
    "genesis/domain/ledger.py": ("account_class",),
    "genesis/domain/sasra.py": ("line_for_account",),
    # Cross-cutting seams cited by diagram 0 and the L1/L2 files
    "genesis/api/idempotency.py": ("IdempotencyMiddleware",),
    "genesis/infrastructure/tenancy.py": (
        "tenant_session",
        "tenant_snapshot_session",
    ),
}


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def check_pinned_claims() -> int:
    """Check 3: return the number of verified claims; fail on a miss."""
    verified = 0
    for module, names in PINNED_CLAIMS.items():
        path = BACKEND_SRC / module
        if not path.is_file():
            fail(f"PINNED_CLAIMS names a module that does not exist: {module}")
        text = path.read_text(encoding="utf-8")
        for name in names:
            if not re.search(
                rf"^\s*(?:async\s+def|def|class)\s+{re.escape(name)}\b",
                text,
                re.MULTILINE,
            ):
                fail(f"claim not found in code: {module} does not define {name!r}")
            verified += 1
    return verified


def wired_router_modules(app_text: str) -> set[str]:
    """Check 2 input: the genesis.api modules actually wired in app.py.

    Every ``app.include_router(<name>)`` call is resolved back through
    the module's imports (plain OR aliased). An include_router call
    whose name cannot be traced to a ``genesis.api`` import is a FAIL —
    the regexes must never silently under-count the wired set.
    """
    name_to_module: dict[str, str] = {}
    for module, obj, alias in IMPORT_RE.findall(app_text):
        name_to_module[alias or obj] = module
    wired: set[str] = set()
    unresolved: list[str] = []
    calls = INCLUDE_CALL_RE.findall(app_text)
    if not calls:
        fail(f"no app.include_router(...) calls found in {APP_PY} — regex drift?")
    for name in calls:
        module = name_to_module.get(name)
        if module is None:
            unresolved.append(name)
        else:
            wired.add(module)
    if unresolved:
        fail(
            "include_router names in app.py with no matching "
            "'from genesis.api.<module> import <obj> [as <alias>]' import "
            "(regex drift?):\n  " + "\n  ".join(sorted(unresolved))
        )
    return wired


def main() -> None:
    for p in [*DIAGRAMS, *SEQUENCE_DIAGRAMS, APP_PY]:
        if not p.exists():
            fail(f"missing input file {p}")

    # --- Check 1: every cited module path exists -----------------------
    cited_modules: set[str] = set()
    cited_packages: set[str] = set()
    for diagram in DIAGRAMS:
        text = diagram.read_text(encoding="utf-8")
        cited_modules.update(MODULE_RE.findall(text))
        cited_packages.update(PACKAGE_RE.findall(text))
    missing = sorted(m for m in cited_modules if not (BACKEND_SRC / m).is_file())
    if missing:
        fail("cited module paths that do not exist on this tree:\n  " + "\n  ".join(missing))
    missing_pkgs = sorted(p for p in cited_packages if not (BACKEND_SRC / p).is_dir())
    if missing_pkgs:
        fail("cited package paths that do not exist:\n  " + "\n  ".join(missing_pkgs))

    # --- Check 2: router completeness, both directions -----------------
    app_text = APP_PY.read_text(encoding="utf-8")
    wired = wired_router_modules(app_text)
    cited_routers = {
        m.removeprefix("genesis/api/").removesuffix(".py")
        for m in MODULE_RE.findall(COMPONENT_MD.read_text(encoding="utf-8"))
        if m.startswith("genesis/api/")
        and m
        not in (
            # Seam modules, not router groups (diagram 0):
            "genesis/api/app.py",
            "genesis/api/idempotency.py",
            "genesis/api/authz.py",
            "genesis/api/params.py",
        )
    }
    undocumented = sorted(wired - cited_routers)
    if undocumented:
        fail(
            "routers wired in app.py but missing an L3 diagram in "
            "c4-component.md:\n  " + "\n  ".join(undocumented)
        )
    invented = sorted(cited_routers - wired)
    if invented:
        fail(
            "L3 diagrams cite router modules NOT wired in app.py:\n  " + "\n  ".join(invented)
        )

    # --- Check 3: pinned function/class claims --------------------------
    verified_claims = check_pinned_claims()

    # --- Check 4: sequence-diagram module citations (!38 review R2) -----
    seq_cited: set[str] = set()
    for diagram in SEQUENCE_DIAGRAMS:
        seq_cited.update(SEQ_MODULE_RE.findall(diagram.read_text(encoding="utf-8")))
    if not seq_cited:
        fail("no module citations found in the sequence diagrams — regex drift?")
    seq_missing = sorted(
        m for m in seq_cited if not (BACKEND_SRC / "genesis" / m).is_file()
    )
    if seq_missing:
        fail(
            "sequence diagrams cite module paths that do not exist under "
            "backend/src/genesis/:\n  " + "\n  ".join(seq_missing)
        )

    print(
        f"OK: {len(cited_modules)} cited module paths exist; "
        f"{len(wired)} routers wired in app.py all have L3 diagrams; "
        f"no invented routers; {verified_claims} pinned function claims "
        f"verified; {len(seq_cited)} sequence-diagram module citations "
        "exist."
    )


if __name__ == "__main__":
    main()
