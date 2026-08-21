import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { qualifyWf51ReleaseOverlay } from "../foundry-smoke/wf51-release-overlay-evidence.mjs";
import { parseGeneratedCharacterWealthModule } from "../starting-equipment/generate-character-wealth.mjs";
import {
  buildReleaseManifest,
  requiredPackageEntriesForManifest,
  validatePackageEntries,
} from "./prepare-package.mjs";

const execFileAsync = promisify(execFile);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REQUIRED_NOTICE_ENTRIES = Object.freeze([
  "LEGAL.md",
  "LICENSE.md",
  "licenses/OPEN-GAME-LICENSE-1.0A.md",
  "licenses/ORC-NOTICE.md",
  "licenses/THIRD-PARTY-NOTICES.md",
]);
const POLICY_ARTIFACT_PATHS = Object.freeze({
  generatedWealth: "src/wayfinder/domain/character-wealth-policy.generated.ts",
  semanticWealth: "src/wayfinder/domain/semantic-wealth-policy.ts",
  wealthFixture: "tools/starting-equipment/fixtures/pf2e-8.4.0-character-wealth-policy.json",
  physicalGrantRegistry: "docs/coverage/pf2e-8.4.1-level1-physical-grants.json",
});

export async function captureExactCandidate({ repoRoot, ref }) {
  requireNonEmpty(ref, "Release ref");
  const [{ stdout: headOutput }, { stdout: refOutput }, { stdout: symbolicRefOutput }, { stdout: statusOutput }] =
    await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }),
    execFileAsync("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: repoRoot }),
    execFileAsync("git", ["rev-parse", "--symbolic-full-name", ref], { cwd: repoRoot }),
    execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: repoRoot }),
  ]);
  const gitSha = headOutput.trim();
  const resolvedRefSha = refOutput.trim();
  const fullRef = symbolicRefOutput.trim();
  const dirtyPaths = statusOutput
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
  if (
    !GIT_SHA_PATTERN.test(gitSha) ||
    resolvedRefSha !== gitSha ||
    !/^refs\/(?:heads|tags)\/[\w./-]+$/u.test(fullRef)
  ) {
    throw new Error(`Release ref ${ref} does not resolve to exact candidate ${gitSha}.`);
  }
  if (dirtyPaths.length > 0) {
    throw new Error(`Qualified packaging requires a clean candidate: ${dirtyPaths.join(", ")}`);
  }
  return { gitSha, requestedRef: ref, ref: fullRef, resolvedRefSha, dirtyPaths };
}

