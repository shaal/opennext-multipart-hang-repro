export async function POST(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "formdata";

  const contentLength = request.headers.get("content-length");
  const contentType = request.headers.get("content-type");
  const start = Date.now();

  try {
    if (mode === "length") {
      return Response.json({
        mode,
        ms: Date.now() - start,
        contentLength,
        contentType,
      });
    }

    if (mode === "arraybuffer") {
      const buf = await request.arrayBuffer();
      return Response.json({
        mode,
        ms: Date.now() - start,
        bytes: buf.byteLength,
      });
    }

    if (mode === "stream") {
      const reader = request.body!.getReader();
      let total = 0;
      let chunks = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        chunks++;
      }
      return Response.json({
        mode,
        ms: Date.now() - start,
        bytes: total,
        chunks,
      });
    }

    // default: formdata
    const fd = await request.formData();
    const entries: Array<{
      key: string;
      kind: string;
      size?: number;
      type?: string;
      name?: string;
    }> = [];
    for (const [key, val] of fd.entries()) {
      if (val instanceof File) {
        entries.push({
          key,
          kind: "file",
          size: val.size,
          type: val.type,
          name: val.name,
        });
      } else {
        entries.push({ key, kind: "string", size: String(val).length });
      }
    }
    return Response.json({
      mode,
      ms: Date.now() - start,
      entries,
    });
  } catch (err) {
    return Response.json(
      { mode, ms: Date.now() - start, error: String(err) },
      { status: 500 },
    );
  }
}
