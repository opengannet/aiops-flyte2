FROM docker.fzyun.io/python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_INDEX_URL=https://pypi.fzyun.io/simple

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir requests minio

COPY aione_downloads.py /app/aione_downloads.py

CMD ["python", "/app/aione_downloads.py"]