export async function bindWf51Evidence({
  repoRoot,
  artifactRoot,
  expectedGitSha,
  qualifier = qualifyWf51ReleaseOverlay,
}) {
  const root = path.resolve(repoRoot, artifactRoot);
  const relativeRoot = repoRelative(repoRoot, root);
  if (!relativeRoot?.startsWith(".wayfinder-smoke/")) {
    throw new Error("WF-080-51 evidence must be a repository-local .wayfinder-smoke artifact directory.");
  }
  await assertDirectoryNotLink(root, "WF-080-51 artifact root");
  const finalRoot = path.join(root, "final");
  const files = {
    state: path.join(root, "wf51-release-coordinator-state.json"),
    coordinatorManifest: path.join(root, "wf51-focused-coordinator-manifest.json"),
    result: path.join(finalRoot, "wf51-release-overlay-results.json"),
    summary: path.join(finalRoot, "wf51-release-overlay-summary.md"),
    completion: path.join(finalRoot, "wf51-release-overlay-completion.json"),
    lock: path.join(finalRoot, ".wf51-release-overlay.lock"),
  };
  const entries = await Promise.all(
    Object.entries(files).map(async ([key, filePath]) => [key, await readContainedFile(root, filePath)]),
  );
  const bytes = Object.fromEntries(entries);
  const state = parseJson(bytes.state, "WF-080-51 coordinator state");
  const coordinatorManifest = parseJson(bytes.coordinatorManifest, "WF-080-51 focused coordinator manifest");
  const result = parseJson(bytes.result, "WF-080-51 final result");
  const completion = parseJson(bytes.completion, "WF-080-51 completion");
  const qualification = qualifier(result);

  if (
    state?.schemaVersion !== 1 ||
    state.status !== "complete" ||
    state.error !== null ||
    state.qualification?.ok !== true ||
    result?.schemaVersion !== 1 ||
    result.status !== "complete" ||
    result.stage !== "qualified" ||
    result.error !== null ||
    result.qualification?.ok !== true ||
    qualification?.ok !== true
  ) {
    const details = qualification?.failures?.join(" ") || "artifact status or stored qualification is not complete";
    throw new Error(`WF-080-51 evidence is not independently qualified: ${details}`);
  }
  if (
    result.candidate?.gitSha !== expectedGitSha ||
    result.coordinator?.candidateSha !== expectedGitSha ||
    state.candidateSha !== expectedGitSha ||
    coordinatorManifest?.candidateSha !== expectedGitSha
  ) {
    throw new Error("WF-080-51 evidence belongs to a stale or foreign git candidate.");
  }
  if (
    completion?.schemaVersion !== 1 ||
    completion.qualified !== true ||
    completion.evidenceId !== result.evidenceId ||
    completion.candidateSha !== expectedGitSha ||
    completion.servedScriptManifestSha256 !== result.candidate.servedScriptManifestSha256 ||
    completion.resultSha256 !== sha256(bytes.result) ||
    completion.summarySha256 !== sha256(bytes.summary) ||
    bytes.lock.toString("utf8") !== `${result.evidenceId}\n`
  ) {
    throw new Error("WF-080-51 completion hashes or identity do not match the final artifacts.");
  }
  if (
    state.evidenceId !== result.evidenceId ||
    state.runId !== result.runId ||
    coordinatorManifest.runId !== result.runId ||
    JSON.stringify(state.children) !== JSON.stringify(result.coordinator.children)
  ) {
    throw new Error("WF-080-51 coordinator state and final result disagree.");
  }

  const childEvidence = [];
  let focusedResult = null;
  for (const child of result.coordinator.children ?? []) {
    assertChildRecord(child, expectedGitSha);
    const childRoot = path.join(root, child.id);
    const resultPath = path.resolve(child.resultPath);
    if (path.dirname(resultPath) !== childRoot) {
      throw new Error(`WF-080-51 child ${child.id} result path is outside its owned artifact directory.`);
    }
    const [resultBytes, stdoutBytes, stderrBytes] = await Promise.all([
      readContainedFile(root, resultPath),
      readContainedFile(root, path.join(childRoot, "coordinator-stdout.log")),
      readContainedFile(root, path.join(childRoot, "coordinator-stderr.log")),
    ]);
    if (
      sha256(resultBytes) !== child.resultSha256 ||
      sha256(stdoutBytes) !== child.stdoutSha256 ||
      sha256(stderrBytes) !== child.stderrSha256
    ) {
      throw new Error(`WF-080-51 child ${child.id} raw result or log hash does not match its coordinator record.`);
    }
    if (child.id === "focused") focusedResult = parseJson(resultBytes, "WF-080-51 focused child result");
    childEvidence.push({
      id: child.id,
      resultPath: repoRelative(repoRoot, resultPath),
      resultSha256: child.resultSha256,
      stdoutSha256: child.stdoutSha256,
      stderrSha256: child.stderrSha256,
    });
  }
  if (
    childEvidence.length !== 11 ||
    !focusedResult ||
    focusedResult.coordinator?.manifestSha256 !== sha256(bytes.coordinatorManifest) ||
    JSON.stringify(coordinatorManifest.children) !==
      JSON.stringify(result.coordinator.children.filter((entry) => entry.id !== "focused"))
  ) {
    throw new Error("WF-080-51 child set or focused coordinator-manifest binding is incomplete.");
  }

  const localModuleFiles = await captureLocalModuleFiles(repoRoot);
  if (JSON.stringify(localModuleFiles) !== JSON.stringify(result.candidate.localModuleFiles)) {
    throw new Error("WF-080-51 local module-file evidence no longer matches the exact candidate bytes.");
  }
  const servedScripts = result.candidate.servedModuleFiles
    .filter((entry) => entry.path.endsWith(".js"))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (sha256(canonicalJson(servedScripts)) !== result.candidate.servedScriptManifestSha256) {
    throw new Error("WF-080-51 served-script digest does not match the served file evidence.");
  }

  return {
    artifactRoot: relativeRoot,
    evidenceId: result.evidenceId,
    runId: result.runId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    resultSha256: sha256(bytes.result),
    summarySha256: sha256(bytes.summary),
    completionSha256: sha256(bytes.completion),
    stateSha256: sha256(bytes.state),
    coordinatorManifestSha256: sha256(bytes.coordinatorManifest),
    servedScriptManifestSha256: result.candidate.servedScriptManifestSha256,
    runtime: result.runtime,
    children: childEvidence,
    overlayPolicyEvidenceSha256: sha256(
      canonicalJson(
        result.overlay.map((entry) => ({
          id: entry.id,
          definitionFingerprint: entry.definitionFingerprint,
          policy: entry.evidence?.policy,
        })),
      ),
    ),
  };
}

