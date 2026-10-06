# SmartIV

Ward dashboard for hospital IV drips. Each bed has an Arduino/ESP32 unit with
two load cells; the dashboard shows every bed it is responsible for, with
critical beds pinned to the top.

The front end is a port of `smartiv-ward-monitor.html`, split into components
and wired to a real API. Nothing about how it looks has changed.

```
web/        React + Vite + TypeScript front end
server/     Node + Express + TypeScript API, SQLite via Drizzle
firmware/   ESP32 sketch for one unit (two load cells, two beds)
```

---

## Requirements

- Node.js 22 or newer
- No database server. SQLite is a file in `server/data/`.

---

## Setup

```bash
# 1. API
cd server
npm install
cp .env.example .env
```

Generate a signing secret and put it in `server/.env`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Then create the database and the demo ward:

```bash
npm run db:migrate
npm run db:seed          # add -- --reset to clear readings and start over
```

The seed prints the staff IDs and, on first run, the demo password and the
device key. Both are shown once and are never stored in plain text.

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3001` | API port |
| `DB_PATH` | `./data/smartiv.sqlite` | SQLite file |
| `JWT_SECRET` | **required** | Session signing key, 32+ characters |
| `SIMULATE` | `false` | `true` runs the simulator instead of hardware |
| `NODE_ENV` | `development` | `production` also serves `web/dist` |
| `SECURE_COOKIE` | follows `NODE_ENV` | Set `false` to serve a production build over plain HTTP |
| `WEB_DIST` | `../web/dist` | Override the built front end path |
| `OFFLINE_AFTER_MS` | `10000` | Silence before a unit reads as offline |
| `LOGIN_WINDOW_MS` | `900000` | Rate-limit window |
| `LOGIN_ATTEMPTS` | `10` | Sign-in attempts per window per IP |
| `SEED_DEMO_PASSWORD` | generated | Password for every seeded demo user |

### Running it

Two terminals, so the front end hot-reloads against the API:

```bash
cd server && npm run dev     # http://localhost:3001
cd web    && npm run dev     # http://localhost:5173
```

Open <http://localhost:5173>. Vite proxies `/api` to the server, so cookies
and the live stream work the same way they do in production.

For a single-origin deployment, build the front end and let the server serve
it:

```bash
cd web    && npm run build
cd server && NODE_ENV=production npm start
```

`NODE_ENV=production` marks the session cookie `Secure`, which a browser will
not store over plain `http://`. On an isolated ward LAN where the TV reaches
the server without TLS, start with `SECURE_COOKIE=false`.

---

## Signing in

Seeded accounts, all sharing the password the seed printed:

| Staff ID | Name | Role | Beds |
| --- | --- | --- | --- |
| `N-2041` | Anitha S. | Nurse | 1, 2 |
| `N-2042` | Karthik M. | Nurse | 3, 4, 5, 6 |
| `N-2043` | Divya R. | Nurse | 7, 8, 9, 10 |
| `A-1001` | Ward Admin | Admin | all 12 |

Beds 11 and 12 are deliberately unassigned, so you can confirm that only an
admin can see them.

To set the password yourself:

```bash
SEED_DEMO_PASSWORD='choose-something-long' npm run db:seed -- --reset
```

Re-running the seed reuses the same password for every demo user. For real
accounts, change the password in the database; the seed is for demo wards.

### Roles

- **Nurse** sees only the beds assigned to them, live. Can acknowledge
  alarms, mark a bag replaced, and mark flow restored.
- **Admin** sees every bed and can also assign beds, edit alert rules, view
  devices and read the activity log.

Both are enforced on the server for every route, not by hiding things in the
interface. A nurse calling `/api/admin/rules` gets a `403`, and another
nurse's bed answers `404` so its existence cannot be probed. There are tests
for this.

---

## Running without hardware

```bash
cd server
SIMULATE=true npm run dev
```

The simulator emits the same payload the hardware sends, through the same
ingestion path, so the app behaves identically. The dashboard shows a
**Demo speed** control for 1x, 10x and 60x.

---

## Hardware

One unit carries two load cells, so it covers two beds: channel 1 weighs the
bag on the first bed, channel 2 the bag on the second. Bags are **100 mL**.

### Registering a unit

```bash
cd server
npm run device:register -- --unit=IVU-02 --beds=7,8
```

Bed order is channel order. The command prints a device key once. Put it in
`firmware/smartiv_esp32/config.h` and leave that file out of git.

```bash
cd firmware/smartiv_esp32
cp config.h.example config.h     # then fill in Wi-Fi, server and the key
```

Libraries: **ArduinoJson** (Benoit Blanchon) and **HX711** (Bogdan Necula).

### What the unit sends

One request every 2 seconds, carrying both load cells:

```http
POST /api/readings
X-Device-Key: siv_...
Content-Type: application/json

{
  "bags": [
    { "channel": 1, "bed": 7, "bag_ml": 100, "volume_ml": 82, "flow_ml_h": 120 },
    { "channel": 2, "bed": 8, "bag_ml": 100, "volume_ml": 40, "flow_ml_h": 100 }
  ]
}
```

