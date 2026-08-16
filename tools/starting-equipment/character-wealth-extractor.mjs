import { createHash } from "node:crypto";

export const CHARACTER_WEALTH_GENERATOR_VERSION = 1;
export const CHARACTER_WEALTH_POLICY_VERSION = 1;
export const CHARACTER_WEALTH_SCHEMA_VERSION = 1;
export const CHARACTER_WEALTH_POLICY_ID = "pf2e-remaster-character-wealth";
export const PINNED_CHARACTER_WEALTH_DATA_DIGEST =
  "sha256:5132c172229b4e61e14e197f733a509b1b8869782f021102af878b6ea3e37b73";
export const PINNED_CHARACTER_WEALTH_FIXTURE_DIGEST =
  "sha256:4ff8c4ec3d73ce4da758f0ca055bf2f83cfb71fd7385185365e9275f085b6c72";

export const PINNED_CHARACTER_WEALTH_SOURCE = Object.freeze({
  pf2eVersion: "8.4.0",
  pf2eCommit: "90132e99cb2c7617e4f0131b6010c6ee6f8ec5b1",
  upstreamPath: "packs/pf2e/journals/gm-screen.json",
  journalId: "S55aqwWIzpQRFhcq",
  pageId: "Dae8LHdXZuBv06Jk",
  sourceDigest: "sha256:fb2f442ee26e834306cb886eb2d55d399cdc5b717ceab3a6f202e7af592bb463",
  tableDigest: "sha256:53307fd2c31195065f12d3d61d00f5a0b5cf5ccfd4e79a745c17785467a3104e",
});

export const CHARACTER_WEALTH_TABLE_IDENTITY = Object.freeze({
  heading: "Character Wealth",
  classTokens: ["pf2e", "remaster"],
  headers: ["Level", "Permanent Items", "Currency", "Lump Sum"],
  attribution: "Section: Running the Game Pathfinder GM Core pg. 59 and 61",
  book: "Pathfinder GM Core",
  journalPages: [59, 61],
  rulebookPage: 61,
});

const currencyMultipliers = Object.freeze({ cp: 1, sp: 10, gp: 100, pp: 1000 });

export function extractPinnedCharacterWealthFixture(fixture) {
  assertRecord(fixture, "Character Wealth fixture");
  assertExactKeys(
    fixture,
    ["fixtureKind", "rows", "schemaVersion", "source", "tableIdentity"],
    "Character Wealth fixture",
  );
  if (fixture.schemaVersion !== 1) {
    throw new Error("Character Wealth fixture schemaVersion must be 1.");
  }
  if (fixture.fixtureKind !== "pinned-pf2e-character-wealth-policy") {
    throw new Error("Character Wealth generation requires the pinned normalized PF2E fixture.");
  }
  assertExactSource(fixture.source);
  assertCapturedTableIdentity(fixture.tableIdentity);
  assertNormalizedCharacterWealthRows(fixture.rows);
  assertCharacterWealthCanaries(fixture.rows);
  const dataDigest = digest(characterWealthDataSha256(fixture.rows));
  if (dataDigest !== PINNED_CHARACTER_WEALTH_DATA_DIGEST) {
    throw new Error("Character Wealth fixture data digest does not match the reviewed table.");
  }
  return { rows: structuredClone(fixture.rows) };
}

