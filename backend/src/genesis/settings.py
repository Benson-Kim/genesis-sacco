"""Environment-only configuration (MASTER_PROMPT gate 1.6: no literal secrets)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All values come from the environment; nothing is hardcoded."""

    model_config = SettingsConfigDict(frozen=True)

    database_url: str = ""
    redis_url: str = ""
    environment: str = "development"
    jwt_signing_key: str = ""
    otp_pepper: str = ""
    auth_rate_limit_per_minute: int = 60
    # Export configuration (P13): resolved exclusively server-side —
    # request bodies never carry formats, row limits, or storage
    # locations (gate 1.6; P13 blocker a).
    export_row_cap: int = 10_000
    export_batch_size: int = 500
    export_artifact_ttl_hours: int = 24
    export_npl_trend_months: int = 6


@lru_cache
def get_settings() -> Settings:
    return Settings()
