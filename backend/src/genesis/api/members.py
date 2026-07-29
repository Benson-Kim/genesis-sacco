"""Members endpoints: CRUD, status transitions, statement (P8, gate 1.6).

Every route carries a RequirePermission dependency (deny-by-default);
mutations are idempotent via the Idempotency-Key middleware (gate 1.4).
Terminal exit is owned exclusively by the P12 settlement workflow
(/member-exits; issue #14 resolved): direct status changes to 'exited'
are rejected by the service with 409.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from genesis.api.authz import RequirePermission
from genesis.application import members as members_service
from genesis.application.auth import AuthContext
from genesis.domain.members import MemberStatus, MemberType
from genesis.domain.rbac import Action, Module
from genesis.infrastructure.db import get_sessionmaker
from genesis.infrastructure.tenancy import tenant_session
from genesis.settings import get_settings

router = APIRouter(prefix="/members", tags=["members"])

_view = RequirePermission(Module.MEMBERS, Action.VIEW)
_create = RequirePermission(Module.MEMBERS, Action.CREATE)
_edit = RequirePermission(Module.MEMBERS, Action.EDIT)

ViewCtx = Annotated[AuthContext, Depends(_view)]
CreateCtx = Annotated[AuthContext, Depends(_create)]
EditCtx = Annotated[AuthContext, Depends(_edit)]


class MemberCreateBody(BaseModel):
    type: MemberType
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=254)


class MemberUpdateBody(BaseModel):
    version: int = Field(ge=1)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=254)


class MemberStatusBody(BaseModel):
    version: int = Field(ge=1)
    status: MemberStatus


class MemberOut(BaseModel):
    id: str
    member_no: str
    type: str
    name: str
    phone: str | None
    email: str | None
    status: str
    version: int


class MemberListResponse(BaseModel):
    items: list[MemberOut]
    next_cursor: str | None


class StatementLineOut(BaseModel):
    occurred_at: str
    txn_ref: str
    type: str
    channel: str
    amount: str


class StatementResponse(BaseModel):
    items: list[StatementLineOut]
    next_cursor: str | None


def _out(record: members_service.MemberRecord) -> MemberOut:
    return MemberOut(
        id=str(record.id),
        member_no=record.member_no,
        type=record.type.value,
        name=record.name,
        phone=record.phone,
        email=record.email,
        status=record.status.value,
        version=record.version,
    )


@router.post("", status_code=201)
async def create_member(body: MemberCreateBody, ctx: CreateCtx) -> MemberOut:
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        record = await members_service.create_member(
            session,
            ctx.tenant_id,
            ctx.user_id,
            member_type=body.type,
            name=body.name,
            phone=body.phone,
            email=body.email,
        )
    return _out(record)


@router.get("")
async def list_members(
    ctx: ViewCtx,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    status: MemberStatus | None = None,
    member_type: Annotated[MemberType | None, Query(alias="type")] = None,
) -> MemberListResponse:
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        page = await members_service.list_members(
            session,
            cursor=cursor,
            limit=limit,
            status=status,
            member_type=member_type,
        )
    return MemberListResponse(items=[_out(r) for r in page.items], next_cursor=page.next_cursor)


@router.get("/{member_id}/statement")
async def member_statement(
    member_id: uuid.UUID,
    ctx: ViewCtx,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> StatementResponse:
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        page = await members_service.member_statement(
            session,
            member_id,
            cursor=cursor,
            limit=limit,
        )
    return StatementResponse(
        items=[
            StatementLineOut(
                occurred_at=line.occurred_at.isoformat(),
                txn_ref=line.txn_ref,
                type=line.type,
                channel=line.channel,
                amount=line.amount,
            )
            for line in page.items
        ],
        next_cursor=page.next_cursor,
    )


@router.get("/{member_id}")
async def get_member(member_id: uuid.UUID, ctx: ViewCtx) -> MemberOut:
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        record = await members_service.get_member(session, member_id)
    return _out(record)


@router.put("/{member_id}")
async def update_member(member_id: uuid.UUID, body: MemberUpdateBody, ctx: EditCtx) -> MemberOut:
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        record = await members_service.update_member(
            session,
            ctx.tenant_id,
            ctx.user_id,
            member_id,
            version=body.version,
            name=body.name,
            phone=body.phone,
            email=body.email,
        )
    return _out(record)


@router.post("/{member_id}/status")
async def change_status(member_id: uuid.UUID, body: MemberStatusBody, ctx: EditCtx) -> MemberOut:
    """Active<->Arrears only; 'exited' is owned by the P12 settlement workflow."""
    factory = get_sessionmaker(get_settings().database_url)
    async with tenant_session(factory, ctx.tenant_id) as session:
        record = await members_service.change_member_status(
            session,
            ctx.tenant_id,
            ctx.user_id,
            member_id,
            version=body.version,
            new_status=body.status,
        )
    return _out(record)
