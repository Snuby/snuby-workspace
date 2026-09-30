/**
 * 从和风 LocationList（与中国天气网同系城市码）生成本地县市表。
 * 源: https://github.com/qwd/LocationList/blob/master/China-City-List-latest.csv
 *
 *   curl -fsSL -o /tmp/China-City-List-latest.csv \
 *     https://cdn.jsdelivr.net/gh/qwd/LocationList@master/China-City-List-latest.csv
 *   node scripts/build-weather-cities.mjs /tmp/China-City-List-latest.csv
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcPath = process.argv[2];
if (!srcPath) {
  console.error("Usage: node scripts/build-weather-cities.mjs <China-City-List-latest.csv>");
  process.exit(1);
}

const raw = fs.readFileSync(srcPath, "utf8");
const lines = raw.split(/\r?\n/).filter(Boolean);
// line0 = title, line1 = header
const header = lines[1].split(",");
const idx = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const need = ["Location_ID", "Location_Name_EN", "Location_Name_ZH", "ISO_3166_1", "Adm1_Name_ZH", "Adm2_Name_ZH", "Latitude", "Longitude"];
for (const k of need) {
  if (idx[k] == null) throw new Error(`missing column ${k}`);
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      q = !q;
      continue;
    }
    if (ch === "," && !q) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

const seen = new Set();
const rows = [];
for (const line of lines.slice(2)) {
  const cols = parseCsvLine(line);
  if ((cols[idx.ISO_3166_1] || "").trim() !== "CN") continue;
  const id = (cols[idx.Location_ID] || "").trim();
  const n = (cols[idx.Location_Name_ZH] || "").trim();
  const e = (cols[idx.Location_Name_EN] || "").trim();
  const p = (cols[idx.Adm1_Name_ZH] || "").trim();
  const c = (cols[idx.Adm2_Name_ZH] || "").trim();
  const lat = Number(cols[idx.Latitude]);
  const lon = Number(cols[idx.Longitude]);
  if (!id || !n || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  if (seen.has(id)) continue;
  seen.add(id);
  rows.push({ id, n, e, p, c, lat: Math.round(lat * 10000) / 10000, lon: Math.round(lon * 10000) / 10000 });
}

const out = path.join(__dirname, "../src/data/china-weather-cities.json");
fs.writeFileSync(out, JSON.stringify(rows));
console.log(`wrote ${rows.length} -> ${out}`);
