# Contractly – self-hosted contract manager
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    HOME=/data \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CONTRACTLY_DATA_DIR=/data \
    CONTRACTLY_STATIC_DIR=/app/frontend \
    RCLONE_CONFIG=/data/rclone/rclone.conf \
    TZ=Europe/Berlin \
    FORWARDED_ALLOW_IPS="127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,fc00::/7"

# OCR (Tesseract + German language data), PDF text extraction (poppler) and rclone for cloud backups
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tesseract-ocr tesseract-ocr-deu poppler-utils rclone ca-certificates tzdata curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
# On ARM (Raspberry Pi, many NAS) SQLCipher is compiled from source (bundled, links OpenSSL);
# the build tools are removed again afterwards.
RUN if [ "$(uname -m)" != "x86_64" ]; then \
        apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev libssl-dev; \
    fi \
    && pip install -r backend/requirements.txt \
    && if [ "$(uname -m)" != "x86_64" ]; then \
        apt-get purge -y gcc libc6-dev libssl-dev && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*; \
    fi

COPY backend/app backend/app
COPY frontend frontend

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /data && chmod +x /usr/local/bin/docker-entrypoint.sh
# The entrypoint fixes /data ownership and drops privileges to PUID:PGID (default 1000:1000).
ENTRYPOINT ["docker-entrypoint.sh"]

VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8000/healthz || exit 1

WORKDIR /app/backend
# X-Forwarded-For/-Proto are only trusted from proxies in private networks (FORWARDED_ALLOW_IPS),
# so clients on the internet can't fake their address to dodge the login limits.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-server-header"]
