# Fieldnotes guide

Detailed documentation. For installation see the [README](../README.md).

## Using the app

- **Itinerary:** add activities, accommodation nights, food stops, notes, and transport. Click a card to edit it. Drag a timed card to a new day/time, or use its editing form. In the stay lane, drag a stay's edge grips to change check-in or checkout, or drag the stay itself to move it (whole days, at least one night, within the trip); a focused grip also moves with the arrow keys. Dates across the top, local times down the side; phones default to Agenda. View one Monday–Sunday week or the **whole trip**; weekends are shaded. The timeline scrolls with the page and is sized so a whole day (06:00, or earlier if a plan starts earlier, to midnight) fits the window. Zoom out to see more days, zoom in for detail, or open it **full screen** (Esc to leave).
- **Transport:** every journey between cities: the gap between consecutive stays in different cities (from checkout to check-in), plus other journeys such as flights home. Each journey lists route options side by side with mode, operator, departure, arrival (+1 for next day), duration, connections, price (converted to your home currency with daily ExchangeRate-API rates) and a timing bar across the days; Fastest and Cheapest are marked. Choose an option with one click: it becomes the planned itinerary entry and the others become ideas (booked routes are never changed). Edit times, prices and operators inline; changing the departure moves the whole route, ±1 day buttons move it between days; add a change of transport (connection), duplicate a route as an alternative, or open the full editor. Compare links open Google Maps transit, Rome2rio, Google Flights, 12Go, and national rail/bus sites for the leg. Schedules and fares are not fetched automatically. Nearby day trips and airport transfers can be marked **Local** even when the municipality differs; they stay in the itinerary and satisfy connection checks without appearing as intercity journeys. Separate city-to-city routes appear in departure order, without an extra empty card for an already covered hotel-to-hotel journey.
- **Choosing a place:** the Place/Hotel field in the plan editor is searchable. Saved places are listed A–Z (or grouped **By city**) and filter as you type. **Search** looks the name up online (near the plan's city), and pasting a **Google Maps link** reads the place straight from it. Places found this way are saved with the plan; a match for an existing saved place (same name within 300 m) reuses it. The place editor also has a Google Maps link field that fills in name, address, phone, website and the exact pin.
- **Tickets & attachments:** attach PDFs, photos or screenshots (up to 25 MB each, 30 per plan) in the plan editor. Cards show a paperclip. Files are stored on the server and copied to every device that opens the app, so they open offline; files added offline upload when the device reconnects. Settings → Offline & sync shows how many files this device holds.
- **Things to check:** missing hotel nights, city-to-city travel, hotel changes, overlapping plans, and incomplete hotel contacts. Each warning says exactly what is missing, and also appears on its day in the timeline. Matching connecting legs count as one intercity journey. Ideas are excluded from checks and visa exports.
- **Scenarios:** duplicate a plan or start a blank alternative. Switch the active plan or compare branches by day. Changes to one branch do not alter another branch's entries. Place details are shared.
- **Places:** save native-language names, addresses and contacts. Places are located automatically by the server (OpenStreetMap Nominatim, then Photon) after they are added or renamed; name matches must lie within 80 km of the place's city, otherwise the city centre is used and the card shows **Approx. location**. Positions set by hand are never overwritten. Each card has a one-click **Food nearby**. Use country-specific external maps for local navigation.
- **Restaurants:** every itinerary stop, day by day. One click searches OpenStreetMap restaurants and cafés within any radius you type (50 m–50 km, in metres or kilometres) of it: **Halal-friendly** (halal tags, halal names, and cuisines that are often halal; not certification) or **All restaurants**. Save a result, or **Add to** that day; the meal is suggested for after the stop.
- **Hiking & cycling:** pick an itinerary stop (or **Trails** on a place card) to list marked hiking/walking or cycling/MTB routes within any radius (0.5–100 km), with length, climb, difficulty and network, plus peaks, viewpoints and trailheads, or bike rental. Show a route on the map, download it as **GPX** for your phone's hiking app, open it on Waymarked Trails (elevation profile), or add it to that day with an estimated duration (4 km/h walking plus 1 h per 500 m climbed; 15 km/h cycling). The day's sunrise, sunset and weather are shown: an Open-Meteo forecast within 16 days, otherwise the same date last year as a guide. Links to CyclOSM, the Komoot planner and regional tools (YAMAP and Docomo Bike Share in Japan, Durunubi and Seoul Bike in Korea, 2bulu in China).
- **Preparation:** tasks, booking costs by original currency, and cancellation deadlines. Totals do not apply assumed exchange rates.
- **Visa schedules:** Japan, Korea and China, for whichever of them the itinerary visits. Enter your applicant name and hotel addresses/phone numbers, then print/save as PDF or download CSV. Each day lists all plans in local time order, check-out/check-in on hotel-change days, arrival and departure legs, and overnight transit. Missing details mark the printed schedule as **DRAFT**. The Japan columns follow the [MOFA Schedule of Stay](https://www.mofa.go.jp/files/000433544.pdf). Entry rules depend on your passport and change often; always verify them with official sources.

A new installation starts with a small sample trip (Japan and Korea) so every view has something to show. Its dates, places and notes are examples only; edit or delete it to start your own.

## Booking.com and Airbnb

**Import reservations** accepts individual `.ics` calendar files, pasted confirmation text, and **Booking & Airbnb email**. Every import has a review screen. Check titles, dates, city, addresses, and booking status before importing. Labeled confirmation fields (`Hotel:`, `Check-in:`, `Check-out:`, `Address:`, `Phone:`, `Confirmation:`) are recognized. Unrecognized or ambiguous dates are not automatically selected. Calendar recurrence is rejected, cancellations are excluded, and duplicate calendar UIDs are deselected.

Neither provider offers guest-account access to other apps: the [Booking.com Demand API](https://developers.booking.com/demand/docs/getting-started/prerequisites) requires managed affiliate access, and [Airbnb API access](https://www.airbnb.com/help/article/3418) is limited to partner programs. Signing in with provider passwords would break their terms and 2-step verification, so it is not done.

Instead, **Booking & Airbnb email** connects read-only to your mailbox over IMAP (for Gmail: `imap.gmail.com` with an [app password](https://myaccount.google.com/apppasswords)). It searches only messages from booking.com and airbnb.com in the last year, never changes mail, and turns confirmations into stays (property, dates, times, address, phone, booking number, country). Cancellations, already-imported bookings and other trips' dates are not selected; everything is reviewed before import. The app password is checked when connecting, then stored only on the server at `DATA_DIR/secrets/mailbox.json` (directory 0700, file 0600), never sent back to browsers. Disconnect in the same screen, and revoke the app password with your provider. Like the rest of the app, the mailbox import has no separate login: devices that can reach the app can run it.

## Offline and sync

Open the HTTPS app once while connected and wait for **Ready for offline use** under Settings. Install through the browser menu (Android) or Safari **Share → Add to Home Screen** (iOS).

The service worker caches the complete app, including map and import code. IndexedDB stores the workspace and pending edits. Edits update immediately, save locally in order, and sync in a serialized background queue. Failed network saves retry with backoff. Returning online or reopening the app also triggers sync. A server revision prevents silent overwriting between devices. On conflict, choose a copy explicitly; the local copy is downloaded before resolution. Backup/restore is available in Settings.

**Offline scope:** itineraries, alternatives, saved place details, attachments, edits, checklists, and visa printing. Live map tiles, locating places, restaurant discovery, mailbox import, and external navigation require connectivity. Locations found by the server are kept beside the workspace and merged in by each device without changing the workspace revision, so background locating never causes sync conflicts; they are saved into the workspace with the next edit. Map tiles are neither bulk-downloaded nor added to the app's offline cache. Browser storage can be cleared by the OS or browser; keep occasional JSON backups.

**Attachments** are kept in a separate IndexedDB store (`fieldnotes-files`). After every successful sync, the device uploads files it added, downloads files other devices added, and drops copies no plan uses any more. Before travelling, open the app once online on each phone and check that Settings shows all attachments available offline. On the server, files live in `DATA_DIR/attachments` and are served only to this app: images, PDFs and plain text inline, anything else as a download, all with a sandboxing content policy. Files no plan refers to are deleted after 30 days. JSON backups contain the list of attachments but not the files; back up `DATA_DIR/attachments` with the database.

## Maps and halal information

- The overview is Leaflet/OpenStreetMap, with attribution and only on-demand tile requests.
- Korean places link to Naver and Kakao using saved local names/addresses.
- Chinese places link to Amap and Baidu using text searches. Native provider coordinates are not copied onto WGS84 tiles, avoiding mismatched coordinate systems.
- Japan and other destinations can use Google Maps or OpenStreetMap links.
- Halal status distinguishes unknown, OSM-tagged, certified, self-certified, Muslim friendly, and pork free. An OSM tag is **not** certification. Store a source and last-checked date. Korea's [official directory](https://english.visitkorea.or.kr/svc/thingsToDo/subMuslimFriendly.do) distinguishes these categories, including restaurants that may serve alcohol or pork.
- Trail data comes from OpenStreetMap via Overpass (cached 7 days), trail map overlays from Waymarked Trails, and weather from Open-Meteo (forecasts cached 3 hours).
- **Map data provider:** Settings → Maps & places switches place search, automatic locating, Google Maps links and restaurant search between **OpenStreetMap** (free, default) and **Google Maps** (Places API (New); needs an API key, billed by Google beyond its free allowance). The key is checked with one test search, stored only on the server at `DATA_DIR/secrets/maps.json` (0700/0600) and never sent to browsers. Google has no halal attribute, so Google restaurant results are never marked halal. Trails, map tiles and weather always use the sources above. Google Maps links work with either provider: the pin's coordinates come from the link itself, short `maps.app.goo.gl` links are expanded (only Google hosts are followed), and details are looked up near the pin.
- Place, city and restaurant lookups go through the app server (identified as `Fieldnotes/1.0`), are rate-limited (Nominatim: one request per second) and cached in SQLite (locations 30 days, restaurants 1 day). These services receive the queried place names and coordinates. Availability and restaurant coverage vary; map links and manual entry remain available.

## AI agents and scripts

The server exposes the plan to AI agents through a small set of tools: read the overview and day-by-day itinerary (with the app's problem checks), add, change or remove entries, places and tasks, look up places and search nearby restaurants. The same tools are available three ways:

- **MCP** (Streamable HTTP) at `/mcp`. For example, in Claude Code: `claude mcp add --transport http fieldnotes https://<host>/mcp`.
- **JSON API:** `POST /api/agent/<tool>` with the arguments as a JSON body; `GET /api/agent` lists tools with JSON schemas.
- **Command line:** `node scripts/fieldnotes.mjs <tool> key=value …` (`tools` lists them; `FIELDNOTES_URL` selects the server, default `http://127.0.0.1:3000`).

`/llms.txt` describes all of this in plain text, so an agent given only the app's address can find its way. Writes are validated against the same schema as the app, saved as a new revision, and appear on every device at its next sync. Devices with unsynced offline edits are asked which copy to keep, as with any other device's change. Like the app itself, the interface has no login: it relies on being reachable only from your private network.

## Development

Requires Node 24 or newer.

```bash
npm ci
npm run server           # API on 127.0.0.1:3096; ./data/fieldnotes.sqlite
npm run dev              # Vite on 127.0.0.1:5173, proxying the API
npm test
npm run build
```

Raster app icons are checked in. To regenerate them after editing `public/icon.svg`, run `node scripts/icons.mjs`.

The production build is served by the same Node server; no separate web container is needed. Set `PORT`, `HOST`, and `DATA_DIR`. Browser verification: start the production build on an **isolated test database** at localhost:3096 and run `npm run test:browser`. The check script creates/resolves test edits and restores the original test workspace. Do not aim it at your real trip database. Set `CHROMIUM_PATH` to a locally installed browser binary when needed.

## Backups and updates

Download a JSON backup in Settings before major changes. For a consistent server backup, use SQLite's online backup operation rather than copying the database while writes are active:

```bash
docker exec fieldnotes node --input-type=module -e "import {DatabaseSync,backup} from 'node:sqlite'; const db=new DatabaseSync('/data/fieldnotes.sqlite'); await backup(db,'/data/fieldnotes-backup.sqlite'); db.close();"
```

For updates, run `docker compose pull && docker compose up -d`. Persistent data remains mounted. The app prompts before activating an updated offline shell.
