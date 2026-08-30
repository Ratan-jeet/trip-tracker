# Trip Together Tracker

A consensual group live location sharing app for people traveling together. Everyone in the group sees each other on ONE map in real-time. Any user can start/stop sharing at any time.

## Features

- **Real-time location sharing** via WebSocket
- **Trip management** - Create trips, invite via code
- **Consent-first** - Explicit consent screens, instant revoke
- **Dual tracking** - Phone GPS + vehicle GPS tracker (MQTT)
- **Interactive map** - Mapbox GL with markers, follow mode, filters
- **History & export** - View past locations, export CSV/GPX/JSON
- **Secure** - JWT auth, 2FA support, TLS, auto-expiring data

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React, Mapbox GL, Tailwind CSS |
| Backend | Node.js, Fastify, Socket.io |
| Database | PostgreSQL + PostGIS, Redis |
| Vehicle GPS | MQTT (EMQX), IMEI-based device mapping |
| Auth | JWT, bcrypt, speakeasy (2FA) |
| Deploy | Vercel (frontend), Render/Fly.io (backend) |

## Quick Start

### Prerequisites
- Node.js 18+
- Docker (for PostgreSQL, Redis, MQTT)

### 1. Start Services

```bash
docker-compose up -d
```

### 2. Setup Backend

```bash
cd backend
cp .env.example .env   # Edit with your values
npm install
npm run db:migrate
npm run db:seed          # Creates test users + trip
npm run dev              # Starts on http://localhost:3001
```

### 3. Setup Frontend

```bash
cd frontend
cp .env.local.example .env.local   # Add Mapbox token
npm install
npm run dev              # Starts on http://localhost:3000
```

### 4. Test Login

| Email | Password | Role |
|-------|----------|------|
| alice@example.com | password123 | admin |
| bob@example.com | password123 | member |

## API Endpoints

### Auth
- `POST /api/auth/register` - Create account
- `POST /api/auth/login` - Sign in
- `GET /api/auth/me` - Current user
- `POST /api/auth/2fa/enable` - Enable 2FA
- `POST /api/auth/2fa/verify` - Verify 2FA code

### Trips
- `POST /api/trips` - Create trip
- `GET /api/trips` - List user's trips
- `GET /api/trips/:id` - Trip details + members
- `POST /api/trips/join` - Join via invite code
- `POST /api/trips/:id/leave` - Leave trip
- `DELETE /api/trips/:id` - Delete trip (admin)
- `POST /api/trips/:id/share` - Toggle sharing + consent

### Locations
- `POST /api/location/update` - Send location
- `GET /api/trips/:id/live` - Live positions
- `GET /api/trips/:id/history` - History by date range
- `GET /api/trips/:id/export?format=csv|gpx|json` - Export

### Devices
- `POST /api/devices` - Register device (phone/vehicle)
- `GET /api/trips/:id/devices` - List trip devices
- `DELETE /api/devices/:id` - Remove device

### WebSocket

Connect to `ws://localhost:3001/ws`:

```json
// 1. Authenticate
{"type": "auth", "token": "<jwt>"}

// 2. Subscribe to trip
{"type": "subscribe_trip", "tripId": "<uuid>"}

// 3. Receive updates
{"type": "location_update", "deviceId": "...", "lat": 15.5, "lng": 73.8, ...}
```

## Vehicle Tracker Setup

### Supported Devices
- **Teltonika FMB003** - OBD-II plug & play
- **Teltonika FMC130** - Hardwired 12V
- **Queclen GL520** - Portable magnetic

### MQTT Configuration
- Broker: `mqtt://your-server:1883`
- Topic: `device/{IMEI}/location`
- Payload: `{"lat": 15.5, "lng": 73.8, "speed": 60, "ignition": true, "battery": 85}`

### IoT SIM Cards
- Hologram (LTE-M, $2/mo + $0.06/MB)
- 1NCE (LTE-M + 2G fallback, €5 for 10yr)
- Airtel IoT (50-100MB/mo, ₹49/mo)
- Jio IoT (100MB/mo, ₹49/mo)

### Config in Device
```
APN: hologram (or carrier-specific)
Server: mqtt.yourdomain.com:1883
Interval: 10 seconds
Protocol: MQTT
```

## Architecture

```
┌──────────────┐     ┌─────────────────┐     ┌──────────────┐
│   Frontend   │────▶│   Backend API   │────▶│  PostgreSQL   │
│  (Next.js)   │     │   (Fastify)     │     │  + PostGIS   │
│  Mapbox GL   │     │   WebSocket     │     └──────────────┘
└──────────────┘     │   JWT Auth      │
       │             └────────┬────────┘
       │                      │
       │ WebSocket            │
       │                      ▼
       │             ┌─────────────────┐
       │             │     Redis       │
       │             │  Live positions │
       │             └─────────────────┘
       │
       │             ┌─────────────────┐
       └────────────▶│  MQTT Broker    │
                     │    (EMQX)       │
                     └────────┬────────┘
                              │
                              ▼
                     ┌─────────────────┐
                     │ Vehicle Tracker │
                     │  (Teltonika)    │
                     └─────────────────┘
```

## Security

- JWT tokens for authentication
- bcrypt password hashing (12 rounds)
- Optional 2FA via TOTP
- Trip-scoped data isolation
- Location data auto-expires after 30 days
- Audit log of all access
- TLS in production

## Deployment

### Frontend (Vercel)
```bash
vercel deploy
```

### Backend (Render)
1. Connect GitHub repo
2. Set environment variables
3. Deploy with `render.yaml` config

### Backend (Fly.io)
```bash
fly launch
fly deploy
```

## License

MIT