export async function bindPolicyArtifacts(repoRoot) {
  const generatedSource = await readFile(path.join(repoRoot, POLICY_ARTIFACT_PATHS.generatedWealth), "utf8");
  const wealth = parseGeneratedCharacterWealthModule(generatedSource);
  const fileDigests = {};
  for (const [key, relativePath] of Object.entries(POLICY_ARTIFACT_PATHS)) {
    fileDigests[key] = { path: relativePath, sha256: sha256(await readFile(path.join(repoRoot, relativePath))) };
  }
  return {
    characterWealth: {
      policyId: wealth.policyId,
      policyVersion: wealth.policyVersion,
      dataDigest: wealth.dataDigest,
      artifactDigest: wealth.artifactDigest,
      source: wealth.source,
    },
    files: fileDigests,
  };
}

export async function bindGeneratedScripts(repoRoot) {
  const files = await listFiles(path.join(repoRoot, "scripts"));
  const manifest = await Promise.all(
    files.map(async (relativePath) => ({
      path: `scripts/${relativePath}`,
      sha256: sha256(await readFile(path.join(repoRoot, "scripts", relativePath))),
    })),
  );
  return { fileCount: manifest.length, manifestSha256: sha256(canonicalJson(manifest)) };
}

export async function bindPackageOutput({ repoRoot, outputRoot, repo, tag, version, candidateGitSha }) {
  if (tag !== `v${version}`) throw new Error(`Qualified package tag must be exactly v${version}.`);
  if (!GIT_SHA_PATTERN.test(candidateGitSha ?? "")) throw new Error("Qualified package requires an exact candidate SHA.");
  const root = path.resolve(repoRoot, outputRoot);
  const packageRoot = path.join(root, "package");
  const [sourcePackageBytes, sourceManifestBytes, releaseManifestBytes, summaryBytes, zipBytes] = await Promise.all([
    readGitBlob(repoRoot, candidateGitSha, "package.json"),
    readGitBlob(repoRoot, candidateGitSha, "module.json"),
    readContainedFile(root, path.join(root, "module.json")),
    readContainedFile(root, path.join(root, "package-manifest.json")),
    readContainedFile(root, path.join(root, "module.zip")),
  ]);
  const packageJson = parseJson(sourcePackageBytes, "package.json");
  const sourceManifest = parseJson(sourceManifestBytes, "development module.json");
  const releaseManifest = parseJson(releaseManifestBytes, "release module.json");
  const summary = parseJson(summaryBytes, "package manifest");
  const expectedManifest = buildReleaseManifest(sourceManifest, { repo, tag, version });
  const repositoryUrl = `https://github.com/${repo}`;
  if (
    packageJson.version !== version ||
    sourceManifest.version !== version ||
    sourceManifest.url !== repositoryUrl ||
    sourceManifest.readme !== `${repositoryUrl}#readme` ||
    sourceManifest.bugs !== `${repositoryUrl}/issues` ||
    JSON.stringify(releaseManifest) !== JSON.stringify(expectedManifest)
  ) {
    throw new Error("Release package version or module metadata differs from the exact candidate.");
  }
  const expectedManifestUrl = `https://github.com/${repo}/releases/latest/download/module.json`;
  const expectedDownloadUrl = `https://github.com/${repo}/releases/download/${tag}/module.zip`;
  const relativeOutputRoot = repoRelative(repoRoot, root);
  if (!relativeOutputRoot) throw new Error("Qualified package output must remain inside the repository.");
  if (
    releaseManifest.manifest !== expectedManifestUrl ||
    releaseManifest.download !== expectedDownloadUrl ||
    releaseManifest.changelog !== `https://github.com/${repo}/releases/tag/${tag}` ||
    summary.id !== releaseManifest.id ||
    summary.version !== version ||
    summary.tag !== tag ||
    summary.repository !== repo ||
    summary.manifest !== expectedManifestUrl ||
    summary.download !== expectedDownloadUrl ||
    summary.output?.manifest !== `${relativeOutputRoot}/module.json` ||
    summary.output?.zip !== `${relativeOutputRoot}/module.zip`
  ) {
    throw new Error("Package manifest URLs, version, tag, repository, or module identity drifted.");
  }
  const zipSha256 = sha256(zipBytes);
  if (!SHA256_PATTERN.test(summary.zipSha256 ?? "") || summary.zipSha256 !== zipSha256) {
    throw new Error("Package ZIP SHA-256 does not match package-manifest.json.");
  }
  const archiveEntries = inspectStoredZip(zipBytes);
  const archiveNames = archiveEntries.map((entry) => entry.path);
  if (JSON.stringify(archiveNames) !== JSON.stringify(summary.entries)) {
    throw new Error("ZIP entries differ from package-manifest.json.");
  }
  validatePackageEntries(archiveNames, releaseManifest);
  for (const notice of REQUIRED_NOTICE_ENTRIES) {
    if (!archiveNames.includes(notice)) throw new Error(`Package is missing required notice ${notice}.`);
  }
  const requiredEntries = requiredPackageEntriesForManifest(releaseManifest);
  const missingRequired = requiredEntries.filter((entry) => !archiveNames.includes(entry));
  if (missingRequired.length > 0) throw new Error(`Package is missing required entries: ${missingRequired.join(", ")}`);

  const packageFiles = await listFiles(packageRoot);
  if (JSON.stringify(packageFiles) !== JSON.stringify(archiveNames)) {
    throw new Error("ZIP entries differ from the staged package tree.");
  }
  const assetHashes = [];
  for (const archiveEntry of archiveEntries) {
    const stagedBytes = await readContainedFile(packageRoot, path.join(packageRoot, archiveEntry.path));
    const stagedSha256 = sha256(stagedBytes);
    if (stagedBytes.byteLength !== archiveEntry.bytes || stagedSha256 !== archiveEntry.sha256) {
      throw new Error(`ZIP asset bytes differ from staged package entry ${archiveEntry.path}.`);
    }
    const sourceBytes = await candidateSourceBytes({
      repoRoot,
      candidateGitSha,
      entryPath: archiveEntry.path,
      sourceManifestBytes,
      releaseManifestBytes,
    });
    if (!stagedBytes.equals(sourceBytes.packaged)) {
      throw new Error(`Staged package entry ${archiveEntry.path} does not derive from the exact candidate source bytes.`);
    }
    assetHashes.push({
      path: archiveEntry.path,
      bytes: archiveEntry.bytes,
      sha256: archiveEntry.sha256,
      candidateSourceSha256: sha256(sourceBytes.candidate),
    });
  }
  return {
    module: {
      id: releaseManifest.id,
      version: releaseManifest.version,
      compatibility: releaseManifest.compatibility,
      systems: releaseManifest.relationships?.systems,
      manifest: releaseManifest.manifest,
      download: releaseManifest.download,
      changelog: releaseManifest.changelog,
      sourceManifestSha256: sha256(sourceManifestBytes),
      releaseManifestSha256: sha256(releaseManifestBytes),
    },
    tag,
    repository: repo,
    zipSha256,
    packageManifestSha256: sha256(summaryBytes),
    entryCount: assetHashes.length,
    entriesManifestSha256: sha256(canonicalJson(assetHashes)),
    entries: assetHashes,
    requiredNotices: REQUIRED_NOTICE_ENTRIES,
  };
}

