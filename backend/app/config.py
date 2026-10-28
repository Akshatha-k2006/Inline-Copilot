from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

BACKEND_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    database_url: str
    cors_origins: str = "http://localhost:3000"
    llm_api_key: str | None = None
    llm_api_url: str = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    llm_model: str = "gemini-2.5-flash"
    llm_timeout_seconds: int = Field(default=15, gt=0)

    model_config = SettingsConfigDict(
        env_file=BACKEND_ENV_FILE,
        extra="ignore",
    )

settings = Settings()