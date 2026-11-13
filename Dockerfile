# 独立部署镜像：构建 Nitro node-server 产物，运行时只需要 .output。
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN NITRO_PRESET=node-server node scripts/with-app-env.mjs vite build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
# 迁移脚本和依赖（pg）随镜像带上，启动前执行 `node scripts/migrate.mjs`。
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts/migrate.mjs /app/scripts/migration-plan.mjs ./scripts/
COPY --from=build /app/migrations ./migrations
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/migrate.mjs && node .output/server/index.mjs"]
