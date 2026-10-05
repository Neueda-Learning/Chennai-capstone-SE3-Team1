# A single-stage build - there's no compile step for Node. npm ci gets its own layer,
# ordered before the app code, so changing server.js doesn't invalidate the dependency
# install; npm ci (not install) because package-lock.json travels with this image and the
# build should reproduce exactly what it pins.
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js .

EXPOSE 4000
CMD ["node", "server.js"]
