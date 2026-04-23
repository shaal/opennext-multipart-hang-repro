"use client";

import { useRef, useState } from "react";
import { uploadViaAction } from "./actions";

type LogLine = { ts: string; text: string };

const HANG_TIMEOUT_MS = 30_000;

export default function Home() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "waiting"; startedAt: number; elapsed: number }
    | { kind: "done"; ms: number }
    | { kind: "error"; message: string }
    | { kind: "hang"; ms: number }
  >({ kind: "idle" });
  const fileRefAction = useRef<HTMLInputElement>(null);
  const fileRefProbe = useRef<HTMLInputElement>(null);

  const append = (text: string) =>
    setLog((l) => [...l, { ts: new Date().toISOString(), text }]);

  async function onActionSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = fileRefAction.current;
    const f = input?.files?.[0];
    if (!f) return;
    append(
      `[client] server-action submit: name=${f.name} size=${f.size} type=${f.type}`,
    );
    const fd = new FormData();
    fd.set("original", f);
    const start = Date.now();
    setStatus({ kind: "waiting", startedAt: start, elapsed: 0 });

    // Visible countdown while we wait
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      setStatus({ kind: "waiting", startedAt: start, elapsed });
      if (elapsed % 5000 < 250) {
        append(`[client] ...still waiting ${Math.round(elapsed / 1000)}s`);
      }
    }, 250);

    // Convert the silent hang into a loud positive event after 30s
    const hangTimer = setTimeout(() => {
      clearInterval(tick);
      const ms = Date.now() - start;
      setStatus({ kind: "hang", ms });
      append(
        `[client] ⚠️  HANG CONFIRMED after ${ms}ms — server action never returned.`,
      );
      append(
        `[client]    wrangler tail should show: NO "[ACTION] entered" line.`,
      );
      append(
        `[client]    Re-run with fixtures/pass.jpg to confirm the path itself works.`,
      );
    }, HANG_TIMEOUT_MS);

    try {
      const res = await uploadViaAction(fd);
      clearInterval(tick);
      clearTimeout(hangTimer);
      const ms = Date.now() - start;
      setStatus({ kind: "done", ms });
      append(
        `[client] ✓ server-action result (${ms}ms): ${JSON.stringify(res)}`,
      );
    } catch (err) {
      clearInterval(tick);
      clearTimeout(hangTimer);
      setStatus({ kind: "error", message: String(err) });
      append(`[client] ✗ server-action error: ${String(err)}`);
    }
  }

  async function probe(mode: string) {
    const input = fileRefProbe.current;
    const f = input?.files?.[0];
    if (!f) return;
    append(`[client] probe mode=${mode}: name=${f.name} size=${f.size}`);
    const fd = new FormData();
    fd.set("original", f);
    const start = Date.now();
    try {
      const r = await fetch(`/api/upload/probe?mode=${mode}`, {
        method: "POST",
        body: fd,
      });
      const j = await r.json();
      append(
        `[client] probe ${mode} (${Date.now() - start}ms, status=${r.status}): ${JSON.stringify(j)}`,
      );
    } catch (err) {
      append(`[client] probe ${mode} error: ${String(err)}`);
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 760, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>OpenNext Cloudflare multipart hang repro</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        Upstream: <a href="https://github.com/opennextjs/opennextjs-cloudflare/issues/1224">opennextjs/opennextjs-cloudflare#1224</a>
      </p>

      <p>
        Pick <code>fixtures/fail.jpg</code> (hangs via server action) vs{" "}
        <code>fixtures/pass.jpg</code> (works). Same pixels, re-encoded — only
        the scan bytes differ.
      </p>

      <fieldset style={{ marginTop: 16, padding: 16 }}>
        <legend>Path A — Server Action (expected: hangs on fail.jpg)</legend>
        <form onSubmit={onActionSubmit}>
          <input
            ref={fileRefAction}
            type="file"
            name="original"
            accept="image/jpeg"
            required
          />
          <button type="submit" style={{ marginLeft: 8 }}>
            Submit via server action
          </button>
        </form>

        {status.kind === "waiting" && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              background: "#fff6d6",
              border: "1px solid #d4b100",
              borderRadius: 4,
            }}
          >
            ⏳ Waiting for server action… elapsed{" "}
            <strong>{Math.round(status.elapsed / 1000)}s</strong> / {" "}
            {HANG_TIMEOUT_MS / 1000}s max
          </div>
        )}
        {status.kind === "done" && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              background: "#d6ffd6",
              border: "1px solid #3aa03a",
              borderRadius: 4,
            }}
          >
            ✓ Server action returned in <strong>{status.ms}ms</strong>
          </div>
        )}
        {status.kind === "hang" && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              background: "#ffd6d6",
              border: "2px solid #c41e1e",
              borderRadius: 4,
              color: "#7a0000",
            }}
          >
            <strong>⚠️  HANG CONFIRMED</strong> — server action never returned
            after {status.ms}ms.
            <br />
            Check <code>wrangler tail</code>: the action body's{" "}
            <code>console.log("[ACTION] entered")</code> should be{" "}
            <em>absent</em>. Re-run with <code>fixtures/pass.jpg</code> to
            prove the path itself works.
          </div>
        )}
        {status.kind === "error" && (
          <div
            style={{
              marginTop: 12,
              padding: 10,
              background: "#ffd6d6",
              border: "1px solid #c41e1e",
              borderRadius: 4,
            }}
          >
            ✗ Error: {status.message}
          </div>
        )}
      </fieldset>

      <fieldset style={{ marginTop: 16, padding: 16 }}>
        <legend>
          Path B — Plain Route Handler (expected: works for both files)
        </legend>
        <input
          ref={fileRefProbe}
          type="file"
          name="original"
          accept="image/jpeg"
          required
        />
        <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={() => probe("length")}>
            /probe?mode=length
          </button>
          <button type="button" onClick={() => probe("arraybuffer")}>
            /probe?mode=arraybuffer
          </button>
          <button type="button" onClick={() => probe("stream")}>
            /probe?mode=stream
          </button>
          <button type="button" onClick={() => probe("formdata")}>
            /probe?mode=formdata
          </button>
        </div>
      </fieldset>

      <h2 style={{ marginTop: 24 }}>Log</h2>
      <pre
        style={{
          background: "#0b0b0b",
          color: "#9cff9c",
          padding: 12,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          minHeight: 120,
          borderRadius: 4,
        }}
      >
        {log.length === 0
          ? "(no events yet)"
          : log.map((l, i) => `${l.ts}  ${l.text}`).join("\n")}
      </pre>
    </main>
  );
}
