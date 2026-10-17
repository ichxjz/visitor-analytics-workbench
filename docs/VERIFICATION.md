# Verification — 2026-10-16

- `npm test`: 23 tests covering log parsing, aggregation, byte/field semantics, API authorization, bounded local reads, aliases, snapshot hashes, weighted graph conservation, map decoding and pointer input coalescing.
- `npm run build`: passed. Client JavaScript approximately 225 kB before gzip, no external UI assets or web fonts.
- `npm run test:browser`: passed in local Chrome. Five main menus, four analysis pages, light/dark themes, 1440/768/390/320 widths and phone landscape, static production build without API, and isolated live-file mode.
- Live-file verification appended a second documented fixture address to a temporary Nginx log: PV/UV changed from 1/1 to 2/2 on refresh. Exact address details required opt-in and cleared on navigation. This is an isolated integration test, not a claim of connecting to a reader's server.
- Demo totals: 738 PV / 430 UV / 69,357 requests. All numeric measurements in all six published range reports were compared with the private source aggregates and unchanged. Private raw logs and address mappings are not distributed.
- Six actual UI GIFs: decoded frame counts, distinct frame hashes, dimensions and SHA-256 checked. See [recordings.json](demos/recordings.json). Lossless browser sampling avoids video compression noise and keeps the combined GIF payload around 7 MiB.
- Map rotation and pointer drawing are scheduled at animation-frame boundaries; multiple input events share a draw without losing accumulated movement. State and geographic hit testing use the same view projection. Animations respect visibility and reduced-motion preferences.

The phone checks use Chrome viewport/touch simulation. They do not establish acceptance on physical phones or Safari. Frame rate depends on display refresh, hardware and the rest of the host page; a 60 Hz test is not evidence of 120 fps.

## Dark GIF refresh — 2026-10-17

The six README GIFs were re-recorded using the application's actual dark theme: dashboard, visitor monitor, regions, request flows, domain/IP associations and popular domains. Theme state is checked for every sampled browser frame; this is not a color-inverted light recording. The source snapshot remains dated 2026-10-16 with its original measurements.

The recordings preserve the original interactions, use 1080×750 pixels at 10 fps, and include verified frame counts, distinct frames and file hashes in `docs/demos/recordings.json`. Encoded GIF frames were sampled throughout each clip to confirm dark backgrounds without a light-mode flash. Unit tests and production build passed again. Application behavior and snapshot files were unchanged.

## Branded dark and light demos — 2026-10-17

All six original GIFs were re-recorded with a persistent `KK-Tiong_Pavelio` application header and the supplied KK logo. Four further recordings per theme cover the dashboard, visitor monitor, regions and flows. Each captured frame verifies the application's actual theme and author title; no snapshot metrics or clocks are edited. The 14 GIFs each decode to animated frames; their dimensions, frame hashes and sizes are listed in `docs/demos/recordings.json`. Source totals remain 738 PV / 430 UV / 69,357 requests from the 2026-10-16 anonymized snapshot. Raw PNG intermediates are removed after encoding.

The updated application passed all 23 unit tests, production build, both themes and five viewport bounds, static deployment without API, and isolated live-log reads. These checks do not imply connection to a reader's production logs or physical phone acceptance.
