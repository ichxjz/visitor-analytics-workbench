# Local log adapter contract

Live mode reads only the plain-text files listed in `VISITOR_LOG_FILES` (JSON array of absolute or project-relative paths, maximum eight). It follows no shell commands, remote hosts or SSH configuration. Permissions come from the account running Node. Each file is tailed to 32 MiB by default, with a 64 MiB total read budget; a cut first record is discarded. Identical file inodes, including symlink aliases, are read once. Rotated files must be listed explicitly; compressed archives are not automatically expanded.

`VISITOR_SITE_HOSTS` defines which Referer hosts are internal. It does not invent request Host when old logs omit it and does not filter a multi-host log silently. Choose the appropriate site log files yourself. `VISITOR_PAGE_PATHS` specifies document paths counted as PV (default `/`); `/index.html` and trailing slash forms of configured pages share the same canonical page. Static assets and error responses are included once in traffic analysis, separately from successful human document PV. Day boundaries currently follow `Asia/Shanghai` (UTC+8).

## Quick start with your own site

Copy `.env.example` to `.env.local`, then replace its contents with your own values:

```dotenv
VISITOR_MODE=live
VISITOR_LOG_FILES=["/var/log/nginx/your-site-access.log","/var/log/nginx/your-site-access.log.1"]
VISITOR_SITE_HOSTS=["example.org","www.example.org"]
VISITOR_PAGE_PATHS=["/","/docs/"]
VISITOR_SITE_LABEL=My website
VISITOR_SITE_URL=https://example.org
VISITOR_ALLOW_ADDRESSES=false
```

Run `npm run dev` and open `http://127.0.0.1:5187/`. Node must already have read permission for the selected files. Restart the dev server after editing configuration. The page displays **本机日志 · 只读** in live mode. No SSH account or source website API is needed. To test the live production bundle locally, build with the same environment and run `npm run preview` at port 4187; a plain static host can only serve the public demo.

For JSON logging, define this format in Nginx's `http` context and enable its `access_log` inside the intended site's `server` block. Inspect and validate your own configuration before reloading it. This module does not change server configuration.

```nginx
log_format visitor_json escape=json
  '{"time_iso8601":"$time_iso8601","remote_addr":"$remote_addr",'
  '"request_method":"$request_method","request_uri":"$request_uri",'
  '"host":"$host","status":"$status","body_bytes_sent":"$body_bytes_sent",'
  '"request_length":"$request_length","http_referer":"$http_referer",'
  '"http_user_agent":"$http_user_agent","upstream_addr":"$upstream_addr"}';
# Inside the site's server block:
access_log /var/log/nginx/your-site-access.log visitor_json;
```

This example intentionally has no `rule_chain`: add that field only if your existing rules actually set a recorded marker. The interface keeps absent rule data unknown.

## Supported records

Standard Nginx combined logs and JSON records may coexist in a single file. The parser accepts these JSON fields (string numeric values are supported):

| Field | Meaning |
| --- | --- |
| `time_iso8601` or `time_local` | Actual log timestamp |
| `remote_addr` | Logged client address, not an inferred proxy header |
| `request_method` + `request_uri`, or `request` | Request method/path; query strings removed from aggregates |
| `host` | Request target domain; never substituted with Referer |
| `status` | Actual HTTP response status |
| `body_bytes_sent` | Response body bytes sent; not bidirectional traffic or a network bill |
| `request_length` | Recorded request line, headers and body bytes; unknown remains null |
| `http_referer` | Source domain; source URL path/query omitted |
| `http_user_agent` / `http_sec_ch_ua_model` | Device/browser estimates, with explicit unknowns |
| `rule_chain` | Actual logged rule/location IDs, optional string or array |
| `upstream_addr` | Actual logged upstream value/list; DNS is not queried |

Fields not present in historical logs remain missing. HTTP status is never used to fabricate a WAF rule. A single logged final location marker is not a complete security history. Completely missing byte measurements stay `null`; a recorded `0` stays `0`; partially measured groups show the observed subtotal and capability coverage.

## Geographic resolver

Set `VISITOR_GEO_ADAPTER` to a private local ESM module. It must export a synchronous `lookupLocation(ip)` function (or default function), returning a region string or `null`. No database is bundled and no network resolver is called. Use a database or service whose license permits your intended use; keep adapters and database files outside `public/` and version control if private. Invalid or asynchronous results are treated as unknown.

## Protected API

`GET /__admin/session` requires `x-visitor-app: 1` and returns an in-memory random token. All analytics queries require `x-admin-token`. The server binds only to loopback, rejects nonlocal Host / cross-origin requests, provides no CORS access, allows GET only, and marks responses `no-store`. The token is neither a query parameter nor persisted in browser storage.

- `GET /__admin/analytics?range=hour|day|week|month|year|all[&fresh=1]`
- `GET /__admin/analytics/addresses?range=week[&domain=...&source=...&region=...&network=...&limit=100]`

Precise address details require both live mode and `VISITOR_ALLOW_ADDRESSES=true`. Otherwise the UI is disabled and the API returns 403. Details are read on demand into memory, cleared on navigation/filter changes, and never written to a disk report. Browser CSV export uses network prefixes. No disk cache or raw log is created by this module.

Demo mode reads six fixed `public/demo/report-{range}.json` files. It has no background refresh and makes no request to the source website. A production demo build can run on a plain static host; live mode must use this module's loopback Vite dev/preview server. A missing live API produces an error and never silently substitutes demo data.