export function inspectStoredZip(zipBytes) {
  const buffer = Buffer.from(zipBytes);
  const eocdOffset = findEocd(buffer);
  const disk = buffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6);
  const diskEntries = buffer.readUInt16LE(eocdOffset + 8);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const commentLength = buffer.readUInt16LE(eocdOffset + 20);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    diskEntries !== entryCount ||
    eocdOffset + 22 + commentLength !== buffer.length ||
    centralOffset + centralSize !== eocdOffset
  ) {
    throw new Error("ZIP central-directory boundaries or disk metadata are invalid.");
  }
  const entries = [];
  const portable = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    ensureRange(buffer, cursor, 46, "ZIP central-directory entry");
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("ZIP central-directory signature is invalid.");
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const centralCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const entryCommentLength = buffer.readUInt16LE(cursor + 32);
    const startDisk = buffer.readUInt16LE(cursor + 34);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    ensureRange(buffer, cursor + 46, nameLength + extraLength + entryCommentLength, "ZIP entry name");
    const entryPath = decodeUtf8(buffer.subarray(cursor + 46, cursor + 46 + nameLength));
    assertSafeArchivePath(entryPath);
    const folded = entryPath.toLowerCase();
    if (portable.has(folded)) {
      throw new Error(`ZIP contains duplicate or case-colliding archive paths: ${portable.get(folded)}, ${entryPath}.`);
    }
    portable.set(folded, entryPath);
    if (flags !== 0x0800 || method !== 0 || startDisk !== 0 || compressedSize !== uncompressedSize) {
      throw new Error(`ZIP entry ${entryPath} is encrypted, split, compressed, or otherwise unsupported.`);
    }
    ensureRange(buffer, localOffset, 30, `ZIP local entry ${entryPath}`);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP local header is invalid for ${entryPath}.`);
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localCrc = buffer.readUInt32LE(localOffset + 14);
    const localCompressedSize = buffer.readUInt32LE(localOffset + 18);
    const localUncompressedSize = buffer.readUInt32LE(localOffset + 22);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    ensureRange(buffer, localOffset + 30, localNameLength + localExtraLength, `ZIP local name ${entryPath}`);
    const localPath = decodeUtf8(buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength));
    if (
      localPath !== entryPath ||
      localFlags !== flags ||
      localMethod !== method ||
      localCrc !== centralCrc ||
      localCompressedSize !== compressedSize ||
      localUncompressedSize !== uncompressedSize
    ) {
      throw new Error(`ZIP central and local metadata disagree for ${entryPath}.`);
    }
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    ensureRange(buffer, dataOffset, compressedSize, `ZIP data ${entryPath}`);
    if (localOffset >= centralOffset || dataOffset + compressedSize > centralOffset) {
      throw new Error(`ZIP local data overlaps its central directory for ${entryPath}.`);
    }
    const data = buffer.subarray(dataOffset, dataOffset + compressedSize);
    if (crc32(data) !== centralCrc) throw new Error(`ZIP CRC-32 does not match entry bytes for ${entryPath}.`);
    entries.push({ path: entryPath, bytes: data.byteLength, sha256: sha256(data) });
    cursor += 46 + nameLength + extraLength + entryCommentLength;
  }
  if (cursor !== eocdOffset) throw new Error("ZIP central-directory entry count or size is inconsistent.");
  return entries;
}

export function assertSafeArchivePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.includes(":") ||
    value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe ZIP archive path: ${String(value)}.`);
  }
}

