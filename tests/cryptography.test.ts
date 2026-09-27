import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { secureRandomUuid, sha256Hex } from "../src/shared/cryptography";
import { mintAcquisitionIdentitySeed, mintAcquisitionLineId } from "../src/wayfinder/domain/acquisition-identity";

afterEach(() => vi.unstubAllGlobals());

describe("equipment cryptography capabilities", () => {
  it("uses native UUID generation with its Crypto receiver when available", () => {
    const crypto = {
      randomUUID() {
        expect(this).toBe(crypto);
        return "01234567-89ab-4cde-8f01-23456789abcd";
      },
      getRandomValues: vi.fn(),
    };
    vi.stubGlobal("crypto", crypto);
    expect(secureRandomUuid()).toBe("01234567-89ab-4cde-8f01-23456789abcd");
    expect(crypto.getRandomValues).not.toHaveBeenCalled();
  });

  it("sets UUID version and variant without discarding other random bits", () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, index) => index * 17);
    const crypto = {
      getRandomValues(target: Uint8Array) {
        expect(this).toBe(crypto);
        expect(target).toHaveLength(16);
        target.set(bytes);
        return target;
      },
    };
    vi.stubGlobal("crypto", crypto);
    expect(secureRandomUuid()).toBe("00112233-4455-4677-8899-aabbccddeeff");
    bytes.fill(255);
    expect(secureRandomUuid()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    bytes.fill(0);
    expect(secureRandomUuid()).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("mints independent seeds and line IDs with only secure random bytes available", () => {
    vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const values = Array.from({ length: 32 }, () => [
      ...Object.values(mintAcquisitionIdentitySeed()),
      mintAcquisitionLineId(),
    ]).flat();
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value).toMatch(
        /^wf-(draft|batch|manifest|line)-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
      );
    }
  });

  it.each([undefined, {}])("fails closed when no secure randomness is available (%j)", (crypto) => {
    vi.stubGlobal("crypto", crypto);
    expect(() => mintAcquisitionIdentitySeed()).toThrow("Secure acquisition identity generation is unavailable.");
    expect(() => mintAcquisitionLineId()).toThrow("Secure acquisition identity generation is unavailable.");
  });

  it("does not hide a native UUID failure behind the random-byte fallback", () => {
    const failure = new Error("native UUID failed");
    const getRandomValues = vi.fn();
    vi.stubGlobal("crypto", {
      randomUUID: () => {
        throw failure;
      },
      getRandomValues,
    });
    expect(() => secureRandomUuid()).toThrow(failure);
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it("propagates random-byte failure and still rejects duplicate identities", () => {
    const failure = new Error("entropy failed");
    vi.stubGlobal("crypto", {
      getRandomValues: () => {
        throw failure;
      },
    });
    expect(() => mintAcquisitionIdentitySeed()).toThrow(failure);
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes });
    expect(() => mintAcquisitionIdentitySeed()).toThrow("duplicate identities");
  });

  it("preserves the SHA-256 result without SubtleCrypto", async () => {
    const bytes = new TextEncoder().encode("Dwarf — Clan Dagger 🗡️");
    const native = await sha256Hex(bytes);
    vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    expect(await sha256Hex(bytes)).toBe(native);
  });

  it("preserves the SubtleCrypto receiver and propagates native digest rejection", async () => {
    const failure = new Error("native digest failed");
    const subtle = {
      async digest() {
        expect(this).toBe(subtle);
        throw failure;
      },
    };
    vi.stubGlobal("crypto", { subtle });
    await expect(sha256Hex(new Uint8Array())).rejects.toThrow(failure);
  });
});
