from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    openai_api_key: str = ""
    llama_parse_api_key: str = ""
    openai_model: str = "o1-preview"
    openai_embed_model: str = "text-embedding-3-large"

    chroma_path: str = "./data/chroma"
    upload_path: str = "./data/uploads"
    audit_db_path: str = "./data/audit.db"
    top_k: int = 6


settings = Settings()
