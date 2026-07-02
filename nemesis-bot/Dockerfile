# Nemesis AI 사이드카(FastAPI /ai/*). compose가 빌드·기동.
FROM python:3.12-slim

WORKDIR /app

# requirements 에 fastapi/uvicorn 이 없어 명시 추가(사이드카 런타임 필수).
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt fastapi "uvicorn[standard]"

COPY . .

EXPOSE 18900
# 모델/프로바이더는 Nemesis 시스템설정(/api/ai/llm-config)에서 받아 단일출처로 동작.
CMD ["python", "-m", "uvicorn", "nemesis_service:app", "--host", "0.0.0.0", "--port", "18900"]