export function extractCharacterWealthJournal(journal) {
  assertRecord(journal, "PF2E journal");
  if (journal._id !== PINNED_CHARACTER_WEALTH_SOURCE.journalId) {
    throw new Error(
      `Character Wealth journal id must be ${PINNED_CHARACTER_WEALTH_SOURCE.journalId}; received ${String(journal._id)}.`,
    );
  }
  if (!Array.isArray(journal.pages)) {
    throw new Error("Character Wealth journal pages must be an array.");
  }

  const pages = journal.pages.filter((page) => page?._id === PINNED_CHARACTER_WEALTH_SOURCE.pageId);
  if (pages.length !== 1) {
    throw new Error(
      `Character Wealth journal must contain exactly one page ${PINNED_CHARACTER_WEALTH_SOURCE.pageId}.`,
    );
  }
  const content = pages[0]?.text?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("Character Wealth page content must be a non-empty HTML string.");
  }

  const section = findCharacterWealthSection(content);
  const rows = parseCharacterWealthTable(section.tableHtml);
  assertNormalizedCharacterWealthRows(rows);

  return {
    sourceContentSha256: sha256(content),
    tableContentSha256: sha256(section.tableHtml),
    rows,
  };
}

export function parseCurrencyToCopper(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Currency must be a non-empty string.");
  }

  const normalized = normalizeText(value);
  const tokenPattern = /(\d{1,3}(?:,\d{3})*|\d+)\s*(cp|sp|gp|pp)\b/giu;
  const tokens = [];
  let cursor = 0;
  for (const match of normalized.matchAll(tokenPattern)) {
    const separator = normalized.slice(cursor, match.index);
    if (!validCurrencySeparator(separator, tokens.length === 0)) {
      throw new Error(`Currency contains unparsed residue near "${separator}".`);
    }
    const quantity = parseGroupedInteger(match[1], "currency quantity");
    const denomination = match[2].toLowerCase();
    tokens.push({ denomination, quantity });
    cursor = (match.index ?? 0) + match[0].length;
  }

  const trailing = normalized.slice(cursor);
  if (tokens.length === 0 || !validCurrencySeparator(trailing, false, true)) {
    throw new Error(`Currency contains unparsed residue near "${trailing || normalized}".`);
  }

  let copper = 0;
  const seen = new Set();
  for (const token of tokens) {
    if (seen.has(token.denomination)) {
      throw new Error(`Currency repeats denomination ${token.denomination}.`);
    }
    seen.add(token.denomination);
    copper = addSafeInteger(copper, token.quantity * currencyMultipliers[token.denomination], "currency copper");
  }
  return copper;
}

export function parsePermanentItemAllowances(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Permanent-item allowances must be a non-empty string.");
  }
  const normalized = normalizeText(value);
  if (normalized === "-") return [];

  const parts = normalized.split(",").map((part) => part.trim());
  if (parts.some((part) => part.length === 0)) {
    throw new Error("Permanent-item allowances contain an empty bucket.");
  }

  const allowances = [];
  const seenLevels = new Set();
  for (const part of parts) {
    const match = /^(\d+)(st|nd|rd|th)\s*:\s*(\d+)$/u.exec(part);
    if (!match) {
      throw new Error(`Permanent-item allowance contains unparsed residue: "${part}".`);
    }
    const itemLevel = parseSafeInteger(match[1], "permanent item level");
    const count = parseSafeInteger(match[3], "permanent item count");
    if (itemLevel < 1 || itemLevel > 20 || count < 1) {
      throw new Error("Permanent-item allowance levels must be 1-20 and counts must be positive.");
    }
    if (match[2] !== ordinalSuffix(itemLevel)) {
      throw new Error(`Permanent-item allowance has the wrong ordinal suffix for level ${itemLevel}.`);
    }
    if (seenLevels.has(itemLevel)) {
      throw new Error(`Permanent-item allowance repeats level ${itemLevel}.`);
    }
    if (allowances.at(-1)?.itemLevel <= itemLevel) {
      throw new Error("Permanent-item allowance buckets must be ordered from highest to lowest level.");
    }
    seenLevels.add(itemLevel);
    allowances.push({ itemLevel, count });
  }
  return allowances;
}

export function characterWealthDataSha256(rows) {
  return sha256(canonicalJson(rows));
}

