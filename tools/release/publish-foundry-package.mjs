#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const endpoint = "https://foundryvtt.com/_api/packages/release_version/";

function usage() {
  return [
    "Usage: node tools/release/publish-foundry-package.mjs [options]",
    "",
    "Options:",
    "  --manifest <path>       Release manifest path. Defaults to dist/release/module.json.",
    "  --version <version>     Release version. Defaults to manifest version.",
    "  --tag <tag>             Release tag. Defaults to v<version>.",
    "  --repo <owner/repo>     GitHub repository. Defaults to GITHUB_REPOSITORY.",
    "  --manifest-url <url>    Version-specific manifest URL. Defaults to GitHub release URL.",
    "  --notes-url <url>       Version-specific release notes URL. Defaults to GitHub release tag URL.",
    "  --token-env <name>      Environment variable containing the Foundry token. Defaults to FOUNDRY_PACKAGE_RELEASE_TOKEN.",
    "  --dry-run               Ask Foundry to validate without saving.",
    "  --help                  Show this help text.",
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    manifestPath: "dist/release/module.json",
    manifestUrl: "",
    notesUrl: "",
    repo: process.env.GITHUB_REPOSITORY ?? "",
    tag: "",
    tokenEnv: "FOUNDRY_PACKAGE_RELEASE_TOKEN",
    version: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (!["--manifest", "--manifest-url", "--notes-url", "--repo", "--tag", "--token-env", "--version"].includes(arg)) {
      throw new Error("Unknown argument: " + arg);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("Missing value for " + arg);
    }

    if (arg === "--manifest") options.manifestPath = value;
    if (arg === "--manifest-url") options.manifestUrl = value;
    if (arg === "--notes-url") options.notesUrl = value;
    if (arg === "--repo") options.repo = value;
    if (arg === "--tag") options.tag = value;
    if (arg === "--token-env") options.tokenEnv = value;
    if (arg === "--version") options.version = value;
    index += 1;
  }

  return options;
}

async function readJson(relativePath) {
  const content = await readFile(path.resolve(repoRoot, relativePath), "utf8");
  return JSON.parse(content);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(label + " must be a non-empty string.");
  }

  return value.trim();
}

function buildGitHubReleaseUrl(repo, tag, fileName) {
  return "https://github.com/" + repo + "/releases/download/" + tag + "/" + fileName;
}

function normalizeCompatibility(compatibility) {
  if (!compatibility || typeof compatibility !== "object") {
    throw new Error("Manifest compatibility must be an object.");
  }

  return {
    maximum: typeof compatibility.maximum === "string" ? compatibility.maximum : "",
    minimum: requireString(compatibility.minimum, "compatibility.minimum"),
    verified: requireString(compatibility.verified, "compatibility.verified"),
  };
}

async function waitForUrl(url) {
  const attempts = 12;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, { method: "HEAD", redirect: "follow" });
    if (response.ok) return;

    if (attempt === attempts) {
      throw new Error(
        "Release URL was not reachable after " + attempts + " attempts: " + url + " (HTTP " + response.status + ")",
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function postRelease({ body, token }) {
  const response = await fetch(endpoint, {
    body: JSON.stringify(body),
    headers: {
      Authorization: token,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const text = await response.text();
  let payload;

  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }

  if (!response.ok) {
    throw new Error("Foundry Package Release API failed with HTTP " + response.status + ": " + JSON.stringify(payload));
  }

  return payload;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(usage());
    return;
  }

  const token = process.env[options.tokenEnv];
  if (!token) {
    throw new Error(options.tokenEnv + " is not set.");
  }

  const manifest = await readJson(options.manifestPath);
  const version = options.version || requireString(manifest.version, "manifest version");
  const tag = options.tag || "v" + version;
  const repo = requireString(options.repo, "--repo or GITHUB_REPOSITORY");

  if (version !== manifest.version) {
    throw new Error("Release version " + version + " must match manifest version " + manifest.version + ".");
  }

  const manifestUrl = options.manifestUrl || buildGitHubReleaseUrl(repo, tag, "module.json");
  const notesUrl = options.notesUrl || "https://github.com/" + repo + "/releases/tag/" + tag;
  const requestBody = {
    id: requireString(manifest.id, "manifest id"),
    release: {
      compatibility: normalizeCompatibility(manifest.compatibility),
      manifest: manifestUrl,
      notes: notesUrl,
      version,
    },
  };

  if (options.dryRun) {
    requestBody["dry-run"] = true;
  }

  await waitForUrl(manifestUrl);
  const result = await postRelease({ body: requestBody, token });
  const mode = options.dryRun ? "dry run" : "publish";
  console.log("Foundry package release " + mode + " succeeded for " + requestBody.id + " " + version + ".");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
