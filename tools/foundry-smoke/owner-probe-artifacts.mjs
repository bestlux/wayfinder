import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export async function createExclusiveOwnerProbeArtifactDirectory(
  repoRoot,
  requestedPath,
  evidenceId,
  date = new Date(),
) {
  const relativePath =
    requestedPath ||
    path.join(
      ".wayfinder-smoke",
      `owner-probe-${normalizedTimestamp(date)}-${evidenceId}`,
    );
  const outDir = path.resolve(repoRoot, relativePath);
  await mkdir(path.dirname(outDir), { recursive: true });
  await mkdir(outDir, { recursive: false });
  return outDir;
}

export async function writeOwnerProbeArtifacts(outDir, result, markdown) {
  await writeFile(path.join(outDir, ".owner-probe-publish.lock"), `${result.evidenceId}\n`, {
    flag: "wx",
  });
  const resultBytes = `${JSON.stringify(result, null, 2)}\n`;
  const markdownBytes = markdown;
  const completion = {
    schemaVersion: 1,
    evidenceId: result.evidenceId,
    qualified: result.qualification.passed,
    resultSha256: sha256(resultBytes),
    summarySha256: sha256(markdownBytes),
  };
  const files = [
    ["owner-probe-results.json", resultBytes],
    ["owner-probe-summary.md", markdownBytes],
    ["owner-probe-completion.json", `${JSON.stringify(completion, null, 2)}\n`],
  ];
  const temporaryFiles = [];
  for (const [name, contents] of files) {
    const temporaryPath = path.join(outDir, `.${name}.tmp`);
    await writeFile(temporaryPath, contents, { flag: "wx" });
    temporaryFiles.push([temporaryPath, path.join(outDir, name)]);
  }
  for (const [temporaryPath, finalPath] of temporaryFiles) {
    await rename(temporaryPath, finalPath);
  }
  return completion;
}

function normalizedTimestamp(date) {
  return date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/u, "Z");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
