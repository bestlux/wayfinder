import { hash as sha256 } from "./vendor/fast-sha256.js";
/** UUIDv4 with the same cryptographic entropy on HTTPS and ordinary HTTP origins. */
export function secureRandomUuid() {
    const crypto = globalThis.crypto;
    if (typeof crypto?.randomUUID === "function")
        return crypto.randomUUID();
    if (typeof crypto?.getRandomValues !== "function") {
        throw new Error("Secure acquisition identity generation is unavailable.");
    }
    // RFC 9562 section 5.4: 122 random bits plus the UUID version and variant.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytesToHex(bytes);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
/** Preserve persisted SHA-256 identities when SubtleCrypto is unavailable on HTTP. */
export async function sha256Hex(bytes) {
    const subtle = globalThis.crypto?.subtle;
    // Only missing capabilities select a fallback; native failures must still propagate.
    const hash = typeof subtle?.digest === "function" ? new Uint8Array(await subtle.digest("SHA-256", bytes)) : sha256(bytes);
    return bytesToHex(hash);
}
function bytesToHex(bytes) {
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
//# sourceMappingURL=cryptography.js.map