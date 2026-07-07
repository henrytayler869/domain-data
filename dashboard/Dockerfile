FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
# npm install (not ci) so linux swc native binding is fetched; retry flags for flaky bandwidth
RUN npm install --no-audit --no-fund --fetch-timeout=600000 --fetch-retries=6 --fetch-retry-mintimeout=20000 --fetch-retry-maxtimeout=120000
COPY . ./
# Turbopack needs native bindings; fall back to webpack if unavailable.
RUN npm run build || npx --yes next build --webpack

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/.env.local ./.env.local
EXPOSE 3000
CMD ["npm", "start"]
