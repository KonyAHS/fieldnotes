<p align="center"><img src="https://raw.githubusercontent.com/KonyAHS/fieldnotes/main/docs/assets/logo.svg" alt="Fieldnotes" width="96"></p>

# Fieldnotes

**A self-hosted, offline-first travel planner.** Plan trips on a calendar-style timeline, keep alternative versions of an itinerary, compare transport, find restaurants and trails nearby, attach tickets, and print visa schedules. It runs as a single small container with SQLite and needs no cloud account or paid map API.

- Source, issues and full documentation: **https://github.com/KonyAHS/fieldnotes**
- License: ISC

![Fieldnotes itinerary timeline](https://raw.githubusercontent.com/KonyAHS/fieldnotes/main/docs/screenshots/itinerary.png)

## Features

- **Timeline and agenda:** activities, hotel nights, meals, notes and transport on a week or whole-trip timeline, with drag-and-drop, undo/redo, weather, and checks for missing nights, transfers and overlaps.
- **Scenarios:** branch an itinerary into alternatives and compare them by day.
- **Transport:** compare route options per journey, with currency conversion, a route map that follows real rail lines, and ticket links, files and booking references.
- **Places, restaurants and outdoors:** place search (OpenStreetMap by default, Google Maps optional with your own API key), nearby restaurants with a halal-friendly filter, hiking and cycling routes with GPX download.
- **Offline:** an installable PWA that keeps working offline, including attachments, and syncs edits between devices with conflict protection.
- **Exports:** visa schedules for Japan, Korea and China (print, CSV, Word), calendar feeds (`.ics` / `webcal://`), share images, Google My Maps lists, JSON backups.
- **Imports:** reservation `.ics` files, pasted confirmations, and optional read-only IMAP import of Booking.com and Airbnb emails.
- **AI agents:** an MCP endpoint (`/mcp`) and a JSON tool API for reading and editing the plan.

## Quick start

```bash
mkdir -p data && sudo chown 1000:1000 data
docker run -d --name fieldnotes \
  -p 3000:3000 \
  -v "$PWD/data:/data" \
  --restart unless-stopped \
  konyoshino/fieldnotes:latest
```

Then open `http://<your-server>:3000/`. A small sample trip is created on first start; edit or delete it.

### Docker Compose

```yaml
services:
  fieldnotes:
    image: konyoshino/fieldnotes:latest
    container_name: fieldnotes
    environment:
      TZ: UTC
    ports:
      - "3000:3000"
    volumes:
      - ./data:/data   # must be writable by UID 1000
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
```

## Configuration

| Variable   | Default   | Meaning                                  |
| ---------- | --------- | ---------------------------------------- |
| `PORT`     | `3000`    | Port the server listens on               |
| `HOST`     | `0.0.0.0` | Address the server binds to              |
| `DATA_DIR` | `/data`   | Database, attachments and secrets        |
| `TZ`       | `UTC`     | Server time zone (trips carry their own) |

Map provider, mailbox import and other options are set in the app under **Settings**.

## Data and backups

Everything lives in the `/data` volume: `fieldnotes.sqlite`, the `attachments/` folder, and `secrets/` (the optional mailbox app password and Google Maps key, stored with mode 0600 and never sent to browsers). Back up the whole folder. For a consistent copy of the database while it is running:

```bash
docker exec fieldnotes node --input-type=module -e "import {DatabaseSync,backup} from 'node:sqlite'; const db=new DatabaseSync('/data/fieldnotes.sqlite'); await backup(db,'/data/fieldnotes-backup.sqlite'); db.close();"
```

Update with `docker pull konyoshino/fieldnotes:latest` and recreate the container (or `docker compose pull && docker compose up -d`). Data in `/data` is kept.

## Security

**Fieldnotes has no login.** Anyone who can reach it can read and change the workspace. Run it on a private network or VPN, or behind a reverse proxy with authentication; do not expose it directly to the internet.

Offline mode and home-screen install need HTTPS (or `localhost`). Put the app behind a reverse proxy with a certificate, or use something like Tailscale Serve.

The container runs as a non-root user (UID 1000), works with a read-only root filesystem, and includes a health check at `/api/health`.

## Tags

| Tag      | Meaning                     |
| -------- | --------------------------- |
| `latest` | Latest build from `main`    |
| `x.y.z`  | A specific release          |
| `x.y`    | Latest patch of a release   |
| `sha-…`  | A specific commit           |

Images are built for `linux/amd64` and `linux/arm64`.

## Outbound services

The server contacts public services only when features are used: OpenStreetMap Nominatim, Photon and Overpass (places, restaurants, trails), Open-Meteo (weather), ExchangeRate-API (currency rates), OpenRailRouting (rail lines on the route map), and Google Maps Places only if you add your own key and select it.
