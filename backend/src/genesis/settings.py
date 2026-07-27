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


@lru_cache
def get_settings() -> Settings:
    return Settings()
