# OpenNext Cloudflare — Server Action multipart hang repro

Minimal reproduction for
[opennextjs/opennextjs-cloudflare#1224](https://github.com/opennextjs/opennextjs-cloudflare/issues/1224).

A specific class of multipart POST bodies — produced by the **Samsung
Galaxy S22 Ultra's** built-in JPEG encoder — causes a Next.js App Router
**server action** to hang indefinitely on the Cloudflare Workers OpenNext
adapter. The action function is **never invoked**. The same bytes posted
as multipart to a plain Route Handler parse correctly in under a second.

## Fixtures

Both images in [`fixtures/`](./fixtures/) render to identical pixels; only
the JPEG scan bytes differ.

| File | Bytes | SHA-256 | Result |
|---|---|---|---|
| `fail.jpg` | 2,266,615 | `32c4d1924878f252313da1f347019413f29da66ac1e7c2e473e748f2f04266bc` | Server action hangs; Route Handler works |
| `pass.jpg` | 3,927,753 | `1d34138065dec40e4ab186d545ef7a1225fc07f6394b1f3a81e564d168627348` | Both paths work, ~350 ms |

`fail.jpg` is the **untouched original** from a Samsung Galaxy S22 Ultra
(EXIF: `manufacturer=samsung, model=SM-S908U1`). `pass.jpg` is the same
image re-encoded with macOS `sips` (ImageIO). No pixel edits, no crop,
no rotate.

## Environment

| Package | Version |
|---|---|
| `next` | `15.5.9` |
| `@opennextjs/cloudflare` | `^1.14.8` |
| `wrangler` | `^4.81.1` |
| Runtime | workerd, `nodejs_compat` |

## Running the repro

```bash
pnpm install
pnpm run deploy    # builds with opennextjs-cloudflare + wrangler deploy
```

**Local `wrangler dev` does not reproduce this bug** — see
[Findings](#findings) below. You need a real deploy (or
`wrangler dev --remote` against a configured zone) because the failure
originates at the Cloudflare edge, upstream of `workerd`.

Open the deployed URL. The page exposes two upload paths:

1. **Server Action** (`app/actions.ts`) — reads `formData.get("original")`,
   `console.log`s on line 1.
2. **Route Handler** (`app/api/upload/probe/route.ts`) — same multipart
   body, four read primitives selectable via `?mode=`:
   `length` / `arraybuffer` / `stream` / `formdata`.

### Expected output — how to know the bug fired

The page makes the hang self-evident. After ~30 s of no response the client
renders a red **"⚠️ HANG CONFIRMED"** banner. You do not need to stare at
`wrangler tail` to know something went wrong — though tailing the backend
is the cleanest confirmation of _why_.

#### Path A, `fixtures/fail.jpg` — **hang reproduces** (the bug)

In-browser log:

```
[client] server-action submit: name=fail.jpg size=2266615 type=image/jpeg
[client] ...still waiting 5s
[client] ...still waiting 10s
[client] ...still waiting 15s
[client] ...still waiting 20s
[client] ...still waiting 25s
[client] ⚠️  HANG CONFIRMED after 30001ms — server action never returned.
[client]    wrangler tail should show: NO "[ACTION] entered" line.
[client]    Re-run with fixtures/pass.jpg to confirm the path itself works.
```

Red banner renders on screen.

`wrangler tail` shows the request **arriving** at the Worker but the action
function never running:

```
POST https://<worker>.workers.dev/ - Ok
  (middleware + RSC render logs, if any)
  (NO "[ACTION] entered" line — that's the bug)
```

#### Path A, `fixtures/pass.jpg` — **action works** (control)

In-browser log, in under 1 second:

```
[client] server-action submit: name=pass.jpg size=3927753 type=image/jpeg
[client] ✓ server-action result (412ms): {"ok":true,"name":"pass.jpg","size":3927753,"bytes":3927753}
```

Green banner.

`wrangler tail`:

```
POST https://<worker>.workers.dev/ - Ok
  [ACTION] entered
  [ACTION] file received: name=pass.jpg size=3927753 type=image/jpeg
  [ACTION] arrayBuffer bytes=3927753
```

#### Path B (Route Handler) with either file — **works**

Any of the four `?mode=` buttons on the page completes in <1 s for both
fixtures. This is the bisection proof: the Workers body API and multipart
parser handle the Samsung bytes fine; only the server-action dispatch
layer hangs.

### The point

The difference between fail and pass is ~1.7 MB of re-encoded scan data.
Nothing else — same filename-pattern, same multipart shape, same field
name, same Worker, same deploy. Run both in the same browser session to
eliminate any "maybe my network / deploy / build is broken" noise.

## Bisection table (from the upstream issue)

Route Handler probe results against the same 2.27 MB multipart body —
all four primitives succeed:

| Primitive | Time | Result |
|---|---|---|
| `Content-Length` header only | 0 ms | 200 |
| `await request.arrayBuffer()` | 722 ms | 200, 2266615 bytes |
| `request.body.getReader()` chunk loop | 588 ms | 200, 1 chunk |
| `await request.formData()` | 284–636 ms | 200, all entries parsed |

The Workers body APIs and the multipart parser handle the Samsung bytes
fine. Only the server-action dispatch path hangs.

## Findings

Deploying the repro and running the same tests against a real
`workers.dev` URL (not `wrangler dev`) plus `wrangler tail`, produces
this evidence:

| Request | Worker received it? | Response |
|---|---|---|
| `POST /api/upload/probe` + **fail.jpg** | ✅ parsed cleanly | 200 |
| `POST /` + form-submit shape (hidden `$ACTION_ID_<hash>` field) + **fail.jpg** | ✅ `[ACTION] entered`, `arrayBuffer bytes=2266615` | 200 |
| `POST /` + `Next-Action: <hash>` header + **pass.jpg** | ✅ `[ACTION] entered` | 200 |
| `POST /` + `Next-Action: <hash>` header + **fail.jpg** | **❌ never reached Worker** (no log line in tail) | **403 from `server: cloudflare`** |

The 403 response body is Cloudflare's branded WAF challenge page
(`<title>Attention Required! | Cloudflare</title>`, `Ray ID`,
`cf-error-details`). The request is **blocked by a Cloudflare WAF
managed rule at the edge**, upstream of `workerd`.

**It is not a bug in OpenNext's or Next.js's server-action decoder.**
The rule requires the combination of:

1. A `Next-Action: <hash>` header (server-action dispatch path), **and**
2. The specific byte sequence in the Samsung S22 Ultra JPEG scan data.

Either ingredient alone passes:
- fail.jpg bytes posted without `Next-Action` (form-submit shape, route
  handler probe) reach the Worker fine.
- pass.jpg bytes posted with `Next-Action` reach the Worker fine.

Re-encoding the JPEG via macOS `sips` (pass.jpg) shifts the scan bytes
past the WAF rule's signature.

### Why it looks like a "hang" in the browser

Next.js's RSC client reads the response as a flight stream. When
Cloudflare returns a `text/html` challenge page instead, the flight
parser waits for a marker that never arrives — indistinguishable from
a hang until the client-side 30-second timer fires.

### Why local `wrangler dev` does not reproduce

Local `wrangler dev` runs `workerd` bound to loopback, with no
Cloudflare edge in front of it. The blocking WAF rule never gets a
chance to evaluate the request. `wrangler dev --remote` runs the Worker
on the real edge but routes requests through a preview tunnel whose
Host/Origin headers do not match what a deployed site sees, so you
additionally have to deal with Next's server-action origin check before
you can even exercise the WAF path. The fastest reliable repro is
`pnpm run deploy` to a disposable `workers.dev` subdomain.

### Fix for site owners

In the Cloudflare dashboard → Security → Events, filter by the Ray ID
from the 403 response to identify the exact managed rule, then either
disable that rule for your zone or add a skip rule for server-action
paths (Custom Rules: `http.request.uri.path eq "/..." and
http.request.headers["next-action"] ne ""`).

This is a WAF configuration change, not a code fix.

## License

Fixtures and code are public-domain / CC0 for debugging purposes.