export function artifactCharacterWealthSha256(policyWithoutArtifactDigest) {
  return sha256(canonicalJson(policyWithoutArtifactDigest));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function digest(sha256Value) {
  if (!/^[0-9a-f]{64}$/u.test(sha256Value)) {
    throw new Error("A SHA-256 digest must contain exactly 64 lowercase hexadecimal characters.");
  }
  return `sha256:${sha256Value}`;
}

export function selectCharacterWealthSourceFragment(content) {
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("Character Wealth source content must be a non-empty HTML string.");
  }
  return findCharacterWealthSection(content);
}

function assertExactSource(source) {
  assertRecord(source, "Character Wealth fixture source");
  assertExactKeys(source, Object.keys(PINNED_CHARACTER_WEALTH_SOURCE), "Character Wealth fixture source");
  for (const [key, expected] of Object.entries(PINNED_CHARACTER_WEALTH_SOURCE)) {
    if (source[key] !== expected) {
      throw new Error(`Character Wealth fixture source ${key} must be ${expected}.`);
    }
  }
}

function assertCapturedTableIdentity(identity) {
  assertRecord(identity, "Character Wealth fixture table identity");
  assertExactKeys(
    identity,
    ["attribution", "classTokens", "headers", "heading"],
    "Character Wealth fixture table identity",
  );
  const expected = {
    heading: CHARACTER_WEALTH_TABLE_IDENTITY.heading,
    classTokens: CHARACTER_WEALTH_TABLE_IDENTITY.classTokens,
    headers: CHARACTER_WEALTH_TABLE_IDENTITY.headers,
    attribution: {
      journalFooter: CHARACTER_WEALTH_TABLE_IDENTITY.attribution,
      book: CHARACTER_WEALTH_TABLE_IDENTITY.book,
      journalPages: CHARACTER_WEALTH_TABLE_IDENTITY.journalPages,
      rulebookPage: CHARACTER_WEALTH_TABLE_IDENTITY.rulebookPage,
    },
  };
  if (canonicalJson(identity) !== canonicalJson(expected)) {
    throw new Error("Character Wealth fixture table identity does not match the reviewed source.");
  }
}

function assertNormalizedCharacterWealthRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 20) {
    throw new Error(`Character Wealth table must contain exactly 20 rows; received ${rows?.length ?? "none"}.`);
  }
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    assertRecord(row, `Character Wealth row ${index + 1}`);
    assertExactKeys(
      row,
      ["characterLevel", "lumpSumCopper", "permanentItemAllowances", "permanentRecipeCurrencyCopper"],
      `Character Wealth row ${index + 1}`,
    );
    if (row.characterLevel !== index + 1) {
      throw new Error(`Character Wealth levels must be unique and ordered 1-20; row ${index + 1} is invalid.`);
    }
    for (const value of [row.permanentRecipeCurrencyCopper, row.lumpSumCopper]) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error("Character Wealth currency values must be nonnegative safe integers.");
      }
    }
    if (!Array.isArray(row.permanentItemAllowances)) {
      throw new Error("Character Wealth permanent-item allowances must be an array.");
    }
    let previousLevel = Number.POSITIVE_INFINITY;
    const seen = new Set();
    for (const allowance of row.permanentItemAllowances) {
      assertRecord(allowance, "Character Wealth permanent-item allowance");
      assertExactKeys(allowance, ["count", "itemLevel"], "Character Wealth permanent-item allowance");
      if (
        !Number.isSafeInteger(allowance.itemLevel) ||
        !Number.isSafeInteger(allowance.count) ||
        allowance.itemLevel < 1 ||
        allowance.itemLevel >= row.characterLevel ||
        allowance.count < 1 ||
        allowance.itemLevel >= previousLevel ||
        seen.has(allowance.itemLevel)
      ) {
        throw new Error("Character Wealth permanent-item allowances are invalid or out of order.");
      }
      seen.add(allowance.itemLevel);
      previousLevel = allowance.itemLevel;
    }
  }
}

