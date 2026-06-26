export default function handler() {
  return new Response(JSON.stringify({ ok: true, at: new Date().toISOString() }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
