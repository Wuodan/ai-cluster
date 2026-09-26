FROM node:26-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY test ./test
RUN npm run build

FROM node:26-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY package.json ./
RUN mkdir /data && chown node:node /data

USER node
CMD ["node", "dist/src/cli.js"]
