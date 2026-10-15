# 每日練習（FastAPI）。練習紀錄資料庫放在 /app/data，用 volume 保存（見 docker-compose.yml）。
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PRACSYS_DB=/app/data/practice.db PRACSYS_POOL=/app/pool/pool.json
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
COPY data/pool.json ./pool/pool.json
EXPOSE 8100
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
