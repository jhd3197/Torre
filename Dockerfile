# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS web
WORKDIR /src
COPY web/package.json web/package-lock.json web/
RUN npm ci --prefix web --no-audit --no-fund
COPY web/ web/
COPY torre/ torre/
RUN apt-get update && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*
ADD --checksum=sha256:3692f8a71a0a53e35df276642053ea68a6151771709e4e4536a323c3d0e5cdf1 \
    https://github.com/jhd3197/Torre/releases/download/art-2026-10-06/art-built.zip /tmp/art-built.zip
RUN unzip -q /tmp/art-built.zip -d web/public \
    && test -f web/public/art/logo/app-icon-64.png \
    && npm --prefix web run build

FROM python:3.12-slim-bookworm
ARG TORRE_VERSION=""
RUN apt-get update && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY LICENSE ./
COPY torre/ torre/
RUN if [ -n "$TORRE_VERSION" ]; then \
      sed -i "s/^__version__ = .*/__version__ = '$TORRE_VERSION'/" torre/__init__.py; \
    fi
COPY --from=web /src/torre/ui torre/ui/
LABEL org.opencontainers.image.source="https://github.com/jhd3197/Torre" \
      org.opencontainers.image.licenses="GPL-3.0-only"
ENV STOCKFISH_PATH=/usr/games/stockfish \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
RUN useradd --create-home --uid 10001 torre \
    && mkdir /data && chown torre:torre /data
USER torre
VOLUME /data
EXPOSE 1886
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:1886/', timeout=3)"
CMD ["python", "-m", "torre.server.studio", "--host", "0.0.0.0", "--port", "1886", "--data-dir", "/data"]
