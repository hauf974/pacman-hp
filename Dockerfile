# ── Stage 1: TypeScript build ────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Production runtime ──────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Static client files are served from src/client/ — copy as-is (no build step)
COPY src/client ./src/client

# Seed default maps; Docker copies these into a new named volume on first run
# (existing volume data is preserved across rebuilds / image updates)
COPY data/ ./data/
RUN mkdir -p /app/data/maps && chown -R node:node /app/data

USER node
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
