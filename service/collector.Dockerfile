FROM node:22-bookworm-slim
WORKDIR /app
COPY skills/hot-pick/scripts/*.mjs ./skills/hot-pick/scripts/
COPY config/catalog.json ./config/catalog.json
COPY scripts/catalog-export.mjs ./scripts/catalog-export.mjs
COPY service/collect.mjs service/snapshot.mjs ./service/
RUN install -d -o node -g node /data/cache /snapshots
USER node
ENV CATALOG_CACHE=/data/cache CATALOG_FILE=/snapshots/catalog.json
CMD ["node", "service/collect.mjs"]
