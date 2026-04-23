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
# or locally:
pnpm run preview   # opennextjs-cloudflare build + wrangler dev
```

Open the deployed URL. The page exposes two upload paths:

1. **Server Action** (`app/actions.ts`) — reads `formData.get("original")`,
   `console.log`s on line 1.
2. **Route Handler** (`app/api/upload/probe/route.ts`) — same multipart
   body, four read primitives selectable via `?mode=`:
   `length` / `arraybuffer` / `stream` / `formdata`.

### Expected output

With `fixtures/fail.jpg`:

- **Path A (server action):** `POST /` arrives at Worker; middleware and
  RSC render run; the action body's first `console.log('[ACTION] entered')`
  **never fires**. The client `fetch` sits pending forever.
- **Path B (route handler, all four modes):** HTTP 200 in <1 s, body parsed.

With `fixtures/pass.jpg`: both paths return 200 in ~350 ms.

Observe with `wrangler tail` while triggering each path.

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

## Hypothesis

The server-action client compiler produces a POST body whose fields
include a `$ACTION_ID_<hash>` marker and numerically-prefixed argument
keys. The dispatcher on the server decodes this before invoking the
action. Somewhere in that decode path — either in OpenNext's adaptation
of Next's server action handler, or inside Next's own `decodeReply` /
`decodeAction` — one of the bytes in the Samsung scan data is
misinterpreted in a way that awaits or loops forever.

## License

Fixtures and code are public-domain / CC0 for debugging purposes.
