import { readFile } from "node:fs/promises";
export const currentConfig = JSON.parse(
  await readFile(new URL("../config/benchmark.json", import.meta.url), "utf8"),
);
const legacy = JSON.parse(
  await readFile(
    new URL("../config/releases/0.1.0.json", import.meta.url),
    "utf8",
  ),
);
export const versions = {
  [legacy.version]: legacy,
  [currentConfig.version]: currentConfig,
};
export function configFor(version) {
  if (!versions[version]) throw new Error("Unsupported benchmark version");
  return versions[version];
}
