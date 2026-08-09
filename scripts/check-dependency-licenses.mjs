import { readFileSync } from "node:fs";

const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url)));
const packages = lock.packages || {};
const allowed = new Set([
  "0BSD",
  "Apache-2.0",
  "Apache-2.0 AND LGPL-3.0-or-later",
  "Apache-2.0 AND LGPL-3.0-or-later AND MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC-BY-4.0",
  "CC0-1.0",
  "GPL-2.0",
  "ISC",
  "LGPL-3.0-or-later",
  "MIT",
  "MPL-2.0",
  "Python-2.0",
]);

const failures = [];
for (const [location, metadata] of Object.entries(packages)) {
  if (!location.startsWith("node_modules/")) continue;
  const license = metadata.license;
  if (!license || !allowed.has(license))
    failures.push(`${location}: ${license || "missing license metadata"}`);
}

if (packages[""]?.license !== "Apache-2.0")
  failures.push("project package: expected Apache-2.0");
if (packages["node_modules/zerotier-rule-compiler"]?.license !== "GPL-2.0")
  failures.push("zerotier-rule-compiler: expected GPL-2.0");

if (failures.length) {
  console.error("Dependency license review required:\n" + failures.join("\n"));
  process.exit(1);
}

console.log(
  `Dependency license metadata accepted for ${Object.keys(packages).length - 1} locked packages.`,
);
