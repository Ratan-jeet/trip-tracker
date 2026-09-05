# syntax=docker/dockerfile:1
#
# Two build targets: `api` and `web`. Build them separately.
#
#   docker build --target api -t trip-tracker-api .
#   docker build --target web -t trip-tracker-web .
#
# The previous Dockerfile could not build at all: it ran `npm ci` inside backend/ and
# frontend/, but this is an npm-workspaces repo with a single root package-lock.json and
# no per-workspace lockfile, so npm ci exited immediately. It also ran both services from
# one shell as PID 1, so a crashed API left a container that still looked healthy.
#
# Debian rather than Alpine: better-sqlite3 and bcrypt publish glibc prebuilds, so no
# compiler toolchain is needed in the image.

FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# ---------------------------------------------------------------------------
# Dependencies (root lockfile, all workspaces)
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --include=dev

# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
FROM deps AS api-build
COPY backend ./backend
RUN npm run build --workspace=backend

FROM base AS api
ENV PORT=3001
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
# Production dependency tree only — dev dependencies stay out of the runtime image.
RUN npm ci --omit=dev --workspace=backend --include-workspace-root
COPY --from=api-build /app/backend/dist ./backend/dist

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Exec form, so the process is PID 1 and receives SIGTERM directly.
CMD ["node", "backend/dist/index.js"]

# ---------------------------------------------------------------------------
# Web
# ---------------------------------------------------------------------------
FROM deps AS web-build
COPY frontend ./frontend
# NEXT_PUBLIC_* values are inlined at build time, so they must be present here.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ARG NEXT_PUBLIC_WS_URL=ws://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace=frontend

FROM base AS web
ENV PORT=3000 NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --omit=dev --workspace=frontend --include-workspace-root
COPY --from=web-build /app/frontend/.next ./frontend/.next
COPY --from=web-build /app/frontend/next.config.js ./frontend/
COPY --from=web-build /app/frontend/public ./frontend/public

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "next", "start", "frontend", "-p", "3000"]