function findCharacterWealthSection(content) {
  const headings = [...content.matchAll(/<h2(?=[\t\n\f\r >])[^>]*>([\s\S]*?)<\/h2[\t\n\f\r ]*>/giu)];
  const matches = headings.filter((match) => normalizeMarkupText(match[1]) === CHARACTER_WEALTH_TABLE_IDENTITY.heading);
  if (matches.length !== 1) {
    throw new Error('PF2E journal page must contain exactly one normalized "Character Wealth" h2 heading.');
  }

  const heading = matches[0];
  const sectionStart = (heading.index ?? 0) + heading[0].length;
  const nextHeading = headings.find((candidate) => (candidate.index ?? 0) >= sectionStart);
  const sectionEnd = nextHeading?.index ?? content.length;
  const sectionHtml = content.slice(sectionStart, sectionEnd);
  const tables = [
    ...sectionHtml.matchAll(/<table(?=[\t\n\f\r >])[^>]*>[\s\S]*?<\/table[\t\n\f\r ]*>/giu),
  ];
  if (tables.length !== 1) {
    throw new Error("Character Wealth heading must be followed by exactly one table in its section.");
  }

  const tableHtml = tables[0][0];
  const leadingContent = normalizeMarkupText(sectionHtml.slice(0, tables[0].index ?? 0));
  if (leadingContent.length !== 0) {
    throw new Error("Character Wealth heading must be followed immediately by its table.");
  }
  const tableEnd = (tables[0].index ?? 0) + tableHtml.length;
  const attribution = normalizeMarkupText(sectionHtml.slice(tableEnd));
  if (attribution !== CHARACTER_WEALTH_TABLE_IDENTITY.attribution) {
    throw new Error(
      `Character Wealth attribution must be exactly "${CHARACTER_WEALTH_TABLE_IDENTITY.attribution}".`,
    );
  }
  return {
    fragmentHtml: content.slice(heading.index ?? 0, sectionEnd),
    tableHtml,
  };
}

