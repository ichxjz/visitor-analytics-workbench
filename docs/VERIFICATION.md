# Verification — 2026-10-16

- `npm test`: 23 tests covering log parsing, aggregation, byte/field semantics, API authorization, bounded local reads, aliases, snapshot hashes, weighted graph conservation, map decoding and pointer input coalescing.
- `npm run build`: passed. Client JavaScript approximately 225 kB before gzip, no external UI assets or web fonts.
- `npm run test:browser`: passed in local Chrome. Five main menus, four analysis pages, light/dark themes, 1440/768/390/320 widths and phone landscape, static production build without API, and isolated live-file mode.
- Live-file verification appended a second documented fixture address to a temporary Nginx log: PV/UV changed from 1/1 to 2/2 on refresh. Exact address details required opt-in and cleared on navigation. This is an isolated integration test, not a claim of connecting to a reader's server.
- Demo totals: 738 PV / 430 UV / 69,357 requests. All numeric measurements in all six published range reports were compared with the private source aggregates and unchanged. Private raw logs and address mappings are not distributed.
- Six actual UI GIFs: decoded frame counts, distinct frame hashes, dimensions and SHA-256 checked. See [recordings.json](demos/recordings.json). Lossless browser sampling avoids video compression noise and keeps the combined GIF payload around 7 MiB.
- Map rotation and pointer drawing are scheduled at animation-frame boundaries; multiple input events share a draw without losing accumulated movement. State and geographic hit testing use the same view projection. Animations respect visibility and reduced-motion preferences.

The phone checks use Chrome viewport/touch simulation. They do not establish acceptance on physical phones or Safari. Frame rate depends on display refresh, hardware and the rest of the host page; a 60 Hz test is not evidence of 120 fps.
