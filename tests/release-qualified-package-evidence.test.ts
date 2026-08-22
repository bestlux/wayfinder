import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildReleaseManifest } from "../tools/release/prepare-package.mjs";
import {
  assertSafeArchivePath,
  bindPackageOutput,
  bindWf51Evidence,
  captureExactCandidate,
  inspectStoredZip,
  qualifiedEvidenceDocument,
} from "../tools/release/qualified-package-evidence.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("WF-080-52 qualified package evidence", () => {
  it("reads exact stored ZIP asset hashes and rejects unsafe or colliding paths", () => {
    const archive = storedZip([
      ["module.json", Buffer.from("module")],
      ["scripts/wayfinder.js", Buffer.from("script")],
    ]);
    expect(inspectStoredZip(archive)).toEqual([
      { path: "module.json", bytes: 6, sha256: sha256("module") },
      { path: "scripts/wayfinder.js", bytes: 6, sha256: sha256("script") },
    ]);

    for (const unsafe of ["../module.json", "/module.json", "C:/module.json", "lang\\en.json"]) {
      expect(() => assertSafeArchivePath(unsafe), unsafe).toThrow(/unsafe zip archive path/i);
    }
    expect(() =>
      inspectStoredZip(
        storedZip([
          ["lang/en.json", Buffer.from("one")],
          ["lang/EN.json", Buffer.from("two")],
        ])
      )
    ).toThrow(/duplicate|colliding/i);
    expect(() => inspectStoredZip(storedZip([["../module.json", Buffer.from("bad")]]))).toThrow(/unsafe/i);
  });

  it("binds package URLs, required notices, staged bytes, every ZIP entry hash, and the ZIP digest", async () => {
    const fixture = await packageFixture();
    const evidence = await bindPackageOutput({
      repoRoot: fixture.root,
      outputRoot: "dist/qualified",
      repo: fixture.repository,
      tag: fixture.tag,
      version: fixture.version,
      candidateGitSha: fixture.gitSha,
    });
    expect(evidence.zipSha256).toBe(sha256(fixture.zip));
    expect(evidence.entries).toHaveLength(fixture.entries.length);
    expect(evidence.entries.every((entry) => /^[0-9a-f]{64}$/u.test(entry.candidateSourceSha256))).toBe(true);
    expect(evidence.entriesManifestSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(evidence.module).toMatchObject({
      id: "wayfinder-pf2e",
      version: fixture.version,
      manifest: `https://github.com/${fixture.repository}/releases/latest/download/module.json`,
      download: `https://github.com/${fixture.repository}/releases/download/${fixture.tag}/module.zip`,
    });
    await expect(
      bindPackageOutput({
        repoRoot: fixture.root,
        outputRoot: "dist/qualified",
        repo: fixture.repository,
        tag: "release-candidate",
        version: fixture.version,
        candidateGitSha: fixture.gitSha,
      })
    ).rejects.toThrow(/tag must be exactly/i);
    await expect(
      bindPackageOutput({
        repoRoot: fixture.root,
        outputRoot: "dist/qualified",
        repo: "attacker/fork",
        tag: fixture.tag,
        version: fixture.version,
        candidateGitSha: fixture.gitSha,
      })
    ).rejects.toThrow(/module metadata|candidate/i);

    const summaryPath = join(fixture.root, "dist/qualified/package-manifest.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.zipSha256 = "0".repeat(64);
    await writeFile(summaryPath, `${JSON.stringify(summary)}\n`);
    await expect(
      bindPackageOutput({
        repoRoot: fixture.root,
        outputRoot: "dist/qualified",
        repo: fixture.repository,
        tag: fixture.tag,
        version: fixture.version,
        candidateGitSha: fixture.gitSha,
      })
    ).rejects.toThrow(/zip sha-256/i);
  }, 30_000);

  it("rejects a self-consistent ZIP and summary when staged assets differ from candidate source", async () => {
    const fixture = await packageFixture();
    const stagedPath = join(fixture.root, "dist/qualified/package/lang/en.json");
    await writeFile(stagedPath, '{"substituted":true}\n');
    const tamperedEntries = fixture.entries.map(([entryPath, bytes]) =>
      entryPath === "lang/en.json"
        ? ([entryPath, Buffer.from('{"substituted":true}\n')] as [string, Buffer])
        : [entryPath, bytes]
    ) as [string, Buffer][];
    const tamperedZip = storedZip(tamperedEntries);
    await writeFile(join(fixture.root, "dist/qualified/module.zip"), tamperedZip);
    const summaryPath = join(fixture.root, "dist/qualified/package-manifest.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.zipSha256 = sha256(tamperedZip);
    await writeFile(summaryPath, `${JSON.stringify(summary)}\n`);
    await expect(
      bindPackageOutput({
        repoRoot: fixture.root,
        outputRoot: "dist/qualified",
        repo: fixture.repository,
        tag: fixture.tag,
        version: fixture.version,
        candidateGitSha: fixture.gitSha,
      })
    ).rejects.toThrow(/exact candidate source bytes/i);
  });

  it("rejects an ignored package entry that has no tracked blob at the candidate SHA", async () => {
    const fixture = await packageFixture();
    const injected = ["lang/injected.json", Buffer.from('{"ignored":true}\n')] as [string, Buffer];
    await writeFile(join(fixture.root, ".git/info/exclude"), "lang/injected.json\n");
    await writeFile(join(fixture.root, injected[0]), injected[1]);
    await writeFile(join(fixture.root, "dist/qualified/package", injected[0]), injected[1]);
    const entries = [...fixture.entries, injected].sort(([left], [right]) => left.localeCompare(right));
    const zip = storedZip(entries);
    await writeFile(join(fixture.root, "dist/qualified/module.zip"), zip);
    const summaryPath = join(fixture.root, "dist/qualified/package-manifest.json");
    const summary = JSON.parse(await readFile(summaryPath, "utf8"));
    summary.zipSha256 = sha256(zip);
    summary.entries = entries.map(([entryPath]) => entryPath);
    await writeFile(summaryPath, `${JSON.stringify(summary)}\n`);
    expect(execFileSync("git", ["status", "--porcelain"], { cwd: fixture.root, encoding: "utf8" })).toBe("");
    await expect(
      bindPackageOutput({
        repoRoot: fixture.root,
        outputRoot: "dist/qualified",
        repo: fixture.repository,
        tag: fixture.tag,
        version: fixture.version,
        candidateGitSha: fixture.gitSha,
      })
    ).rejects.toThrow(/not a tracked source blob/i);
  });

  it("binds all WF51 raw child results and logs to the exact candidate", async () => {
    const fixture = await wf51Fixture();
    const evidence = await bindWf51Evidence({
      repoRoot: fixture.root,
      artifactRoot: fixture.artifactRoot,
      expectedGitSha: fixture.gitSha,
      qualifier: () => ({ ok: true, failures: [] }),
    });
    expect(evidence).toMatchObject({
      evidenceId: "evidence-1",
      resultSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      servedScriptManifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(evidence.children).toHaveLength(11);
    expect(evidence.children.every((entry) => entry.stdoutSha256 && entry.stderrSha256)).toBe(true);

    await writeFile(join(fixture.artifactRoot, "wave3/coordinator-stdout.log"), "tampered\n");
    await expect(
      bindWf51Evidence({
        repoRoot: fixture.root,
        artifactRoot: fixture.artifactRoot,
        expectedGitSha: fixture.gitSha,
        qualifier: () => ({ ok: true, failures: [] }),
      })
    ).rejects.toThrow(/raw result or log hash/i);
  });

  it("rejects stale WF51 candidates and unqualified fresh artifacts", async () => {
    const fixture = await wf51Fixture();
    await expect(
      bindWf51Evidence({
        repoRoot: fixture.root,
        artifactRoot: fixture.artifactRoot,
        expectedGitSha: "f".repeat(40),
        qualifier: () => ({ ok: true, failures: [] }),
      })
    ).rejects.toThrow(/stale or foreign/i);
    await expect(
      bindWf51Evidence({
        repoRoot: fixture.root,
        artifactRoot: fixture.artifactRoot,
        expectedGitSha: fixture.gitSha,
        qualifier: () => ({ ok: false, failures: ["forced evidence failure"] }),
      })
    ).rejects.toThrow(/forced evidence failure/i);
  });

  it("requires live runtime compatibility and module version to match packaged metadata", () => {
    const base = {
      candidate: { gitSha: "a".repeat(40), ref: "refs/heads/release" },
      wf51: { runtime: { moduleVersion: "0.8.0", foundryVersion: "14.366", pf2eVersion: "8.4.1" } },
      policies: { digest: "policy" },
      generatedScripts: { manifestSha256: "scripts" },
      packageEvidence: {
        module: {
          version: "0.8.0",
          compatibility: { minimum: "14", verified: "14.366" },
          systems: [{ id: "pf2e", compatibility: { minimum: "8.4.1", verified: "8.4.1" } }],
        },
      },
    };
    expect(qualifiedEvidenceDocument(base)).toMatchObject({
      schemaVersion: 1,
      evidenceSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(() =>
      qualifiedEvidenceDocument({
        ...base,
        wf51: { runtime: { ...base.wf51.runtime, pf2eVersion: "8.4.0" } },
      })
    ).toThrow(/advertised verified/i);
    expect(() =>
      qualifiedEvidenceDocument({
        ...base,
        packageEvidence: {
          module: {
            ...base.packageEvidence.module,
            systems: [{ id: "pf2e", compatibility: { minimum: "8.1.0", verified: "8.4.1" } }],
          },
        },
      })
    ).toThrow(/minimum compatibility remains unqualified/i);
  });

  it("requires a clean exact candidate through a durable named branch or tag ref", async () => {
    const root = await temporaryRoot("wf52-git-");
    execFileSync("git", ["init", "-b", "release"], { cwd: root, stdio: "pipe" });
    await writeFile(join(root, "tracked.txt"), "tracked\n");
    execFileSync("git", ["add", "tracked.txt"], { cwd: root });
    execFileSync(
      "git",
      ["-c", "user.name=Wayfinder Test", "-c", "user.email=test@example.invalid", "commit", "-m", "test"],
      { cwd: root, stdio: "pipe" }
    );
    const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    await expect(captureExactCandidate({ repoRoot: root, ref: "release" })).resolves.toMatchObject({
      gitSha,
      ref: "refs/heads/release",
      resolvedRefSha: gitSha,
      dirtyPaths: [],
    });
    await expect(captureExactCandidate({ repoRoot: root, ref: gitSha })).rejects.toThrow(/does not resolve/i);
    await writeFile(join(root, "dirty.txt"), "dirty\n");
    await expect(captureExactCandidate({ repoRoot: root, ref: "release" })).rejects.toThrow(/clean candidate/i);
  });

  it("exposes an explicit package script that requires WF51 evidence and an exact ref", async () => {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));
    expect(packageJson.scripts["package:qualified"]).toBe("node tools/release/prepare-qualified-package.mjs");
    const wrapper = await readFile(resolve("tools/release/prepare-qualified-package.mjs"), "utf8");
    expect(wrapper).toContain("--wf51 <coordinator-artifact-directory>");
    expect(wrapper).toContain("--ref <exact-candidate-ref>");
    expect(wrapper).toContain("assertGeneratedScriptsCurrent");
    expect(wrapper).toContain("tools/starting-equipment/generate-character-wealth.mjs");
    expect(wrapper).toContain("tools/release/prepare-package.mjs");
  });
});

async function packageFixture() {
  const root = await temporaryRoot("wf52-package-");
  const version = "0.8.0";
  const tag = "v0.8.0";
  const repository = "bestlux/wayfinder";
  const sourceManifest = {
    id: "wayfinder-pf2e",
    version,
    esmodules: ["scripts/wayfinder.js"],
    styles: [{ src: "styles/wayfinder.css" }],
    languages: [{ lang: "en", path: "lang/en.json" }],
    compatibility: { minimum: "14", verified: "14.366" },
    relationships: {
      systems: [{ id: "pf2e", type: "system", compatibility: { minimum: "8.4.1", verified: "8.4.1" } }],
    },
    url: `https://github.com/${repository}`,
    readme: `https://github.com/${repository}#readme`,
    bugs: `https://github.com/${repository}/issues`,
  };
  const releaseManifest = buildReleaseManifest(sourceManifest, { repo: repository, tag, version });
  const outputRoot = join(root, "dist/qualified");
  const packageRoot = join(outputRoot, "package");
  const contents: Record<string, Buffer> = {
    "LEGAL.md": Buffer.from("legal"),
    "LICENSE.md": Buffer.from("license"),
    "assets/wayfinder-entry.svg": Buffer.from("svg"),
    "lang/en.json": Buffer.from("{}"),
    "licenses/OPEN-GAME-LICENSE-1.0A.md": Buffer.from("ogl"),
    "licenses/ORC-NOTICE.md": Buffer.from("orc"),
    "licenses/THIRD-PARTY-NOTICES.md": Buffer.from("third"),
    "module.json": Buffer.from(`${JSON.stringify(releaseManifest, null, 2)}\n`),
    "scripts/wayfinder.js": Buffer.from("export {};\n"),
    "styles/wayfinder.css": Buffer.from(".wayfinder {}\n"),
    "templates/wayfinder-app.hbs": Buffer.from("<main></main>\n"),
  };
  const entries = Object.entries(contents).sort(([left], [right]) => left.localeCompare(right));
  for (const [entryPath, bytes] of entries) {
    const target = join(packageRoot, entryPath);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, bytes);
    if (entryPath !== "module.json") {
      const source = join(root, entryPath);
      await mkdir(join(source, ".."), { recursive: true });
      await writeFile(source, bytes);
    }
  }
  const zip = storedZip(entries);
  await mkdir(outputRoot, { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({ version })}\n`);
  await writeFile(join(root, "module.json"), `${JSON.stringify(sourceManifest, null, 2)}\n`);
  await writeFile(join(root, ".gitignore"), "dist/\n");
  await writeFile(join(outputRoot, "module.json"), `${JSON.stringify(releaseManifest, null, 2)}\n`);
  await writeFile(join(outputRoot, "module.zip"), zip);
  await writeFile(
    join(outputRoot, "package-manifest.json"),
    `${JSON.stringify({
      id: sourceManifest.id,
      version,
      tag,
      repository,
      manifest: releaseManifest.manifest,
      download: releaseManifest.download,
      output: { manifest: "dist/qualified/module.json", zip: "dist/qualified/module.zip" },
      zipSha256: sha256(zip),
      entries: entries.map(([entryPath]) => entryPath),
    })}\n`
  );
  execFileSync("git", ["init", "-b", "release"], { cwd: root, stdio: "pipe" });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
  execFileSync(
    "git",
    [
      "add",
      "--",
      ".gitignore",
      "package.json",
      "module.json",
      "LEGAL.md",
      "LICENSE.md",
      "assets",
      "lang",
      "licenses",
      "scripts",
      "styles",
      "templates",
    ],
    { cwd: root }
  );
  execFileSync(
    "git",
    ["-c", "user.name=Wayfinder Test", "-c", "user.email=test@example.invalid", "commit", "-m", "candidate"],
    { cwd: root, stdio: "pipe" }
  );
  const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  return { root, version, tag, repository, entries, zip, gitSha };
}

async function wf51Fixture() {
  const root = await temporaryRoot("wf52-wf51-");
  const artifactRoot = join(root, ".wayfinder-smoke/wf51-release-coordinator-evidence-1");
  const finalRoot = join(artifactRoot, "final");
  const gitSha = "a".repeat(40);
  await mkdir(join(root, "scripts"), { recursive: true });
  await writeFile(join(root, "module.json"), "{}\n");
  await writeFile(join(root, "scripts/wayfinder.js"), "export {};\n");
  const localModuleFiles = await Promise.all(
    ["module.json", "scripts/wayfinder.js"].map(async (path) => {
      const bytes = await readFile(join(root, path));
      return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
    })
  );
  const servedModuleFiles = localModuleFiles;
  const servedScriptManifestSha256 = sha256(
    canonicalJson(servedModuleFiles.filter((entry) => entry.path.endsWith(".js")))
  );
  const ids = [
    "matrix-baseline",
    "matrix-incremental",
    "matrix-free-archetype",
    "matrix-ancestry-paragon",
    "matrix-gradual-boosts",
    "matrix-apply-safety",
    "acquisition",
    "wave3",
    "wave4",
    "experience",
    "focused",
  ];
  const childData = [];
  for (const id of ids) {
    const childRoot = join(artifactRoot, id);
    await mkdir(childRoot, { recursive: true });
    childData.push({ id, childRoot });
  }
  const provisionalChildren = childData.slice(0, -1).map(({ id, childRoot }) => ({
    id,
    startedAt: "2026-08-21T00:00:00.000Z",
    finishedAt: "2026-08-21T00:01:00.000Z",
    exitCode: 0,
    candidateSha: gitSha,
    resultPath: join(childRoot, `${id}.json`),
    resultSha256: "",
    stdoutSha256: sha256(`${id} stdout\n`),
    stderrSha256: sha256(""),
    candidateDrift: false,
  }));
  const coordinatorManifest = {
    schemaVersion: 1,
    runId: "run-1",
    candidateSha: gitSha,
    children: provisionalChildren,
    actorIds: ["actor-1"],
  };
  const childResults = new Map<string, Buffer>();
  for (const child of provisionalChildren) {
    const bytes = Buffer.from(`${JSON.stringify({ id: child.id, status: "pass" })}\n`);
    child.resultSha256 = sha256(bytes);
    childResults.set(child.id, bytes);
  }
  coordinatorManifest.children = provisionalChildren;
  const coordinatorManifestBytes = Buffer.from(`${JSON.stringify(coordinatorManifest, null, 2)}\n`);
  const focusedRoot = childData.at(-1)!.childRoot;
  const focusedResultBytes = Buffer.from(
    `${JSON.stringify({
      id: "focused",
      status: "complete",
      coordinator: { manifestSha256: sha256(coordinatorManifestBytes) },
    })}\n`
  );
  const focused = {
    id: "focused",
    startedAt: "2026-08-21T00:00:00.000Z",
    finishedAt: "2026-08-21T00:01:00.000Z",
    exitCode: 0,
    candidateSha: gitSha,
    resultPath: join(focusedRoot, "focused.json"),
    resultSha256: sha256(focusedResultBytes),
    stdoutSha256: sha256("focused stdout\n"),
    stderrSha256: sha256(""),
    candidateDrift: false,
  };
  const children = [...provisionalChildren, focused];
  for (const child of children) {
    const childRoot = join(artifactRoot, child.id);
    await writeFile(child.resultPath, child.id === "focused" ? focusedResultBytes : childResults.get(child.id)!);
    await writeFile(join(childRoot, "coordinator-stdout.log"), `${child.id} stdout\n`);
    await writeFile(join(childRoot, "coordinator-stderr.log"), "");
  }
  await writeFile(join(artifactRoot, "wf51-focused-coordinator-manifest.json"), coordinatorManifestBytes);
  const result = {
    schemaVersion: 1,
    evidenceId: "evidence-1",
    runId: "run-1",
    status: "complete",
    stage: "qualified",
    startedAt: "2026-08-21T00:00:00.000Z",
    finishedAt: "2026-08-21T00:02:00.000Z",
    runtime: { foundryVersion: "14.366", pf2eVersion: "8.4.1", moduleVersion: "0.8.0", worldId: "testing-world" },
    candidate: {
      gitSha,
      dirtyPaths: [],
      localModuleFiles,
      servedModuleFiles,
      servedScriptManifestSha256,
    },
    coordinator: { candidateSha: gitSha, children },
    overlay: [],
    error: null,
    qualification: { ok: true, failures: [] },
  };
  const resultBytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`);
  const summaryBytes = Buffer.from("# qualified\n");
  const completion = {
    schemaVersion: 1,
    evidenceId: result.evidenceId,
    qualified: true,
    candidateSha: gitSha,
    servedScriptManifestSha256,
    resultSha256: sha256(resultBytes),
    summarySha256: sha256(summaryBytes),
  };
  const state = {
    schemaVersion: 1,
    evidenceId: result.evidenceId,
    runId: result.runId,
    candidateSha: gitSha,
    status: "complete",
    children,
    error: null,
    qualification: { ok: true, failures: [] },
  };
  await mkdir(finalRoot, { recursive: true });
  await writeFile(join(artifactRoot, "wf51-release-coordinator-state.json"), `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(join(finalRoot, "wf51-release-overlay-results.json"), resultBytes);
  await writeFile(join(finalRoot, "wf51-release-overlay-summary.md"), summaryBytes);
  await writeFile(join(finalRoot, "wf51-release-overlay-completion.json"), `${JSON.stringify(completion, null, 2)}\n`);
  await writeFile(join(finalRoot, ".wf51-release-overlay.lock"), `${result.evidenceId}\n`);
  return { root, artifactRoot, gitSha };
}

function storedZip(entries: [string, Buffer][]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [entryPath, data] of entries) {
    const name = Buffer.from(entryPath);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, name, data);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(centralDirectory.length, 12);
  footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, footer]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
