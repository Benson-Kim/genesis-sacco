"""Transactions endpoints: deposits, withdrawals, share top-ups, ledger, interest (P11).

Every route carries a RequirePermission dependency (deny-by-default,
gate 1.6); mutations are idempotent via the Idempotency-Key middleware
(gate 1.4). Money moves only through the P11 services wrapping the P7
posting contract — no posting logic lives here.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from functools import partial
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from genesis.api.authz import RequirePermission
from genesis.api.params import require_cash_channel
from genesis.application import deposit_interest as interest_service
from genesis.application import transactions as txn_service
from genesis.application.auth import AuthContext
from genesis.domain.ledger import Channel, Side, TxnType
from genesis.domain.rbac import Action, Module
from genesis.infrastructure.db import get_sessionmaker
from genesis.infrastructure.tenancy import tenant_session
from genesis.settings import get_settings

router = APIRouter(tags=["transactions"])

_txn_view = RequirePermission(Module.TRANSACTIONS, Action.VIEW)
_txn_create = RequirePermission(Module.TRANSACTIONS, Action.CREATE)
_txn_edit = RequirePermission(Module.TRANSACTIONS, Action.EDIT)

TxnViewCtx = Annotated[AuthContext, Depends(_txn_view)]
TxnCreateCtx = Annotated[AuthContext, Depends(_txn_create)]
TxnEditCtx = Annotated[AuthContext, Depends(_txn_edit)]


class MoneyBody(BaseModel):
    #: decimal_places=2 rejects sub-cent amounts at the contract instead
    #: of silently rounding them into the ledger (P10 precedent).
    amount: Decimal = Field(gt=0, le=1_000_000_000, decimal_places=2)
    channel: Channel


class InterestRunBody(BaseModel):
    """Only the batch size is caller-tunable (review finding 2).

    The annual rate comes exclusively from tenant configuration and the
    accrued period is resolved server-side in strict quarter order —
    extra="forbid" rejects any attempt to supply annual_rate_pct or
    as_of with a clear 422 instead of silently ignoring it.
    """

    model_config = ConfigDict(extra="forbid")

    batch_size: int = Field(default=interest_service.DEFAULT_BATCH_SIZE, ge=1, le=1000)


class AccountTxnOut(BaseModel):
    txn_id: str
    txn_ref: str
    amount: str
    balance_after: str


class TransactionOut(BaseModel):
    id: str
    txn_ref: str
    member_id: str | None
    type: str
    amount: str
    channel: str
    direction: str
    occurred_at: str
    is_reversal: bool


class TransactionListResponse(BaseModel):
    items: list[TransactionOut]
    next_cursor: str | None


class InterestRunOut(BaseModel):
    period_start: str
    period_end: str
    annual_rate_pct: str
    scanned: int
    posted: int
    skipped_existing: int
    rate_mismatches: int
    total_interest: str
    batches: int


def _account_out(r: txn_service.AccountTxnResult) -> AccountTxnOut:
    return AccountTxnOut(
        txn_id=str(r.txn_id),
        txn_ref=r.txn_ref,
        amount=str(r.amount),
        balance_after=str(r.balance_after),
    )


def _txn_out(t: txn_service.TransactionRecord) -> TransactionOut:
    return TransactionOut(
        id=str(t.id),
        txn_ref=t.txn_ref,
        member_id=str(t.member_id) if t.member_id else None,
        type=t.txn_type.value,
        amount=str(t.amount),
        channel=t.channel.value,
        direction=t.direction.value,
        occurred_at=t.occurred_at.isoformat(),
        is_reversal=t.is_reversal,
    )


@router.post("/members/{member_id}/deposits", status_code=201)
async def post_member_deposit(
    member_id: uuid.UUID,
    body: MoneyBody,
    ctx: TxnCreateCtx,
) -> AccountTxnOut:
    """Record a member deposit (teller flow)."""
    channel = require_cash_channel(body.channel)
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        result = await txn_service.record_deposit(
            session, ctx.tenant_id, ctx.user_id, member_id, amount=body.amount, channel=channel
        )
    return _account_out(result)


@router.post("/members/{member_id}/withdrawals", status_code=201)
async def post_member_withdrawal(
    member_id: uuid.UUID,
    body: MoneyBody,
    ctx: TxnCreateCtx,
) -> AccountTxnOut:
    """Record a withdrawal; capacity excludes live guarantee pledges."""
    channel = require_cash_channel(body.channel)
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        result = await txn_service.record_withdrawal(
            session, ctx.tenant_id, ctx.user_id, member_id, amount=body.amount, channel=channel
        )
    return _account_out(result)


@router.post("/members/{member_id}/share-topups", status_code=201)
async def post_member_share_topup(
    member_id: uuid.UUID,
    body: MoneyBody,
    ctx: TxnCreateCtx,
) -> AccountTxnOut:
    """Record a share top-up (SH- ref)."""
    channel = require_cash_channel(body.channel)
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        result = await txn_service.record_share_topup(
            session, ctx.tenant_id, ctx.user_id, member_id, amount=body.amount, channel=channel
        )
    return _account_out(result)


@router.get("/transactions")
async def list_ledger(
    ctx: TxnViewCtx,
    member_id: uuid.UUID | None = None,
    txn_type: Annotated[TxnType | None, Query(alias="type")] = None,
    channel: Channel | None = None,
    direction: Side | None = None,
    ref: Annotated[str | None, Query(max_length=32)] = None,
    date_from: date | None = None,
    date_to: date | None = None,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> TransactionListResponse:
    """Ledger listing with the prototype filters (date, ref, member, type, DR/CR, channel)."""
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        items, next_cursor = await txn_service.list_transactions(
            session,
            ctx.tenant_id,
            member_id=member_id,
            txn_type=txn_type,
            channel=channel,
            direction=direction,
            ref=ref,
            date_from=date_from,
            date_to=date_to,
            cursor=cursor,
            limit=limit,
        )
    return TransactionListResponse(items=[_txn_out(t) for t in items], next_cursor=next_cursor)


@router.post("/jobs/deposit-interest")
async def run_deposit_interest(body: InterestRunBody, ctx: TxnEditCtx) -> InterestRunOut:
    """Accrue deposit interest for the next unaccrued quarter (batched, idempotent).

    The quarterly scheduler calls the same service per tenant; this
    route exists for operations and catch-up. Each batch commits its
    own short transaction (gate 1.3).

    Rate and period are resolved server-side (review finding 2): the
    annual rate comes from tenant_settings (409 when unconfigured) and
    the period advances in strict order — the earliest quarter not yet
    fully accrued, never past the most recent completed quarter, and
    never an arbitrary caller-chosen historical period. Re-running a
    fully accrued tenant is an idempotent no-op (DB UNIQUE); a
    concurrent run at worst re-resolves an already finished period,
    which the UNIQUE claim turns into skips.

    Permission (P4 matrix, verified): transactions x EDIT. Posting
    interest is back-office ledger maintenance, so it belongs to the
    roles the matrix grants transactions:edit (System Admin, Branch
    Manager, Accountant) — deliberately not transactions:create, which
    would let counter Tellers trigger tenant-wide accrual runs.
    """
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        period, annual_rate_pct = await interest_service.resolve_run_parameters(
            session, ctx.tenant_id
        )
    result = await interest_service.run_deposit_interest_for_tenant(
        partial(tenant_session, factory, ctx.tenant_id),
        ctx.tenant_id,
        period=period,
        annual_rate_pct=annual_rate_pct,
        batch_size=body.batch_size,
    )
    return InterestRunOut(
        period_start=period.start.isoformat(),
        period_end=period.end.isoformat(),
        annual_rate_pct=str(annual_rate_pct),
        scanned=result.scanned,
        posted=result.posted,
        skipped_existing=result.skipped_existing,
        rate_mismatches=result.rate_mismatches,
        total_interest=str(result.total_interest),
        batches=result.batches,
    )
