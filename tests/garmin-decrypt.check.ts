// Checks that the app can decrypt what sync/garmin_sync.py writes (run: tsx tests/garmin-decrypt.check.ts <dir> <key>).
import { readFileSync } from "node:fs";
import { activityToCardio, decryptBlob, parseGarminTime, type GarminSummary } from "../src/db/garmin";

async function main() {
const [dir, key] = process.argv.slice(2);
const summary = (await decryptBlob(key, new Uint8Array(readFileSync(`${dir}/docs/data/summary.enc`)))) as GarminSummary;
const days = Object.keys(summary.days).sort();
console.log("days", days.length, days[0], "→", days.at(-1));
const d = summary.days[days.at(-1)!];
console.log("last day", JSON.stringify(d).slice(0, 400));
const acts = Object.values(summary.activities);
console.log("activities", acts.length);
const mapped = acts.map((a) => activityToCardio(a));
console.log("mapped cardio", mapped.filter(Boolean).length, "skipped (strength)", mapped.filter((m) => !m).length);
console.log("sample", JSON.stringify(mapped.find(Boolean)));
console.log("weights", JSON.stringify(summary.weights));
console.log("sleep start parsed", new Date(parseGarminTime(d.sleep.start as any)!).toISOString());
let bad = false;
try { await decryptBlob(Buffer.alloc(32, 1).toString("base64"), new Uint8Array(readFileSync(`${dir}/docs/data/summary.enc`))); } catch (e) { bad = true; console.log("wrong key rejected:", (e as Error).name); }
if (!bad) throw new Error("wrong key accepted");
}
main().catch((e) => { console.error(e); process.exit(1); });
