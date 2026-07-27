"""Application error taxonomy. Clients receive a category, never internals (gate 1.6)."""

from enum import StrEnum


class ErrorCategory(StrEnum):
    VALIDATION = "validation_error"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    UNAUTHENTICATED = "unauthenticated"
    FORBIDDEN = "forbidden"
    INTERNAL = "internal_error"


class AppError(Exception):
    """Base application error. The message is internal-only."""

    status_code: int = 500
    category: ErrorCategory = ErrorCategory.INTERNAL


class NotFoundError(AppError):
    status_code = 404
    category = ErrorCategory.NOT_FOUND


class ConflictError(AppError):
    """Raised on optimistic-lock version mismatch and duplicates (gate 1.4)."""

    status_code = 409
    category = ErrorCategory.CONFLICT


class ForbiddenError(AppError):
    status_code = 403
    category = ErrorCategory.FORBIDDEN


class UnauthenticatedError(AppError):
    status_code = 401
    category = ErrorCategory.UNAUTHENTICATED
