"use client";

import { useRef, useState } from "react";
import { uploadViaAction } from "./actions";

type LogLine = { ts: string; text: string };

export default function Home() {
  const [log, setLog] = useState<LogLine[]>([]);
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
    try {
      const res = await uploadViaAction(fd);
      append(
        `[client] server-action result (${Date.now() - start}ms): ${JSON.stringify(res)}`,
      );
    } catch (err) {
      append(`[client] server-action error: ${String(err)}`);
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
