FROM node:22.23.5-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY ai-server.tgz /tmp/ai-server.tgz
RUN npm install --omit=dev --prefix /opt/ai /tmp/ai-server.tgz \
    && npm cache clean --force \
    && rm /tmp/ai-server.tgz \
    && mkdir -p /data \
    && chown node:node /data

ENV BB_OWNER_AUTH=true BB_TELEMETRY=false BB_DATA_DIR=/data
USER node
EXPOSE 38886
ENTRYPOINT ["node", "/opt/ai/node_modules/bb-app/dist/bb-server.js", "--data-dir", "/data", "--server-bind-host", "0.0.0.0", "--server-port", "38886"]