export function qualifiedEvidenceDocument({ candidate, wf51, policies, generatedScripts, packageEvidence }) {
  if (wf51.runtime?.moduleVersion !== packageEvidence.module.version) {
    throw new Error("WF-080-51 runtime module version does not match the packaged version.");
  }
  if (
    wf51.runtime?.foundryVersion !== packageEvidence.module.compatibility?.verified ||
    wf51.runtime?.pf2eVersion !== packageEvidence.module.systems?.find((entry) => entry.id === "pf2e")?.compatibility?.verified
  ) {
    throw new Error("WF-080-51 runtime does not match the advertised verified Foundry/PF2E compatibility lane.");
  }
  const pf2eCompatibility = packageEvidence.module.systems?.find((entry) => entry.id === "pf2e")?.compatibility;
  if (pf2eCompatibility?.minimum !== pf2eCompatibility?.verified) {
    throw new Error("PF2E minimum compatibility remains unqualified; raise it to the exact verified WF-080-51 lane.");
  }
  const payload = {
    schemaVersion: 1,
    candidate,
    wf51,
    policies,
    generatedScripts,
    package: packageEvidence,
  };
  return { ...payload, evidenceSha256: sha256(canonicalJson(payload)) };
}

async function captureLocalModuleFiles(repoRoot) {
  const scriptFiles = (await listFiles(path.join(repoRoot, "scripts")))
    .filter((entry) => entry.endsWith(".js"))
    .map((entry) => `scripts/${entry}`);
  const paths = ["module.json", ...scriptFiles].sort((left, right) => left.localeCompare(right));
  return Promise.all(
    paths.map(async (relativePath) => {
      const bytes = await readFile(path.join(repoRoot, relativePath));
      return { path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) };
    }),
  );
}

