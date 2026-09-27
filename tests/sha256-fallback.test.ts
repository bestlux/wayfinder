import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hash } from "../src/shared/vendor/fast-sha256";

const encoder = new TextEncoder();

describe("vendored SHA-256 fallback", () => {
  // Published SHA-256 known-answer vectors, independent of the differential oracle.
  it.each([
    {
      name: "empty input",
      input: "",
      expected: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
      name: "abc",
      input: "abc",
      expected: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    },
    {
      name: "two padded blocks",
      input: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      expected: "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    },
    {
      name: "multiple message blocks",
      input:
        "abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmno" +
        "ijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
      expected: "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
    },
    {
      name: "one million a characters",
      input: "a".repeat(1_000_000),
      expected: "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    },
  ])("matches the $name known answer", ({ input, expected }) => {
    expect(hex(hash(encoder.encode(input)))).toBe(expected);
  });

  it.each([
    0, 1, 7, 31, 55, 56, 57, 63, 64, 65, 119, 120, 121, 127, 128, 129, 255, 256, 257, 1024, 65_536,
  ])("matches Node SHA-256 for %i bytes and a nonzero-offset view", (length) => {
    const input = Uint8Array.from({ length }, (_, index) => (index * 73 + 19) & 0xff);
    const backing = new Uint8Array(length + 19).fill(0xa5);
    backing.set(input, 7);
    const view = backing.subarray(7, 7 + length);
    const original = backing.slice();
    const expected = createHash("sha256").update(input).digest("hex");

    expect(view.byteOffset).toBe(7);
    expect(hex(hash(input))).toBe(expected);
    expect(hex(hash(view))).toBe(expected);
    expect(backing).toEqual(original);
  });

  it.each([
    "矮人战士的起始装备",
    "Dwarf 🛡️ — 金币 15 gp",
    "é and e\u0301 remain different bytes",
    "\u0000\ud800unpaired surrogate\udfff",
  ])("matches UTF-8 encoded Unicode material %j", (input) => {
    const bytes = encoder.encode(input);
    expect(hex(hash(bytes))).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("returns independent 32-byte digests without retaining state between calls", () => {
    const first = hash(encoder.encode("abc"));
    const second = hash(encoder.encode("abc"));

    expect(first).toBeInstanceOf(Uint8Array);
    expect(first).toHaveLength(32);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    first.fill(0);
    expect(hex(second)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}
