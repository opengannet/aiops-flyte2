FROM docker.fzyun.io/python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_INDEX_URL=https://pypi.fzyun.io/simple

WORKDIR /app

ARG DEBIAN_MIRROR=https://mirrors.fzyun.io/debian
ARG DEBIAN_SECURITY_MIRROR=https://mirrors.fzyun.io/debian-security

RUN set -eux; \
    . /etc/os-release; \
    rm -f /etc/apt/sources.list.d/debian.sources; \
    printf 'deb %s %s main\n' "$DEBIAN_MIRROR" "$VERSION_CODENAME" > /etc/apt/sources.list; \
    printf 'deb %s %s-updates main\n' "$DEBIAN_MIRROR" "$VERSION_CODENAME" >> /etc/apt/sources.list; \
    printf 'deb %s %s-security main\n' "$DEBIAN_SECURITY_MIRROR" "$VERSION_CODENAME" >> /etc/apt/sources.list; \
    apt-get -o Acquire::Retries=5 update \
    && DEBIAN_FRONTEND=noninteractive apt-get -o Acquire::Retries=5 install -y --no-install-recommends ca-certificates git git-lfs \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir requests minio

COPY aione_downloads.py /app/aione_downloads.py

CMD ["python", "/app/aione_downloads.py"]