async function candidateSourceBytes({ repoRoot, candidateGitSha, entryPath, sourceManifestBytes, releaseManifestBytes }) {
  if (entryPath === "module.json") {
    return { candidate: sourceManifestBytes, packaged: releaseManifestBytes };
  }
  const candidate = await readGitBlob(repoRoot, candidateGitSha, entryPath);
  if (!entryPath.endsWith(".js")) return { candidate, packaged: candidate };
  const packaged = Buffer.from(
    candidate
      .toString("utf8")
      .replace(/\r?\n\/\/# sourceMappingURL=.*\r?\n?$/u, "\n"),
  );
  return { candidate, packaged };
}

async function readGitBlob(repoRoot, gitSha, relativePath) {
  assertSafeArchivePath(relativePath);
  try {
    const { stdout } = await execFileAsync("git", ["show", `${gitSha}:${relativePath}`], {
      cwd: repoRoot,
      encoding: null,
      maxBuffer: 32 * 1024 * 1024,
    });
    return Buffer.from(stdout);
  } catch {
    throw new Error(`Package entry ${relativePath} is not a tracked source blob at candidate ${gitSha}.`);
  }
}

function assertChildRecord(child, expectedGitSha) {
  if (
    typeof child?.id !== "string" ||
    !child.id ||
    child.exitCode !== 0 ||
    child.candidateSha !== expectedGitSha ||
    child.candidateDrift !== false ||
    !SHA256_PATTERN.test(child.resultSha256 ?? "") ||
    !SHA256_PATTERN.test(child.stdoutSha256 ?? "") ||
    !SHA256_PATTERN.test(child.stderrSha256 ?? "")
  ) {
    throw new Error(`WF-080-51 child ${child?.id ?? "<unknown>"} is incomplete or foreign.`);
  }
}

async function assertDirectoryNotLink(targetPath, label) {
  const entry = await lstat(targetPath);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`${label} must be a real directory.`);
}

async function readContainedFile(root, filePath) {
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(filePath)]);
  const relative = path.relative(realRoot, realFile);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Evidence or package file escaped its owned directory: ${filePath}.`);
  }
  const entry = await lstat(filePath);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Expected a regular owned file: ${filePath}.`);
  return readFile(filePath);
}

async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing to bind a symbolic link: ${absolutePath}.`);
    if (entry.isDirectory()) files.push(...(await listFiles(root, absolutePath)));
    else if (entry.isFile()) files.push(path.relative(root, absolutePath).replaceAll(path.sep, "/"));
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function findEocd(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP end-of-central-directory record is missing.");
}

function ensureRange(buffer, offset, length, label) {
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(`${label} exceeds the ZIP boundary.`);
  }
}

function decodeUtf8(value) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new Error("ZIP contains a non-UTF-8 archive path.");
  }
}

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is missing or malformed JSON.`);
  }
}

function repoRelative(repoRoot, value) {
  const relative = path.relative(repoRoot, value).replaceAll(path.sep, "/");
  return relative && relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative) ? relative : null;
}

function requireNonEmpty(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
