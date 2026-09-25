// Builds and packs @origin89/cloud, then installs the tarball in a scratch project to check it.
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
execFileSync("pnpm", ["--filter", "@origin89/cloud", "build"], { cwd: root, stdio: "inherit" });
const dist = new URL("dist/", root);
await mkdir(dist, { recursive: true });
execFileSync(
  "pnpm",
  ["--filter", "@origin89/cloud", "pack", "--pack-destination", fileURLToPath(dist)],
  {
    cwd: root,
    stdio: "inherit",
  },
);
const { version } = JSON.parse(
  await readFile(new URL("packages/cloud/package.json", root), "utf8"),
);
execFileSync(
  process.execPath,
  ["scripts/check-package.mjs", `dist/origin89-cloud-${version}.tgz`],
  {
    cwd: root,
    stdio: "inherit",
  },
);
