# Trip Tracker

Live location sharing for people travelling together. Everyone in a trip sees each other on
one map, and every person controls whether they appear on it.

## What this is

- **Consent is the product.** Nothing is shared until you switch it on, and switching it off
  takes effect immediately — the position disappears from every other member's map and the
  device stops reporting.
- **One shared map.** Phones and vehicle trackers on the same view, with live speed, battery
  and distance-to-destination.
- **Data that expires.** Positions are deleted after `LOCATION_EXPIRY_DAYS` (30 by default),
  and any member can erase their own history for a trip at any time.

## Stack

| Layer | Technology |
|---|---|
| Web | Next.js 14 (App Router), React 18, Tailwind, MapLibre GL + OpenStreetMap tiles |
| API | Node 20, Fastify 4, native WebSockets |
| Database | PostgreSQL (production) · SQLite via better-sqlite3 (local) |
| Live state | Redis when `REDIS_URL` is set, in-process otherwise |
| Auth | JWT with token versioning, bcrypt, optional TOTP 2FA with recovery codes |

## Quick start

Requires Node 20.11 or newer.

```bash
npm ci
cp backend/.env.example backend/.env          # works as-is for local development
cp frontend/.env.local.example frontend/.env.local
npm run db:migrate                            # creates ./backend/trip_together.db
npm run db:seed                               # optional demo accounts
npm run dev                                   # API on :3001, web on :3000
```

`docker compose up -d` starts PostgreSQL and Redis if you want to develop against them;
set `DATABASE_URL` and `REDIS_URL` in `backend/.env` to use them.

Seeded accounts are `alice@example.com` and `bob@example.com`, password `password123`.
Both start with sharing **off** — turn it on from the trip screen.

## How location reaches the server

`POST /api/location/update` accepts two kinds of caller:

**A signed-in member's phone.** Send `Authorization: Bearer <jwt>`. The device must belong
to the caller, and the caller must currently be sharing on that trip.

**A vehicle tracker.** Register a `vehicle` device; the response contains a `deviceToken`,
returned exactly once. The tracker then sends:

```bash
curl -X POST https://your-api/api/location/update \
  -H 'Content-Type: application/json' \
  -H 'X-Device-Token: <deviceToken>' \
  -d '{"tripId":"...","deviceId":"...","lat":15.5,"lng":73.8,"speed":16.6,"ignitionStatus":true}'
```

An unauthenticated request is rejected. Client-supplied `timestamp` values outside the
configured skew window are replaced with server time.

To bridge an MQTT broker, subscribe to your tracker topic and forward each message to the
same endpoint with the device's token. `backend/src/mqtt/handler.ts` is the place for it.

