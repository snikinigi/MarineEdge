"""Settings come from environment variables (and an optional .env file). No secrets live in code."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # docker-compose overrides this. The default is for running the backend outside Docker.
    database_url: str = "postgresql+psycopg://marineedge:change-me@localhost:5432/marineedge"
    # Used from Task 7 (the recorder). Empty until then.
    aisstream_api_key: str = ""


settings = Settings()
