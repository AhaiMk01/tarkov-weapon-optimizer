FROM python:3.12-slim AS builder

WORKDIR /app

RUN pip install uv

COPY pyproject.toml .
RUN uv sync --frozen --no-dev

FROM node:22-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

RUN pip install uv

COPY --from=builder /app/.venv /app/.venv
COPY backend/ ./backend/
COPY tasks.json ./
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

ENV PATH="/app/.venv/bin:$PATH"
ENV PYTHONUNBUFFERED=1

EXPOSE 15000

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "15000"]
