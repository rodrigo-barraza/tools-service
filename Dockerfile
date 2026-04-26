# ============================================================
# Tools API — Dockerfile (multi-stage)
# ============================================================
# Tool execution hub — Express server with Playwright browser
# automation, Python interpreter, Chart.js rendering, and
# 150+ tool schemas. Uses boot.js to fetch secrets from Vault
# at startup.
# ============================================================

# ── Stage 1: Install dependencies ─────────────────────────────
FROM node:22-slim AS deps

# Native module build tools (chart.js canvas, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./

# Skip Playwright's bundled browser download — we install system Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev

# ── Stage 2: Runtime ──────────────────────────────────────────
FROM node:22-slim

# Chromium (Playwright), Python 3 (interpreter), FFmpeg (media),
# wget (healthcheck), git (agentic git tools)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    python3 \
    ffmpeg \
    fonts-liberation \
    ca-certificates \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/*

# Point Playwright to system Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy pre-built node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Non-root user for security
RUN groupadd --system --gid 1001 toolsapi && \
    useradd --system --uid 1001 --gid toolsapi toolsapi && \
    chown -R toolsapi:toolsapi /app
USER toolsapi

EXPOSE 5590

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:5590/health || exit 1

CMD ["node", "boot.js"]
