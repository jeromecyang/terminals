#!/usr/bin/env node
/**
 * Optional utility to pre-populate Google Place IDs into stations.js
 * using the Google Places API (New) Text Search (IDs Only).
 *
 * Usage:
 *   GOOGLE_MAPS_API_KEY="YOUR_API_KEY" node scripts/resolve-place-ids.mjs
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stationsPath = path.resolve(__dirname, "..", "stations.js");
const apiKey = process.env.GOOGLE_MAPS_API_KEY;

if (!apiKey) {
  console.error("Error: Set GOOGLE_MAPS_API_KEY in your environment first.");
  process.exit(1);
}

const source = fs.readFileSync(stationsPath, "utf8");
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const stations = sandbox.window.STATIONS_DATA;

if (!Array.isArray(stations)) {
  console.error("Error: Could not read window.STATIONS_DATA from stations.js");
  process.exit(1);
}

let resolvedCount = 0;

for (const station of stations) {
  if (station.placeId) {
    resolvedCount++;
    continue;
  }

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id",
    },
    body: JSON.stringify({
      textQuery: station.placeQuery || `${station.name}, ${station.city}, ${station.state}`,
      locationBias: {
        circle: {
          center: { latitude: station.lat, longitude: station.lng },
          radius: 1500.0,
        },
      },
      pageSize: 1,
    }),
  });

  if (!res.ok) {
    console.warn(`[#${station.id}] Failed (${res.status}) for ${station.name}`);
    continue;
  }

  const data = await res.json();
  const id = data?.places?.[0]?.id;
  if (id) {
    station.placeId = id;
    resolvedCount++;
    console.log(`[#${station.id}] ${station.name} -> ${id}`);
  } else {
    console.warn(`[#${station.id}] No Place ID found for ${station.name}`);
  }
}

const output = `// Auto-updated with resolved Google Place IDs\nwindow.STATIONS_DATA = ${JSON.stringify(
  stations,
  null,
  2
)};\n`;

fs.writeFileSync(stationsPath, output, "utf8");
console.log(`\nDone! Resolved ${resolvedCount}/${stations.length} stations in stations.js.`);
