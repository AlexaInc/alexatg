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

# 2. Copy project files directly (Stealth)
COPY . .

# 3. Install Node.js dependencies
RUN npm install --omit=dev --legacy-peer-deps

# 4. Rebuild native modules
RUN npm rebuild canvas sharp --force

EXPOSE 7860

# 5. Startup: Use standard node runtime
CMD ["sh", "-c", "if [ -n \"$ENV_FILE_CONTENT\" ]; then echo \"$ENV_FILE_CONTENT\" > .env; fi && node index.js"]
