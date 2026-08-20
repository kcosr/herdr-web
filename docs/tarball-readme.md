# herdr-web Desktop Bundle

This bundle contains the `herdr-web` browser UI assets and the `herdr-web-bridge` executable.

It does not include Herdr itself. Start or attach a Herdr `v0.8.0` or newer session that reports
terminal protocol `19` separately before running this bundle.

## Run

From the unpacked bundle directory:

```bash
bin/herdr-web
```

Open:

```text
http://127.0.0.1:8787
```

## LAN And Android

To expose the bridge to another device on a trusted local network:

```bash
bin/herdr-web --host 0.0.0.0 --port 4000 --allow-origin http://localhost
```

If Android connects through a DNS hostname, allow that hostname too:

```bash
bin/herdr-web --host 0.0.0.0 --port 4000 \
  --allow-origin http://localhost \
  --allow-host herdr-host.local
```

Then add the bridge URL in the Android app's Bridge area of Settings.

For browser-served multi-bridge use, configure both directions. The bridge being called must allow
the web page origin with `--allow-origin`; the bridge serving the web page must allow that page to
connect out with `--allow-connect-origin`. For example, a page opened from `http://host-a:8787` that
connects to `http://host-b:8787` needs:

```bash
# host A, serving the web page
bin/herdr-web --host 0.0.0.0 --allow-host host-a --allow-connect-origin http://host-b:8787

# host B, serving the backend being called
bin/herdr-web --host 0.0.0.0 --allow-host host-b --allow-origin http://host-a:8787
```

As an alternative, a bridge can proxy another herdr-web bridge server-side (for example, reaching
other machines over Tailscale) with a repeatable `--remote-bridge URL` flag:

```bash
bin/herdr-web --remote-bridge http://mini2:8787 --remote-bridge http://mini3:8787
```

`--remote-bridge` accepts a full `http://host[:port]` URL or a bare `host[:port]` (the bridge adds
`http://` automatically); `https://` is not accepted. The bridge derives an id from each URL's
hostname and lists configured remote bridges in `/api/snapshot` and standalone at `GET /api/bridges`;
`/api/remote/{bridge_id}/...` and `/ws/remote/{bridge_id}/terminal` proxy REST requests (to an
explicit allow-list of endpoints) and terminal WebSocket sessions to that remote bridge. Only bridges
the process was started with are reachable this way.

Only bind to non-loopback interfaces on networks you trust.
