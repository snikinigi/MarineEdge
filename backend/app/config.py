"""Settings come from environment variables (and an optional .env file). No secrets live in code."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    # docker-compose overrides this. The default is for running the backend outside Docker.
    database_url: str = "postgresql+psycopg://marineedge:change-me@localhost:5432/marineedge"
    # Used from Task 7 (the recorder). Empty until then.
    aisstream_api_key: str = ""
    # The recorder listens inside this box, written "lat1,lon1,lat2,lon2". The default is the Oman, UAE and
    # Iran (Hormuz) box that collect.mjs uses today. Widen it only after checking the free server can cope.
    recorder_bbox: str = "16.5,51.0,28.0,61.0"


settings = Settings()
