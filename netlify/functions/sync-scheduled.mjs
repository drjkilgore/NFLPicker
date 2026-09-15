// Runs automatically every 6 hours via Netlify scheduled functions.
import { runSync } from "./lib/engine.mjs";

export default async () => {
  try {
    const result = await runSync();
    console.log("Scheduled sync:", JSON.stringify(result));
  } catch (err) {
    console.error("Scheduled sync failed:", err);
  }
  return new Response("ok");
};

export const config = { schedule: "0 */6 * * *" };
