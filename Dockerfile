# Backend image per phynpi.md §9.1, adjusted: Node 20 LTS base (matches the
# Express 4 / pg 8 stack), no Redis (the codebase does not use it — the
# REDIS_* variables in .env are unused), and no secrets baked in (compose
# injects the environment; .env is never COPYed — see .dockerignore).
FROM node:20-alpine

WORKDIR /app

# Install dependencies first for layer caching. Lockfile is required.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Application code (see .dockerignore for what is excluded).
COPY src ./src

EXPOSE 3000

CMD ["node", "src/app.js"]
