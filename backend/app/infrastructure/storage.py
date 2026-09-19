"""Cloudflare R2 via API S3.

O backend nunca vê os bytes: ele assina uma URL e sai da frente. Cem megabytes
atravessando a instância seriam lentos e comeriam memória — o browser fala direto
com o bucket, e é por isso que a política de CORS do R2 precisa liberar a origem do
frontend.
"""

from __future__ import annotations

from collections.abc import Sequence

import boto3
from botocore.config import Config
from starlette.concurrency import run_in_threadpool

from app.domain.entities import CaptureFile


def object_key(file: CaptureFile) -> str:
    """A chave é derivada, nunca gravada.

    Os três ids vêm de linhas do banco e `kind` é enum, então nenhum pedaço vem de
    texto do cliente — não há como injetar `../` e escapar do prefixo do dono. Não
    guardar a chave elimina de saída a classe de bug "banco discorda do bucket".
    """
    return f"{file.owner_id}/{file.encounter_id}/{file.capture_id}/{file.kind.value}"


class R2Storage:
    def __init__(
        self,
        *,
        endpoint: str,
        bucket: str,
        access_key_id: str,
        secret_access_key: str,
        url_ttl_seconds: int,
        read_ttl_seconds: int = 900,
    ) -> None:
        self._bucket = bucket
        self._ttl = url_ttl_seconds
        self._read_ttl = read_ttl_seconds
        self._client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name="auto",  # R2 não tem regiões; o assinador exige algo
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )

    def presign_put(self, file: CaptureFile, content_type: str) -> str:
        # Cálculo local: assinar não toca a rede, então não precisa de threadpool.
        #
        # `ContentType` entra na assinatura, então o browser é obrigado a mandar
        # exatamente este cabeçalho — e ele precisa estar liberado no CORS do bucket.
        return self._client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self._bucket,
                "Key": object_key(file),
                "ContentType": content_type,
            },
            ExpiresIn=self._ttl,
        )

    def presign_get(self, file: CaptureFile) -> str:
        """Leitura assinada por 15 min.

        Bem mais curta que a de escrita (1 h): esta URL chega ao browser e entra no
        `src` de imagens, então vaza com facilidade — em log de proxy, em captura de
        tela, no histórico. Quinze minutos cobrem uma consulta aberta e reduzem a
        janela de quem a encontrar depois.
        """
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": object_key(file)},
            ExpiresIn=self._read_ttl,
        )

    async def delete(self, files: Sequence[CaptureFile]) -> None:
        """Apaga em lote, em blocos de 1000 — o limite do delete_objects do S3.

        Chave inexistente não é erro: o objeto pode nunca ter subido (upload
        interrompido) e o resultado desejado é o mesmo.
        """
        if not files:
            return

        chaves = [{"Key": object_key(file)} for file in files]

        def _apagar() -> None:
            for inicio in range(0, len(chaves), 1000):
                self._client.delete_objects(
                    Bucket=self._bucket,
                    Delete={"Objects": chaves[inicio : inicio + 1000], "Quiet": True},
                )

        await run_in_threadpool(_apagar)
