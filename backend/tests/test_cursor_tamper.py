"""FM9 — per-endpoint cursor tamper legs (#31 batch 13, review N4).

ONE shared parametrized suite over every swept list endpoint reachable
with cheap seeding (one admin, one member, one branch): each endpoint
must refuse BOTH

* a garbage cursor (proves the endpoint routes its cursor through the
  codec's strict decode at all), and
* a VALIDLY SIGNED token minted for a DIFFERENT endpoint scope in the
  SAME tenant (the strong leg: proves the per-endpoint scope binding —
  falsifiable per endpoint by serving/accepting plaintext or by
  dropping the endpoint identity from the MAC),

with the sanitized 400 envelope (category + correlation_id ONLY —
never a 500, never a silently empty 200 page, no internals echoed).

Deep-parent endpoints reuse their module seeders instead of this file
(the F5 lesson — no private cross-suite imports): recovery-case notes
in test_recovery_cases.py, write-off recovery receipts in
test_loan_recoveries.py. The dividends-module endpoints
(/dividends/declarations, /share-transfers) join this matrix when the
batch-12 gate clears (see the batch-13 MR phase status).
"""

import asyncio
import os
import uuid

import pytest

from db_helpers import api_client
from export_helpers import create_branch, seed_actor, seed_member_no
from genesis.application.pagination import encode_cursor

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="requires a migrated database"
)

#: A plausible plaintext keyset position — validly signed below under a
#: scope NO endpoint uses, so every decode must refuse it by tag.
_FOREIGN_SCOPE = "tamper.test"
_PAYLOAD = f"2026-01-01T00:00:00+00:00|{uuid.uuid4()}"

#: (endpoint template, human id). Templates take {mid} / {bid}.
ENDPOINTS = [
    ("/members", "members plain"),
    ("/members?include=aggregates", "members aggregates"),
    ("/members/{mid}/statement", "member statement"),
    ("/members/{mid}/documents", "kyc documents"),
    ("/branches", "branches"),
    ("/branches/{bid}/users", "branch user roster"),
    ("/branches/{bid}/members", "branch member roster"),
    ("/accounting-periods", "accounting periods"),
    ("/audit-log", "audit log"),
    ("/loans", "loan book"),
    ("/applications", "loan applications"),
    ("/member-exits", "member exits"),
    ("/transactions", "transactions"),
    ("/users", "users"),
    ("/recovery-cases", "recovery worklist"),
    ("/corrections/repayment-adjustments", "adjustments register"),
    ("/corrections/write-offs", "write-off register"),
]

#: Seeded once, shared across the parametrized legs (ids and the JWT
#: are loop-independent strings; the DB row set is session-shared).
_CTX: dict[str, str] = {}


async def _ctx() -> dict[str, str]:
    if not _CTX:
        tid, _, token = await seed_actor()
        branch_id = await create_branch(token, f"T-{uuid.uuid4().hex[:8]}")
        member_id = await seed_member_no(tid, "GP-0001", name="Tamper Probe")
        _CTX.update(tid=str(tid), token=token, branch_id=branch_id, member_id=str(member_id))
    return _CTX


@pytest.mark.parametrize(("template", "label"), ENDPOINTS, ids=[e[1] for e in ENDPOINTS])
def test_forged_cursor_is_a_sanitized_400(template: str, label: str) -> None:
    async def run() -> None:
        ctx = await _ctx()
        path = template.format(mid=ctx["member_id"], bid=ctx["branch_id"])
        # Cross-scope replay: correctly signed for the SAME tenant but
        # a scope no endpoint uses — only the tag check can refuse it.
        cross_scope = encode_cursor(
            _PAYLOAD, tenant_id=uuid.UUID(ctx["tid"]), endpoint=_FOREIGN_SCOPE
        )
        headers = {"authorization": f"Bearer {ctx['token']}"}
        sep = "&" if "?" in path else "?"
        async with api_client() as client:
            for forged in ("not-a-cursor", cross_scope):
                res = await client.get(f"{path}{sep}cursor={forged}", headers=headers)
                assert res.status_code == 400, (label, forged, res.status_code, res.text)
                body = res.json()
                assert set(body.keys()) == {"category", "correlation_id"}, (label, body)
                assert body["category"] == "validation_error", (label, body)

    asyncio.run(run())
