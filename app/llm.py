import io

from openai import OpenAI

from app.config import settings


def get_openai_client() -> OpenAI:
    return OpenAI(api_key=settings.openai_api_key)


def embed_texts(texts: list[str]) -> list[list[float]]:
    client = get_openai_client()
    response = client.embeddings.create(
        model=settings.openai_embed_model,
        input=texts,
    )
    return [item.embedding for item in response.data]


def complete_text(system_prompt: str, user_prompt: str, temperature: float = 0.1) -> str:
    client = get_openai_client()
    response = client.responses.create(
        model=settings.openai_model,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=temperature,
    )
    return response.output_text.strip()


def transcribe_audio(file_name: str, audio_bytes: bytes) -> str:
    client = get_openai_client()
    audio_file = io.BytesIO(audio_bytes)
    audio_file.name = file_name
    response = client.audio.transcriptions.create(
        model="whisper-1",
        file=audio_file,
    )
    return response.text.strip()
