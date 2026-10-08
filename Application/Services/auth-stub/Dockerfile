FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js .

# The port is AUTH_STUB_PORT in Application/Config/services.env; docker-compose passes it as a build
# argument (a bare "docker build" must be given it too) and the stub reads it at run time.
ARG AUTH_STUB_PORT
RUN test -n "$AUTH_STUB_PORT" || { echo "build with --build-arg AUTH_STUB_PORT=<the value in Application/Config/services.env>" >&2; exit 1; }
ENV AUTH_STUB_PORT=$AUTH_STUB_PORT AUTH_STUB_HOST=0.0.0.0
EXPOSE $AUTH_STUB_PORT
CMD ["node", "server.js"]
