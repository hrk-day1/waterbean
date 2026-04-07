# waterbean monorepo: API + Waterbean UI static (single Cloud Run service)
FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
COPY api/package.json api/
COPY waterbean/package.json waterbean/
COPY web/package.json web/

RUN npm ci

COPY api api
COPY waterbean waterbean

RUN npm run build -w api -w waterbean

FROM node:20-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json .npmrc ./
COPY api/package.json api/
COPY waterbean/package.json waterbean/
COPY web/package.json web/

RUN npm ci --omit=dev

COPY --from=build /app/api/dist api/dist
COPY --from=build /app/waterbean/dist waterbean/dist

RUN chown -R node:node /app

USER node

EXPOSE 8080

CMD ["node", "api/dist/index.js"]
