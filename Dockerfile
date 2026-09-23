# ============================================================
# Tools API — Dockerfile (multi-stage)
# ============================================================
# Tool execution hub — Express server with Playwright browser
# automation, Python interpreter, Chart.js rendering, and
# 150+ tool schemas. Uses boot.js to fetch secrets from Vault
# at startup.
# ============================================================

# ── Stage 1: Build ─────────────────────────────
FROM node:26-slim AS build

# Native module build tools (chart.js canvas, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN npm install -g pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Skip Playwright's bundled browser download — we install system Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
# Install ALL dependencies (including dev) so tsc can build
RUN --mount=type=ssh \
    --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy application source
COPY . .

# Typecheck TypeScript (runtime executes src/ directly via Node type stripping)
RUN pnpm run typecheck

# Prune devDependencies to save space in the final image
RUN pnpm prune --prod

# ── Stage 2: Runtime ──────────────────────────────────────────
FROM node:26-slim

# Chromium (Playwright), Python 3 (interpreter), FFmpeg (media),
# wget (healthcheck), git (agentic git tools), espeak-ng (local TTS),
# yt-dlp (YouTube/Reddit video downloads).
# numpy / pandas / matplotlib are what execute_python's description
# promises (figures are auto-captured), and Pillow is what agents reach for
# to edit an attached image — none were installed, so 7 of Lupos's 10
# execute_python runs (30 days to 2026-09-22) died on an ImportError.
# Debian's builds: prebuilt, and they import in ~0.6 s under the sandbox's
# RLIMIT_DATA cap (verified on node:26-slim as a no-home system user).
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    python3 \
    python3-pip \
    python3-numpy \
    python3-pandas \
    python3-matplotlib \
    python3-pil \
    ffmpeg \
    fonts-liberation \
    ca-certificates \
    wget \
    git \
    imagemagick \
    espeak-ng \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Point Playwright to system Chromium
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Non-root user — created before COPY so --chown can reference it.
# This avoids a slow `chown -R /app` over tens of thousands of files
# (node_modules + static datasets) that was timing out the build.
RUN groupadd --system --gid 1001 toolsapi && \
    useradd --system --uid 1001 --gid toolsapi toolsapi

# Copy node_modules and source from build stage
COPY --chown=toolsapi:toolsapi --from=build /app/node_modules ./node_modules
COPY --chown=toolsapi:toolsapi --from=build /app/src ./src
COPY --chown=toolsapi:toolsapi package.json ./package.json

# Workspace-agent standalone files (copied by PRE_BUILD hook in deploy.sh)
# Used by MinioService to seed MinIO for SEA compilation in production
COPY --chown=toolsapi:toolsapi vendor/ ./vendor/

USER toolsapi

EXPOSE 5590

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 -O /dev/null http://127.0.0.1:5590/health || exit 1

CMD ["node", "src/boot.ts"]
