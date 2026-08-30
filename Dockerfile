FROM node:20-alpine AS base
WORKDIR /app

FROM base AS backend-deps
COPY backend/package*.json ./
RUN npm ci --production

FROM base AS backend-build
COPY backend/package*.json ./
RUN npm ci
COPY backend/ .
RUN npm run build

FROM base AS frontend-deps
COPY frontend/package*.json ./
RUN npm ci

FROM base AS frontend-build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app

COPY --from=backend-deps /app/node_modules ./backend/node_modules
COPY --from=backend-build /app/dist ./backend/dist
COPY backend/package.json ./backend/

COPY --from=frontend-deps /app/node_modules ./frontend/node_modules
COPY --from=frontend-build /app/.next ./frontend/.next
COPY --from=frontend-build /app/public ./frontend/public
COPY frontend/package.json ./frontend/
COPY frontend/next.config.js ./frontend/

EXPOSE 3000 3001

CMD ["sh", "-c", "cd backend && node dist/index.js & cd frontend && npx next start -p 3000"]
