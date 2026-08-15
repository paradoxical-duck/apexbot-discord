FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/bot/package.json apps/bot/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run build -w @apexbot/shared && npm run build -w @apexbot/bot && npm run build -w @apexbot/dashboard

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
COPY apps/bot/package.json apps/bot/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --omit=dev --workspace=@apexbot/bot --workspace=@apexbot/shared
COPY --from=build /app/apps/bot/dist apps/bot/dist
COPY --from=build /app/apps/dashboard/dist apps/dashboard/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
USER node
EXPOSE 8080
CMD ["node", "apps/bot/dist/index.js"]
