"""Accounting period endpoints (issue #12, P12.5, gate 1.6).

Every route carries a RequirePermission dependency (deny-by-default);
the close mutation is idempotent via the Idempotency-Key middleware
(gate 1.4).

Permission gates (P4 matrix, decided and documented):

  * close period — transactions x APPROVE: closing the books freezes
    ledger history for a month, a control over every posting, so it
    sits with the approve holders of the transactions module (System
    Admin, Branch Manager) — deliberately NOT transactions:create/edit,
    which Tellers and Accountants hold for day-to-day posting: the
    people who post must not be able to freeze (or race) the periods
    they post into.
  * list periods — transactions x VIEW.

The close body carries only year/month — the period bounds, the
"fully elapsed" rule and every posting-date check are resolved
server-side (issue #12: never caller-backdatable). extra="forbid"
rejects anything else with a 422.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from genesis.api.authz import RequirePermission
from genesis.application import accounting_periods as periods_service
from genesis.application.auth import AuthContext
from genesis.domain.rbac import Action, Module
from genesis.infrastructure.db import get_sessionmaker
from genesis.infrastructure.tenancy import tenant_session
from genesis.settings import get_settings

router = APIRouter(prefix="/accounting-periods", tags=["accounting-periods"])

_view = RequirePermission(Module.TRANSACTIONS, Action.VIEW)
_approve = RequirePermission(Module.TRANSACTIONS, Action.APPROVE)

ViewCtx = Annotated[AuthContext, Depends(_view)]
ApproveCtx = Annotated[AuthContext, Depends(_approve)]


class ClosePeriodBody(BaseModel):
    """Only the calendar month is caller-chosen; everything else is server-side."""

    model_config = ConfigDict(extra="forbid")

    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)


class PeriodOut(BaseModel):
    id: str
    period_start: str
    period_end: str
    status: str
    closed_at: str | None
    version: int


class PeriodListResponse(BaseModel):
    items: list[PeriodOut]
    next_cursor: str | None


def _out(record: periods_service.PeriodRecord) -> PeriodOut:
    return PeriodOut(
        id=str(record.id),
        period_start=record.period_start.isoformat(),
        period_end=record.period_end.isoformat(),
        status=record.status,
        closed_at=record.closed_at.isoformat() if record.closed_at else None,
        version=record.version,
    )


@router.post("/close", status_code=201)
async def close_period(body: ClosePeriodBody, ctx: ApproveCtx) -> PeriodOut:
    """Close a fully elapsed month (transactions:approve)."""
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        record = await periods_service.close_period(
            session, ctx.tenant_id, ctx.user_id, year=body.year, month=body.month
        )
    return _out(record)


@router.get("")
async def list_periods(
    ctx: ViewCtx,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PeriodListResponse:
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        items, next_cursor = await periods_service.list_periods(
            session, ctx.tenant_id, cursor=cursor, limit=limit
        )
    return PeriodListResponse(items=[_out(r) for r in items], next_cursor=next_cursor)
