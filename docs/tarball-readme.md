# herdr-web Desktop Bundle

This bundle contains the `herdr-web` browser UI assets and the `herdr-web-bridge` executable.

It does not include Herdr itself. Start or attach a Herdr `v0.7.5` or newer session that reports
terminal protocol `17` separately before running this bundle.

## Run

From the unpacked bundle directory:

```bash
bin/herdr-web
```

Open:

```text
http://127.0.0.1:8787
```

## LAN And Bundled Mobile Apps

To expose the bridge to another device on a trusted local network:

For Android:

```bash
bin/herdr-web --host 0.0.0.0 --port 4000 --allow-origin http://localhost
```

For a source-built iOS app or iOS Simulator:

```bash
bin/herdr-web --host 0.0.0.0 --port 4000 \
  --allow-origin capacitor://localhost
```

Use only the origin or origins for the clients being tested. If a bundled app connects through a
DNS hostname, allow that exact hostname in the bridge's independent Host policy too:

```bash
bin/herdr-web --host 0.0.0.0 --port 4000 \
  --allow-origin capacitor://localhost \
  --allow-host herdr-host.local
```

Then add the bridge URL in the app's Bridge area of Settings. An allowed origin never bypasses the
Host policy, and neither setting is client authentication.

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

Only bind to non-loopback interfaces on networks you trust.
