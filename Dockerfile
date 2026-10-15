FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
LABEL org.opencontainers.image.title="Fieldnotes" \
      org.opencontainers.image.description="Self-hosted, offline-first travel planner" \
      org.opencontainers.image.licenses="ISC"
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force \
  && mkdir -p /data && chown node:node /data
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/model.ts /app/src/seed.ts /app/src/locate.ts /app/src/calendar.ts /app/src/tripRoute.ts /app/src/catalogue.json ./src/
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["./node_modules/.bin/tsx", "server/index.ts"]
