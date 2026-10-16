# Third-party notices

The original Visitor Stats components, local log parsing and aggregation, flow graph, globe renderer and admin theme were extracted from the author's Portfolio Template project, whose existing MIT copyright notice is retained in `LICENSE`. Project-specific content, assets, credentials, SSH transport, production addresses and deployment tools are not included. The globe uses Canvas 2D and has no Three.js or map-service runtime dependency.

## Map boundaries

`public/data/world-borders.json` contains the reviewed world-atlas 2.0.2 countries-50m topology based on Natural Earth 4.1.0. It is an overview of geographic boundaries, not a legal statement about sovereignty. Source and integrity metadata remain embedded under `kkSource`.

- Natural Earth map data is public domain. [Official terms](https://www.naturalearthdata.com/about/terms-of-use/) checked on 2026-10-16.
- The world-atlas conversion/distribution is ISC, Copyright 2013–2019 Michael Bostock. Full notice: [`licenses/WORLD-ATLAS-ISC.txt`](licenses/WORLD-ATLAS-ISC.txt); [upstream 2.0.2 license](https://github.com/topojson/world-atlas/blob/v2.0.2/LICENSE).
- The topology's `kkSource` includes its reviewed source URL and SHA-256. No network fetch or unreviewed map download happens during builds.

## Runtime and development dependencies

Exact versions are pinned in `package.json` and `package-lock.json`. Install only the declared dependencies; their original package notices remain in `node_modules`.

| Component | Version | License | Preserved notice |
| --- | --- | --- | --- |
| React | 18.3.1 | MIT | `licenses/REACT-MIT.txt` |
| React DOM | 18.3.1 | MIT | `licenses/REACT-DOM-MIT.txt` |
| Vite | 8.3.0 | MIT, with bundled third-party notices | `licenses/VITE-LICENSE.md` |
| @vitejs/plugin-react | 6.0.1 | MIT | `licenses/VITE-REACT-MIT.txt` |
| playwright-core (local browser checks only) | 1.62.1 | Apache-2.0 | `licenses/PLAYWRIGHT-APACHE-2.0.txt` |

Browser tests use an existing local Chrome installation. Chrome is not distributed in this repository. UI fonts use the system font stack; no third-party font files are distributed.

## Not distributed

No IP-to-region database is bundled. Optional local geographic adapters are the operator's responsibility to license and configure. Without an adapter, live-log geographic fields explicitly remain unknown. The public demo's geographic labels come from its anonymized real-log aggregate snapshot; no local IP database is required to view them.

No SatelliteMap.Space code, Solar source, production server configuration, runtime cache or raw access log is part of this module.
