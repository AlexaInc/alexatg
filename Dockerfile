FROM node:20-slim

ENV DEBIAN_FRONTEND=noninteractive

# 1. Install minimal system dependencies
RUN apt-get update && apt-get install -y \
    fonts-noto-core \
    python3 \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 2. Copy manifests first for better layer caching
COPY package.json package-lock.json ./

# 3. Install Node.js dependencies (reproducible via lockfile, with fallback)
RUN npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund \
    || npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

# 4. Rebuild native modules if prebuilt binaries were unavailable
RUN npm rebuild canvas sharp --force || true

# 5. Copy project files
COPY . .

ENV NODE_ENV=production
EXPOSE 7860

# 6. Startup: write .env from secrets if provided, then start
CMD ["sh", "-c", "if [ -n \"$ENV_FILE_CONTENT\" ]; then echo \"$ENV_FILE_CONTENT\" > .env; fi && node index.js"]
