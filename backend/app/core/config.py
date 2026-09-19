from __future__ import annotations

import os
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # ENV_FILE escolhe o ambiente sem editar arquivo nenhum:
    #   ENV_FILE=.env.local  → Supabase e Postgres do Docker  (desenvolvimento)
    #   (padrão .env)        → projeto hospedado              (verificação)
    #
    # `.env.secrets` é lido DEPOIS e vence o anterior. Ele existe por um motivo
    # específico: `.env.local` é versionado — traz só as credenciais fixas e públicas
    # do Supabase CLI — então segredo real não pode entrar nele. Sem este segundo
    # arquivo, testar upload em desenvolvimento exigiria ou exportar variável na mão a
    # cada vez, ou colocar chave do R2 num arquivo que vai para o git.
    #
    # Ele é opcional: não existindo, é ignorado em silêncio.
    model_config = SettingsConfigDict(
        env_file=(os.getenv("ENV_FILE", ".env"), ".env.secrets"),
        extra="ignore",
    )

    database_url: str
    supabase_url: str
    supabase_jwks_url: str
    cors_origins: str = "http://localhost:4200"

    db_pool_min_size: int = 1
    db_pool_max_size: int = 10

    jwt_audience: str = "authenticated"

    # /docs e /openapi.json publicam o mapa da API — rotas, campos e enums de dado
    # clínico. Útil no desenvolvimento, reconhecimento gratuito em produção.
    docs_enabled: bool = True

    # Cloudflare R2. Opcionais: sem elas a API sobe e tudo funciona menos o upload de
    # capturas, que responde 503. É o que permite rodar a suíte e o desenvolvimento de
    # pacientes/consultas sem credencial de bucket.
    r2_endpoint: str = ""
    r2_bucket: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""

    #  Uma hora, como o plano especifica: tempo de sobra para ~100 MB numa rede ruim,
    #  e curto o bastante para uma URL vazada não valer muito.
    r2_url_ttl_seconds: int = 3600

    @property
    def r2_configured(self) -> bool:
        return bool(
            self.r2_endpoint
            and self.r2_bucket
            and self.r2_access_key_id
            and self.r2_secret_access_key
        )

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
        if "*" in origins:
            # O frontend tem origem conhecida, então o curinga nunca é a resposta certa
            # aqui — é o atalho de quem está tentando destravar um preflight. Recusar no
            # boot custa um deploy vermelho; aceitar custa a API aberta para qualquer site.
            raise ValueError("CORS_ORIGINS não aceita '*'; liste as origens explicitamente")
        return origins

    @property
    def jwt_issuer(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]  # valores vêm do ambiente
