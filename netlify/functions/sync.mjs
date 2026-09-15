// Manual trigger: POST or GET /.netlify/functions/sync
import { runSync } from "./lib/engine.mjs";

export default async () => {
  try {
    const result = await runSync();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err.message || err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
};