## API

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` | |
| POST | `/api/auth/login` | Returns `{requiresTwoFactor:true}` when 2FA is on |
| GET | `/api/auth/me` | |
| POST | `/api/auth/2fa/enable` | Requires the account password |
| POST | `/api/auth/2fa/verify` | Enables 2FA, returns one-time recovery codes |
| POST | `/api/auth/2fa/disable` | Requires password **and** a current code |
| POST | `/api/auth/logout-all` | Invalidates every issued token |

### Trips
| Method | Path | Notes |
|---|---|---|
| POST | `/api/trips` | |
| GET | `/api/trips` | |
| GET | `/api/trips/:id` | Members, devices, route |
| POST | `/api/trips/join` | Invite code is case-insensitive |
| POST | `/api/trips/:id/share` | `{isSharing: true \| false}` — both directions |
| POST | `/api/trips/:id/leave` | |
| POST | `/api/trips/:id/end` | Creator only |
| DELETE | `/api/trips/:id` | Creator only |
| POST | `/api/trips/:id/remove-member` | Admin only; rotates the invite code |
| POST | `/api/trips/:id/promote` | Admin only; the creator cannot be demoted |
| POST | `/api/trips/:id/invite-code` | Admin only; issues a new code |
| POST · DELETE | `/api/trips/:id/route` | Admin only |

### Locations
| Method | Path | Notes |
|---|---|---|
| POST | `/api/devices` | Vehicle devices receive a `deviceToken` |
| GET | `/api/trips/:id/devices` | |
| DELETE | `/api/devices/:id` | Owner or admin |
| POST | `/api/location/update` | See above |
| GET | `/api/trips/:id/live` | Only members who are currently sharing |
| GET | `/api/trips/:id/history` | Paginated, capped by `HISTORY_MAX_ROWS` |
| GET | `/api/trips/:id/export` | `format=csv\|gpx\|json` |
| DELETE | `/api/trips/:id/my-data` | Erase your own recorded positions |
| GET | `/api/trips/:id/routing` | OSRM proxy |
| GET | `/api/trips/:id/geocode` | Place search proxy |

### WebSocket

Connect to `/ws`, then:

```jsonc
{"type": "auth", "token": "<jwt>"}          // wait for {"type":"auth_success"}
{"type": "subscribe_trip", "tripId": "..."} // then {"type":"initial_locations", ...}
```

Server messages: `location_update`, `initial_locations`, `route_update`, `members_changed`,
`devices_changed`, `access_revoked`, `trip_ended`, `trip_deleted`.

## Configuration

Everything is validated at boot from `backend/.env`; see `backend/.env.example` for the full
list. In production the server **refuses to start** without a `JWT_SECRET` of at least 32
characters and a `DATABASE_URL`.

Notable settings:

| Variable | Purpose |
|---|---|
| `DATABASE_SSL` | `strict` (verify certificates, default) · `no-verify` · `off` |
| `REDIS_URL` | Required for more than one API instance |
| `OSRM_URL` | Point at your own OSRM; the public demo server is not for production |
| `GEOCODER_USER_AGENT` | Nominatim requires a contact address |
| `LOCATION_EXPIRY_DAYS` | Retention window, swept every `RETENTION_SWEEP_HOURS` |

## Privacy notes

- Routing and place search are proxied through the API, so member coordinates and search
  queries never go from the browser to a third party.
- Consent, membership changes, history reads and exports are written to `audit_logs`.
  Individual GPS fixes are not — the `locations` table is that record.
- Removing a member rotates the trip's invite code so they cannot rejoin with the old one.

## Deployment

### Render (both services)

`render.yaml` is a complete blueprint: API, web app and PostgreSQL, all on the free tier.

1. Push this repo to GitHub.
2. Render dashboard → **New** → **Blueprint** → select the repo.
3. Render prompts for the one value it cannot derive: `GEOCODER_USER_AGENT`. Nominatim's
   usage policy requires a contact address, so use something like
   `TripTracker/2.0 (you@example.com)`.

Everything else is wired automatically — the database URL, a generated `JWT_SECRET`, and
the two services pointing at each other. `CORS_ORIGIN` and `NEXT_PUBLIC_API_URL` come from
Render's `fromService` wiring as bare hostnames; the app adds the `https://`/`wss://`
scheme itself, so there is nothing to paste by hand.

Know these three things before you rely on it:

| | |
|---|---|
| **Free services sleep** | After 15 minutes without traffic, and take about a minute to wake. The first person to open the app after a quiet spell waits for that. |
| **Free PostgreSQL expires** | Render deletes a free database 30 days after creation. Change both `plan: free` lines to `plan: starter` for anything you intend to keep. |
| **Live state is per-process** | Without `REDIS_URL` the live positions and WebSocket fan-out live in one process, which is all a free single-instance service has. Sleeping clears them; they rebuild from the next report, and the consent sweep runs on wake so nobody stays marked as sharing. |

`region: oregon` matches the existing deployment and the database. A service cannot be
moved between regions, and it can only reach the database over the internal network when
both are in the same one — so changing region means recreating all three resources with
new URLs.

Three details in the blueprint that are easy to get wrong if you rewrite it:

- the build commands need `npm ci --include=dev` — with `NODE_ENV=production` set, npm
  otherwise skips the devDependencies that `tsc` and `next build` live in;
- `rootDir: .` is explicit, because the v1 blueprint set `rootDir: backend`/`frontend` and
  `npm ci` fails inside a workspace directory that has no lockfile of its own;
- `JWT_SECRET` must be at least 32 characters or the API refuses to start.

### Vercel (web app only)

`vercel deploy`. Set `NEXT_PUBLIC_API_URL` to the API's origin; the WebSocket URL is
derived from it.

### Docker

Two targets rather than one container running both processes.

```bash
docker build --target api -t trip-tracker-api .
docker build --target web -t trip-tracker-web \
  --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .
```

## Database

Schema changes go in `backend/src/db/migrations.ts` as a new numbered entry; they are applied
at boot and by `npm run db:migrate`, tracked in `schema_migrations`.

## License

MIT