A single bag also works on its own:

```json
{ "bed": 7, "bag_ml": 100, "volume_ml": 82, "flow_ml_h": 120 }
```

Curl it against a running server:

```bash
curl -X POST http://localhost:3001/api/readings \
  -H "Content-Type: application/json" \
  -H "X-Device-Key: siv_..." \
  -d '{"bed":1,"bag_ml":100,"volume_ml":82,"flow_ml_h":120}'
```

The correct bed updates on the dashboard immediately.

### Calibrating

Before a unit's volume can be trusted, set these in `config.h`:

- `EMPTY_BAG_MASS_G_CHANNEL_n` — weigh the empty bag and the tubing hanging
  from the cell.
- `CALIBRATION_FACTOR_CHANNEL_n` — put a known mass on the cell, read the
  serial monitor, then `factor = known_mass / raw_reading`. Every load cell
  and HX711 pair needs its own value.
- `FLUID_DENSITY` — `volume = fluid_mass / density`. `1.0` assumes 1 g = 1 mL.

Sensor reading is isolated in `readBag()` in `smartiv_esp32.ino`. Everything
else consumes the numbers it returns, so changing the sensor means editing
that one function.

### Offline units

A unit that has not reported within `OFFLINE_AFTER_MS` (10 s) has its cards
marked **Offline**, so a dead unit never sits there showing a stale volume.

---

## How severity is decided

The app works this out; the device only reports volume and flow.

```
percentage   = volume_left / bag_size * 100
minutes_left = volume_left / smoothed_flow_rate * 60
end_time     = now + minutes_left
```

| Band | Condition |
| --- | --- |
| Critical | Bag empty, or flow stopped, or time left <= 15 min, or volume <= 10% |
| Attention | Time left <= 45 min, or volume <= 25% |
| Running | Neither limit reached |

All four limits are editable by an admin under **Alert rules**. The flow rate
is smoothed with a 5-sample moving average on the server; a stopped flow
snaps to zero rather than decaying through the window, so a drip that has
stopped stops reporting time left.

Bands run Critical, Attention soon, Running normally, each sorted by time left
with stopped-flow beds last.

---

## Tests

```bash
cd server
npm test          # 66 tests
npm run typecheck
```

`tests/calculations.test.ts` covers percentage, `minutes_left`, `end_time`
and severity against both the default and edited rules, the flow smoother,
and the band ordering.

`tests/api.test.ts` covers authentication, the access-control acceptance
criteria (a nurse receives `403` on all seven admin routes, sees only
assigned beds, and receives `404` for another nurse's bed and for an
unassigned bed), device ingestion and validation, acknowledgement and its
reset, assignment changes, rule editing, and the activity log.

---

## API

| Route | Who |
| --- | --- |
| `POST /api/auth/login` | anyone, rate limited |
| `POST /api/auth/logout` | anyone |
| `GET /api/auth/me` | signed in |
| `GET /api/beds` | signed in, filtered |
| `GET /api/beds/:id/history` | assigned beds only |
| `POST /api/beds/:id/acknowledge` | assigned beds only |
| `POST /api/beds/:id/bag-replaced` | assigned beds only |
| `POST /api/beds/:id/flow-restored` | assigned beds only |
| `GET /api/events` | SSE, filtered per client |
| `POST /api/readings` | `X-Device-Key` |
| `GET /api/meta` | anyone |
| `/api/admin/staff` | admin |
| `PATCH /api/admin/assignments/:bedId` | admin |
| `GET|PATCH /api/admin/rules` | admin |
| `GET /api/admin/devices` | admin |
| `GET /api/admin/activity` | admin |
| `PATCH /api/admin/simulator/speed` | admin |

Sessions are a JWT in an `httpOnly`, `SameSite=Strict` cookie. The role is
re-read from the database on every request, so deactivating an account takes
effect at once.

---

## Moving to Postgres

The schema is Drizzle, so the change is one driver. In `server/src/db`:

1. Point the schema at `drizzle-orm/pg-core` and swap `integer(...)` for
   `integer(...)` with generated identity columns, `text(...)` timestamps for
   `timestamp`, and `boolean(...)` for the flags currently stored as integers.
2. Swap `openDatabase()` to `drizzle-orm/node-postgres`.
3. Regenerate migrations: `npm run db:generate`.
4. Replace `sqlite.exec` style pragmas and the `sql\`...\`` escape hatches in
   `server/tests/api.test.ts`.

The queries themselves use the Drizzle query builder and need no changes.

---

## Notes

- The dashboard works at a 400 px phone width with no horizontal scroll, and
  on a ward TV at full width. Both themes follow the system preference and
  can be switched from the header.
- `prefers-reduced-motion` is respected.
- Prototype only. Not a certified medical device.
