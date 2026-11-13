import { readFile, readdir } from "node:fs/promises";
export const currentConfig = JSON.parse(
  await readFile(new URL("../config/benchmark.json", import.meta.url), "utf8"),
);
export const versions = {};
for (const file of await readdir(
  new URL("../config/releases/", import.meta.url),
)) {
  if (!/^\d+\.\d+\.\d+\.json$/.test(file)) continue;
  const c = JSON.parse(
    await readFile(
      new URL("../config/releases/" + file, import.meta.url),
      "utf8",
    ),
  );
  versions[c.version] = c;
}
versions[currentConfig.version] = currentConfig;
export function configFor(version) {
  if (!versions[version]) throw new Error("Unsupported benchmark version");
  return versions[version];
}
