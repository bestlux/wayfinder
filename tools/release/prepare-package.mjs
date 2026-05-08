#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const defaultOutDir = "dist/release";
const requiredPackageEntries = [
  "module.json",
  "scripts/wayfinder.js",
  "styles/wayfinder.css",
  "templates/wayfinder-app.hbs",
  "lang/en.json",
];
const packageDirectories = ["scripts", "styles", "templates", "lang"];
const optionalPackageFiles = ["README.md", "LICENSE", "LICENSE.md", "CHANGELOG.md"];
const forbiddenPackageEntryPatterns = [
  /^src\//,
  /^tests\//,
  /^node_modules\//,
  /^\.git\//,
  /^\.github\//,
  /^\.worktrees\//,
  /^tools\//,
  /^docs\//,
  /^agents\//,
  /^package(?:-lock)?\.json$/,
  /^tsconfig(?:\..*)?\.json$/,
  /^eslint\.config\.mjs$/,
  /^biome\.jsonc$/,
  /^vitest\.config\.ts$/,
  /\.map$/,
];

function usage() {
  return `Usage: node tools/release/prepare-package.mjs [options]

Options:
  --version <version>  Release version. Defaults to package.json version.
  --tag <tag>          Release tag. Defaults to v<version>.
  --repo <owner/repo>  GitHub repository. Defaults to GITHUB_REPOSITORY or origin.
  --out <path>         Output directory. Defaults to ${defaultOutDir}.
  --help              Show this help text.
`;
}

function parseArgs(argv) {
  const options = {
    outDir: defaultOutDir,
    repo: process.env.GITHUB_REPOSITORY ?? "",
    tag: "",
    version: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      options.help = true;
      continue;
    }

    if (!["--version", "--tag", "--repo", "--out"].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--version") options.version = value;
    if (arg === "--tag") options.tag = value;
    if (arg === "--repo") options.repo = value;
    if (arg === "--out") options.outDir = value;
    index += 1;
  }

  return options;
}

