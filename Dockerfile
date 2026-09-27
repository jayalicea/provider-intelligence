# Backend image per phynpi.md §9.1, adjusted: Node 20 LTS base (matches the
# Express 4 / pg 8 stack), no Redis (the codebase does not use it — the
# REDIS_* variables in .env are unused), and no secrets baked in (compose
# injects the environment; .env is never COPYed — see .dockerignore).
FROM node:20-alpine

WORKDIR /app

# Install dependencies first for layer caching. Lockfile is required.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# npm can crash mid-install ("Exit handler never called") yet exit 0, leaving
# empty package directories and an image that fails only at runtime. Fail
# the build instead unless every production dependency actually resolves.
RUN node -e "Object.keys(require('./package.json').dependencies).forEach(d => require.resolve(d))"

# Application code (see .dockerignore for what is excluded).
COPY src ./src

EXPOSE 3000

CMD ["node", "src/app.js"]