function parseCharacterWealthTable(tableHtml) {
  const table = /^<table(?=[\t\n\f\r >])([^>]*)>([\s\S]*)<\/table[\t\n\f\r ]*>$/iu.exec(tableHtml);
  if (!table) throw new Error("Character Wealth table markup is malformed.");
  const classValue = attributeValue(table[1], "class");
  const classTokens = new Set(classValue.split(/[\t\n\f\r ]+/u).filter(Boolean));
  for (const token of CHARACTER_WEALTH_TABLE_IDENTITY.classTokens) {
    if (!classTokens.has(token)) {
      throw new Error(`Character Wealth table must contain class token ${token}.`);
    }
  }

  const tableBody = table[2];
  const theadMatch = singleTagMatch(tableBody, "thead", "Character Wealth table");
  const tbodyMatch = singleTagMatch(tableBody, "tbody", "Character Wealth table");
  const theadEnd = (theadMatch.index ?? 0) + theadMatch[0].length;
  const tbodyEnd = (tbodyMatch.index ?? 0) + tbodyMatch[0].length;
  if (
    (theadMatch.index ?? 0) >= (tbodyMatch.index ?? 0) ||
    tableBody.slice(0, theadMatch.index ?? 0).trim().length !== 0 ||
    tableBody.slice(theadEnd, tbodyMatch.index ?? 0).trim().length !== 0 ||
    tableBody.slice(tbodyEnd).trim().length !== 0
  ) {
    throw new Error("Character Wealth table must contain only one thead followed by one tbody.");
  }

  const thead = theadMatch[1];
  const headerRows = tagMatches(thead, "tr");
  if (headerRows.length !== 1) throw new Error("Character Wealth table must contain exactly one header row.");
  assertOnlyTagSequence(thead, headerRows, "Character Wealth table header");
  const headerCells = tagMatches(headerRows[0][1], "th");
  assertOnlyTagSequence(headerRows[0][1], headerCells, "Character Wealth table header row");
  assertNoCellSpans(headerCells, "Character Wealth table header");
  const headers = headerCells.map((match) => normalizeMarkupText(match[1]));
  if (JSON.stringify(headers) !== JSON.stringify(CHARACTER_WEALTH_TABLE_IDENTITY.headers)) {
    throw new Error(
      `Character Wealth headers must be exactly ${CHARACTER_WEALTH_TABLE_IDENTITY.headers.join(", ")}.`,
    );
  }

  const tbody = tbodyMatch[1];
  const rowMatches = tagMatches(tbody, "tr");
  if (rowMatches.length !== 20) {
    throw new Error(`Character Wealth table must contain exactly 20 rows; received ${rowMatches.length}.`);
  }
  assertOnlyTagSequence(tbody, rowMatches, "Character Wealth table body");

  const rows = rowMatches.map((row, index) => {
    const cellMatches = tagMatches(row[1], "td");
    if (cellMatches.length !== 4) {
      throw new Error(`Character Wealth row ${index + 1} must contain exactly 4 cells.`);
    }
    assertOnlyTagSequence(row[1], cellMatches, `Character Wealth row ${index + 1}`);
    assertNoCellSpans(cellMatches, `Character Wealth row ${index + 1}`);
    const cells = cellMatches.map((match) => normalizeMarkupText(match[1]));
    const characterLevel = parseSafeInteger(cells[0], "character level");
    if (characterLevel !== index + 1) {
      throw new Error(
        `Character Wealth levels must be unique and ordered 1-20; row ${index + 1} is ${characterLevel}.`,
      );
    }
    const permanentItemAllowances = parsePermanentItemAllowances(cells[1]);
    if (characterLevel === 1 && permanentItemAllowances.length !== 0) {
      throw new Error("Character Wealth level 1 must not include permanent-item allowances.");
    }
    if (permanentItemAllowances.some((allowance) => allowance.itemLevel >= characterLevel)) {
      throw new Error(
        `Character Wealth level ${characterLevel} contains an allowance that is not below character level.`,
      );
    }
    return {
      characterLevel,
      permanentItemAllowances,
      permanentRecipeCurrencyCopper: parseCurrencyToCopper(cells[2]),
      lumpSumCopper: parseCurrencyToCopper(cells[3]),
    };
  });
  return rows;
}

function assertCharacterWealthCanaries(rows) {
  const level1 = rows[0];
  if (
    level1?.characterLevel !== 1 ||
    level1.permanentItemAllowances.length !== 0 ||
    level1.permanentRecipeCurrencyCopper !== 1500 ||
    level1.lumpSumCopper !== 1500
  ) {
    throw new Error("Character Wealth level-1 canary must be no allowances, 15 gp currency, and 15 gp lump sum.");
  }

  const level5 = rows[4];
  const expectedAllowances = [
    { itemLevel: 4, count: 1 },
    { itemLevel: 3, count: 2 },
    { itemLevel: 2, count: 1 },
    { itemLevel: 1, count: 2 },
  ];
  if (
    level5?.characterLevel !== 5 ||
    JSON.stringify(level5.permanentItemAllowances) !== JSON.stringify(expectedAllowances) ||
    level5.permanentRecipeCurrencyCopper !== 5000 ||
    level5.lumpSumCopper !== 27000
  ) {
    throw new Error(
      "Character Wealth level-5 canary must be 4th×1, 3rd×2, 2nd×1, 1st×2, 50 gp, and 270 gp.",
    );
  }

  const level20 = rows[19];
  const expectedLevel20Allowances = [
    { itemLevel: 19, count: 1 },
    { itemLevel: 18, count: 2 },
    { itemLevel: 17, count: 1 },
    { itemLevel: 16, count: 2 },
  ];
  if (
    level20?.characterLevel !== 20 ||
    JSON.stringify(level20.permanentItemAllowances) !== JSON.stringify(expectedLevel20Allowances) ||
    level20.permanentRecipeCurrencyCopper !== 2_000_000 ||
    level20.lumpSumCopper !== 11_200_000
  ) {
    throw new Error(
      "Character Wealth level-20 canary must be 19th×1, 18th×2, 17th×1, 16th×2, 20,000 gp, and 112,000 gp.",
    );
  }
}