async function readJson(relativePath) {
  const content = await readFile(path.join(repoRoot, relativePath), "utf8");
  return JSON.parse(content);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function getOriginRemote() {
  try {
    return execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function normalizeGitHubRepo(value) {
  const trimmed = value.trim();
  const sshMatch = /^git@github\.com:(?<repo>[^.]+\/.+?)(?:\.git)?$/.exec(trimmed);
  const httpsMatch = /^https:\/\/github\.com\/(?<repo>.+?)(?:\.git)?$/.exec(trimmed);
  const shorthandMatch = /^(?<repo>[^/\s]+\/[^/\s]+)$/.exec(trimmed);
  const repo = sshMatch?.groups?.repo ?? httpsMatch?.groups?.repo ?? shorthandMatch?.groups?.repo ?? "";

  if (!repo) {
    throw new Error(`Could not derive a GitHub owner/repo from "${value}". Pass --repo <owner/repo>.`);
  }

  return repo.replace(/\.git$/, "");
}

function resolveOutputRoot(targetPath) {
  const resolved = path.resolve(repoRoot, targetPath);
  const relative = path.relative(repoRoot, resolved);
  const distRoot = path.join(repoRoot, "dist");
  const relativeToDist = path.relative(distRoot, resolved);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Output path must be inside the repository: ${targetPath}`);
  }

  if (relativeToDist.startsWith("..") || path.isAbsolute(relativeToDist)) {
    throw new Error(`Output path must be inside the generated dist directory: ${targetPath}`);
  }

  return resolved;
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyDirectory(relativePath, packageRoot) {
  const source = path.join(repoRoot, relativePath);
  const destination = path.join(packageRoot, relativePath);

  if (!(await pathExists(source))) {
    throw new Error(`Missing required package directory: ${relativePath}`);
  }

  await cp(source, destination, { recursive: true });
}

async function copyOptionalFile(relativePath, packageRoot) {
  const source = path.join(repoRoot, relativePath);
  if (!(await pathExists(source))) return;

  await cp(source, path.join(packageRoot, relativePath));
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, absolutePath)));
      continue;
    }

    if (entry.isFile()) {
      files.push(path.relative(root, absolutePath).replaceAll(path.sep, "/"));
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

async function pruneSourceMaps(packageRoot) {
  const scriptsRoot = path.join(packageRoot, "scripts");
  const scriptFiles = await listFiles(scriptsRoot);

  for (const entry of scriptFiles) {
    const absolutePath = path.join(scriptsRoot, entry);

    if (entry.endsWith(".map")) {
      await rm(absolutePath);
      continue;
    }

    if (!entry.endsWith(".js")) continue;

    const content = await readFile(absolutePath, "utf8");
    const withoutSourceMapReference = content.replace(/\r?\n\/\/# sourceMappingURL=.*\r?\n?$/u, "\n");
    if (withoutSourceMapReference !== content) {
      await writeFile(absolutePath, withoutSourceMapReference);
    }
  }
}

function validatePackageEntries(entries) {
  const missingEntries = requiredPackageEntries.filter((entry) => !entries.includes(entry));
  if (missingEntries.length > 0) {
    throw new Error(`Package is missing required entries: ${missingEntries.join(", ")}`);
  }

  const forbiddenEntries = entries.filter((entry) =>
    forbiddenPackageEntryPatterns.some((pattern) => pattern.test(entry)),
  );
  if (forbiddenEntries.length > 0) {
    throw new Error(`Package contains forbidden development entries: ${forbiddenEntries.join(", ")}`);
  }
}

function buildReleaseManifest(sourceManifest, { repo, tag, version }) {
  const repositoryUrl = `https://github.com/${repo}`;

  return {
    ...sourceManifest,
    version,
    manifest: `${repositoryUrl}/releases/latest/download/module.json`,
    download: `${repositoryUrl}/releases/download/${tag}/module.zip`,
    url: sourceManifest.url || repositoryUrl,
    readme: sourceManifest.readme || `${repositoryUrl}#readme`,
    bugs: sourceManifest.bugs || `${repositoryUrl}/issues`,
    changelog: `${repositoryUrl}/releases/tag/${tag}`,
  };
}

function createCrc32Table() {
  const table = [];

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

const crc32Table = createCrc32Table();

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime() {
  const year = 2020;
  const month = 1;
  const day = 1;
  const hour = 0;
  const minute = 0;
  const second = 0;

  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hour << 11) | (minute << 5) | Math.floor(second / 2),
  };
}

function localFileHeader({ compressedSize, crc, fileNameBytes, uncompressedSize }) {
  const header = Buffer.alloc(30);
  const timestamp = dosDateTime();

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(timestamp.time, 10);
  header.writeUInt16LE(timestamp.date, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(uncompressedSize, 22);
  header.writeUInt16LE(fileNameBytes.length, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, fileNameBytes]);
}

function centralDirectoryHeader({ compressedSize, crc, fileNameBytes, offset, uncompressedSize }) {
  const header = Buffer.alloc(46);
  const timestamp = dosDateTime();

  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(timestamp.time, 12);
  header.writeUInt16LE(timestamp.date, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(uncompressedSize, 24);
  header.writeUInt16LE(fileNameBytes.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);

  return Buffer.concat([header, fileNameBytes]);
}

function endOfCentralDirectory({ centralDirectoryOffset, centralDirectorySize, entryCount }) {
  const footer = Buffer.alloc(22);

  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(0, 4);
  footer.writeUInt16LE(0, 6);
  footer.writeUInt16LE(entryCount, 8);
  footer.writeUInt16LE(entryCount, 10);
  footer.writeUInt32LE(centralDirectorySize, 12);
  footer.writeUInt32LE(centralDirectoryOffset, 16);
  footer.writeUInt16LE(0, 20);

  return footer;
}

async function createZipFromFiles(root, entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const data = await readFile(path.join(root, entry));
    const fileNameBytes = Buffer.from(entry, "utf8");
    const checksum = crc32(data);
    const localHeader = localFileHeader({
      compressedSize: data.length,
      crc: checksum,
      fileNameBytes,
      uncompressedSize: data.length,
    });
    const centralHeader = centralDirectoryHeader({
      compressedSize: data.length,
      crc: checksum,
      fileNameBytes,
      offset,
      uncompressedSize: data.length,
    });

    localParts.push(localHeader, data);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const footer = endOfCentralDirectory({
    centralDirectoryOffset,
    centralDirectorySize: centralDirectory.length,
    entryCount: entries.length,
  });

  return Buffer.concat([...localParts, centralDirectory, footer]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    return;
  }

  const packageJson = await readJson("package.json");
  const sourceManifest = await readJson("module.json");
  const version = options.version || requireString(packageJson.version, "package.json version");
  const tag = options.tag || `v${version}`;
  const repo = normalizeGitHubRepo(options.repo || getOriginRemote());
  const packageVersion = requireString(packageJson.version, "package.json version");
  const manifestVersion = requireString(sourceManifest.version, "module.json version");

  if (version !== packageVersion || version !== manifestVersion) {
    throw new Error(
      `Release version ${version} must match package.json (${packageVersion}) and module.json (${manifestVersion}).`,
    );
  }

  const outputRoot = resolveOutputRoot(options.outDir);
  const packageRoot = path.join(outputRoot, "package");
  const releaseManifest = buildReleaseManifest(sourceManifest, { repo, tag, version });

  await rm(outputRoot, { force: true, recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(packageRoot, "module.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`);

  for (const directory of packageDirectories) {
    await copyDirectory(directory, packageRoot);
  }

  await pruneSourceMaps(packageRoot);

  for (const file of optionalPackageFiles) {
    await copyOptionalFile(file, packageRoot);
  }

  const entries = await listFiles(packageRoot);
  validatePackageEntries(entries);

  const zipBuffer = await createZipFromFiles(packageRoot, entries);
  const zipPath = path.join(outputRoot, "module.zip");
  const manifestPath = path.join(outputRoot, "module.json");
  const zipSha256 = createHash("sha256").update(zipBuffer).digest("hex");
  const packageSummary = {
    id: releaseManifest.id,
    version,
    tag,
    repository: repo,
    manifest: releaseManifest.manifest,
    download: releaseManifest.download,
    output: {
      manifest: path.relative(repoRoot, manifestPath).replaceAll(path.sep, "/"),
      zip: path.relative(repoRoot, zipPath).replaceAll(path.sep, "/"),
    },
    zipSha256,
    entries,
  };

  await writeFile(manifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`);
  await writeFile(zipPath, zipBuffer);
  await writeFile(path.join(outputRoot, "package-manifest.json"), `${JSON.stringify(packageSummary, null, 2)}\n`);

  console.log(`Created ${path.relative(repoRoot, manifestPath)}`);
  console.log(`Created ${path.relative(repoRoot, zipPath)} (${entries.length} files, sha256 ${zipSha256})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
