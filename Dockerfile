FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/app/data/scopepay.sqlite
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir -p /app/data && chown node:node /app/data
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "dist/server/server/index.js"]
