"use server";

export async function uploadViaAction(formData: FormData) {
  // If you see this log, the action was invoked. On the failing
  // Samsung JPEG + OpenNext Workers runtime, this line never fires.
  console.log("[ACTION] entered");

  const file = formData.get("original");
  if (!(file instanceof File)) {
    console.log("[ACTION] no file in 'original' field");
    return { ok: false, reason: "not-a-file" };
  }

  console.log(
    `[ACTION] file received: name=${file.name} size=${file.size} type=${file.type}`,
  );

  const buf = await file.arrayBuffer();
  console.log(`[ACTION] arrayBuffer bytes=${buf.byteLength}`);

  return { ok: true, name: file.name, size: file.size, bytes: buf.byteLength };
}
