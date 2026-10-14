FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM node:20-alpine AS production

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

COPY package.json package-lock.json ./

RUN npm ci --omit=dev && \
    npm cache clean --force

COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist

USER nestjs

# The port is AUTH_SERVICE_PORT in Application/Config/services.env. docker-compose passes it as a
# build argument (a bare "docker build" must be given it too) and the service reads it at run time.
ARG AUTH_SERVICE_PORT
RUN test -n "$AUTH_SERVICE_PORT" || { echo "build with --build-arg AUTH_SERVICE_PORT=<the value in Application/Config/services.env>" >&2; exit 1; }
ENV AUTH_SERVICE_PORT=$AUTH_SERVICE_PORT
EXPOSE $AUTH_SERVICE_PORT

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider "http://localhost:${AUTH_SERVICE_PORT}/health" || exit 1

CMD ["node", "dist/main.js"]