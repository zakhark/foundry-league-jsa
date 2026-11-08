# Builder image: downloads the sheet and generates the static site.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY scripts scripts
COPY src src
COPY team-links.json game-videos.json game-center.json ./
# Refresh the site every REFRESH_SECONDS (default 15 min) into /app/dist.
ENV REFRESH_SECONDS=900
CMD ["sh", "-c", "while true; do node scripts/fetch.js && (node scripts/find-videos.js || true) && node scripts/build.js || echo 'Refresh failed, keeping previous site'; sleep $REFRESH_SECONDS; done"]
