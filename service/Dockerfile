FROM node:22-bookworm-slim
WORKDIR /app
COPY server.mjs snapshot.mjs ./
USER node
ENV CATALOG_FILE=/snapshots/catalog.json
EXPOSE 8080
CMD ["node", "server.mjs"]
