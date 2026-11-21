# syntax=docker/dockerfile:1
# Arka: one image serving the landing page, the web app and the API on one origin.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --ignore-scripts && npm rebuild esbuild
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web
RUN npm run build -w web && npm run build -w server

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --ignore-scripts -w server && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/package.json ./
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/package.json server/
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "server/dist/index.js"]
