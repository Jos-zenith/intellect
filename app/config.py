from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    next_public_supabase_url: str = ""
    next_public_supabase_publishable_default_key: str = ""
    supabase_database_url: str = ""
    supabase_db_host: str = ""
    supabase_db_port: int = 5432
    supabase_db_name: str = ""
    supabase_db_user: str = ""
    supabase_db_password: str = ""
    supabase_db_sslmode: str = "require"
    supabase_pool_min_size: int = 1
    supabase_pool_max_size: int = 10
    supabase_connect_timeout_seconds: int = 10
    supabase_retry_attempts: int = 3
    allow_start_without_db: bool = False

    openai_api_key: str = ""
    llama_parse_api_key: str = ""
    openai_model: str = "o1-preview"
    openai_embed_model: str = "text-embedding-3-large"

    bolt_database_url: str = ""
    bolt_db_host: str = ""
    bolt_db_port: int = 5432
    bolt_db_name: str = ""
    bolt_db_user: str = ""
    bolt_db_password: str = ""
    bolt_db_sslmode: str = "require"
    bolt_pool_min_size: int = 1
    bolt_pool_max_size: int = 10
    bolt_connect_timeout_seconds: int = 10
    bolt_retry_attempts: int = 3

    api_auth_enabled: bool = False
    api_keys_csv: str = ""
    api_rate_limit_per_minute: int = 120
    api_rate_limit_window_seconds: int = 60

    chroma_path: str = "./data/chroma"
    chroma_collection_prefix: str = "ekg_notes"
    chroma_namespace: str = "default"
    chroma_isolate_by_week: bool = True
    upload_path: str = "./data/uploads"
    audit_db_path: str = "./data/audit.db"
    top_k: int = 6


settings = Settings()