function singleTagMatch(html, tagName, label) {
  const matches = tagMatches(html, tagName);
  if (matches.length !== 1) throw new Error(`${label} must contain exactly one ${tagName}.`);
  return matches[0];
}

function tagMatches(html, tagName) {
  const pattern = new RegExp(
    `<${tagName}(?=[\\t\\n\\f\\r >])[^>]*>([\\s\\S]*?)<\\/${tagName}[\\t\\n\\f\\r ]*>`,
    "giu",
  );
  return [...html.matchAll(pattern)];
}

function assertOnlyTagSequence(html, matches, label) {
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    if (html.slice(cursor, index).trim().length !== 0) {
      throw new Error(`${label} contains content outside its expected elements.`);
    }
    cursor = index + match[0].length;
  }
  if (html.slice(cursor).trim().length !== 0) {
    throw new Error(`${label} contains content outside its expected elements.`);
  }
}

function assertNoCellSpans(matches, label) {
  for (const match of matches) {
    const openingTag = /^<t[hd](?=[\t\n\f\r >])([^>]*)>/iu.exec(match[0]);
    if (openingTag && /(?:^|[\t\n\f\r ])\/[^\t\n\f\r >]/u.test(openingTag[1])) {
      throw new Error(`${label} contains malformed cell attributes.`);
    }
    if (
      openingTag &&
      /(?:^|[\t\n\f\r ])(?:colspan|rowspan)(?:[\t\n\f\r ]|=|$)/iu.test(openingTag[1])
    ) {
      throw new Error(`${label} must not use row or column spans.`);
    }
  }
}

function attributeValue(attributes, attributeName) {
  const pattern = new RegExp(
    `(?:^|[\\t\\n\\f\\r ])${attributeName}[\\t\\n\\f\\r ]*=[\\t\\n\\f\\r ]*(["'])(.*?)\\1`,
    "iu",
  );
  return pattern.exec(attributes)?.[2] ?? "";
}

function normalizeMarkupText(value) {
  return normalizeText(
    decodeHtmlEntities(value.replace(/<\/?[a-z][a-z0-9-]*(?=[\t\n\f\r />])[^>]*>/giu, " ")),
  );
}

function normalizeText(value) {
  return value.replace(/\u00a0/gu, " ").replace(/\s+/gu, " ").trim();
}

function decodeHtmlEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#(\d+);/gu, (_match, digits) => String.fromCodePoint(Number.parseInt(digits, 10)))
    .replace(/&(amp|apos|gt|lt|nbsp|quot);/giu, (_match, name) => named[name.toLowerCase()]);
}

function validCurrencySeparator(value, first, trailing = false) {
  if (first || trailing) return value.trim().length === 0;
  return /^(?:\s*,\s*|\s+and\s+)$/iu.test(value);
}

function parseGroupedInteger(value, label) {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/u.test(value)) {
    throw new Error(`${label} is malformed.`);
  }
  return parseSafeInteger(value.replaceAll(",", ""), label);
}

function parseSafeInteger(value, label) {
  if (!/^\d+$/u.test(value)) throw new Error(`${label} must be an unsigned integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} must be a safe integer.`);
  return parsed;
}

function addSafeInteger(left, right, label) {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds the safe integer range.`);
  return result;
}

function ordinalSuffix(value) {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "th";
  if (value % 10 === 1) return "st";
  if (value % 10 === 2) return "nd";
  if (value % 10 === 3) return "rd";
  return "th";
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} must contain exactly ${expected.join(", ")}.`);
  }
}
