"""Central configuration + provider-mode resolution.

Every external provider is optional. When its key is absent (or FORCE_MOCK=1),
the corresponding subsystem runs a deterministic mock so the whole app works
end-to-end with zero credentials. Set a key in `.env` to light up the real one.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"
KNOWLEDGE_BASE_DIR = REPO_ROOT / "knowledge_base"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- API keys (all optional -> mock when missing) ---
    groq_api_key: str | None = None
    gemini_api_key: str | None = None
    google_api_key: str | None = None  # some SDKs read GOOGLE_API_KEY
    nvidia_nim_api_key: str | None = None  # NVIDIA NIM embeddings (nv-embedqa)
    neo4j_uri: str | None = None
    neo4j_username: str = "neo4j"
    neo4j_password: str | None = None
    supabase_url: str | None = None
    supabase_key: str | None = None
    langsmith_api_key: str | None = None

    # --- Model names ---
    groq_llm_model: str = "llama-3.3-70b-versatile"
    groq_router_model: str = "llama-3.1-8b-instant"
    groq_stt_model: str = "whisper-large-v3-turbo"
    gemini_model: str = "gemini-2.5-flash"
    gemini_embed_model: str = "models/gemini-embedding-001"
    nim_base_url: str = "https://integrate.api.nvidia.com/v1"
    nim_embed_model: str = "nvidia/nv-embedqa-e5-v5"  # 1024-d

    # --- Embeddings provider selection: auto | gemini | nim | mock ---
    embeddings_provider: str = "auto"

    # --- Behaviour / paths ---
    force_mock: bool = False
    demo_seed: bool = True  # set DEMO_SEED=0 in .env to start with an empty store
    chroma_dir: str = str(DATA_DIR / "chroma")
    sqlite_checkpoint: str = str(DATA_DIR / "checkpoints.sqlite")
    cors_origins: str = "*"

    # ---- Derived helpers ----
    @property
    def gemini_key(self) -> str | None:
        return self.gemini_api_key or self.google_api_key

    @property
    def use_real_llm(self) -> bool:
        return not self.force_mock and bool(self.groq_api_key or self.gemini_key)

    @property
    def use_real_stt(self) -> bool:
        return not self.force_mock and bool(self.groq_api_key)

    @property
    def use_real_embeddings(self) -> bool:
        return not self.force_mock and bool(self.gemini_key or self.nvidia_nim_api_key)

    @property
    def resolved_embeddings_provider(self) -> str:
        """Which embeddings backend actually runs: gemini | nim | mock."""
        if self.force_mock:
            return "mock"
        if self.embeddings_provider != "auto":
            return self.embeddings_provider
        if self.gemini_key:
            return "gemini"
        if self.nvidia_nim_api_key:
            return "nim"
        return "mock"

    @property
    def use_real_graph(self) -> bool:
        return not self.force_mock and bool(self.neo4j_uri and self.neo4j_password)

    @property
    def use_real_db(self) -> bool:
        return not self.force_mock and bool(self.supabase_url and self.supabase_key)

    def provider_status(self) -> dict[str, str]:
        """Human-readable map of which subsystems are live vs mock — for /health."""
        flag = lambda real: "real" if real else "mock"  # noqa: E731
        emb_provider = self.resolved_embeddings_provider
        return {
            "llm": flag(self.use_real_llm),
            "stt": flag(self.use_real_stt),
            "embeddings": flag(emb_provider != "mock"),
            "embeddings_provider": emb_provider,
            "graph_db": flag(self.use_real_graph),
            "work_order_db": flag(self.use_real_db),
            "force_mock": str(self.force_mock).lower(),
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
