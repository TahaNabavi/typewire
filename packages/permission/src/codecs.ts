import type { Compiled } from "./compile";
import type { Codec, Encoded } from "./types";

/* ============================================================================
 * bigint ⇄ bytes ⇄ base64url — pure, no Buffer/btoa, so it runs on any runtime
 * ========================================================================== */

const B64URL =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64URL_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64URL.length; i++) B64URL_LOOKUP[B64URL[i] as string] = i;

function bigintToBytesBE(value: bigint): number[] {
  if (value < 0n) throw new Error("[type-permission] cannot encode a negative bitfield");
  const out: number[] = [];
  let x = value;
  while (x > 0n) {
    out.push(Number(x & 0xffn));
    x >>= 8n;
  }
  out.reverse();
  return out;
}

function bytesBEToBigint(bytes: number[]): bigint {
  let v = 0n;
  for (const byte of bytes) v = (v << 8n) | BigInt(byte & 0xff);
  return v;
}

function bytesToB64url(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] as number;
    const b1 = i + 1 < bytes.length ? (bytes[i + 1] as number) : undefined;
    const b2 = i + 2 < bytes.length ? (bytes[i + 2] as number) : undefined;
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64URL[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64URL[b2 & 0x3f];
  }
  return out;
}

function b64urlToBytes(s: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const c0 = B64URL_LOOKUP[s[i] as string];
    const c1 = B64URL_LOOKUP[s[i + 1] as string];
    if (c0 === undefined || c1 === undefined) {
      throw new Error("[type-permission] invalid base64url input");
    }
    bytes.push((c0 << 2) | (c1 >> 4));
    const c2 = s[i + 2] !== undefined ? B64URL_LOOKUP[s[i + 2] as string] : undefined;
    if (c2 === undefined) break;
    bytes.push(((c1 & 0x0f) << 4) | (c2 >> 2));
    const c3 = s[i + 3] !== undefined ? B64URL_LOOKUP[s[i + 3] as string] : undefined;
    if (c3 === undefined) break;
    bytes.push(((c2 & 0x03) << 6) | c3);
  }
  return bytes;
}

/* ============================================================================
 * names / grouped — human-readable, lossy for unknown bits by nature
 * ========================================================================== */

function toNames(compiled: Compiled, perms: bigint): string[] {
  const out: string[] = [];
  for (const flag of compiled.byName.values()) {
    if ((perms & flag.mask) !== 0n) out.push(flag.name);
  }
  return out;
}

function fromNames(compiled: Compiled, names: string[]): bigint {
  let perms = 0n;
  for (const name of names) {
    const flag = compiled.byName.get(name);
    if (flag) perms |= flag.mask; // unknown names are ignored, never fatal
  }
  return perms;
}

function toGrouped(compiled: Compiled, perms: bigint): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const flag of compiled.byName.values()) {
    if ((perms & flag.mask) === 0n) continue;
    (out[flag.module] ??= []).push(flag.member);
  }
  return out;
}

function fromGrouped(
  compiled: Compiled,
  grouped: Record<string, string[]>,
): bigint {
  let perms = 0n;
  for (const module of Object.keys(grouped)) {
    for (const member of grouped[module] ?? []) {
      const flag = compiled.byName.get(`${module}.${member}`);
      if (flag) perms |= flag.mask;
    }
  }
  return perms;
}

/* ============================================================================
 * encode / decode
 * ========================================================================== */

/**
 * Serialize a bitfield for an IO boundary. The runtime value stays `bigint`;
 * this is purely a representation. Binary codecs (`decimal`/`hex`/`base64url`/
 * `chunks`) are lossless — they carry unknown bits through; `names`/`grouped`
 * are lossy for unknown bits, as documented.
 */
export function encode<C extends Codec>(
  compiled: Compiled,
  perms: bigint,
  codec: C,
): Encoded[C] {
  switch (codec) {
    case "decimal":
      return perms.toString(10) as Encoded[C];
    case "hex":
      return `0x${perms.toString(16)}` as Encoded[C];
    case "base64url":
      return bytesToB64url(bigintToBytesBE(perms)) as Encoded[C];
    case "chunks": {
      const out: number[] = [];
      let x = perms;
      while (x > 0n) {
        out.push(Number(x & 0xffffffffn));
        x >>= 32n;
      }
      return out as Encoded[C];
    }
    case "names":
      return toNames(compiled, perms) as Encoded[C];
    case "grouped":
      return toGrouped(compiled, perms) as Encoded[C];
    default:
      throw new Error(`[type-permission] unknown codec "${String(codec)}"`);
  }
}

/** Parse an encoded value back to a `bigint`. */
export function decode<C extends Codec>(
  compiled: Compiled,
  value: Encoded[C],
  codec: C,
): bigint {
  switch (codec) {
    case "decimal":
      return BigInt(value as string);
    case "hex":
      return BigInt(value as string);
    case "base64url":
      return bytesBEToBigint(b64urlToBytes(value as string));
    case "chunks": {
      let perms = 0n;
      const chunks = value as number[];
      for (let i = 0; i < chunks.length; i++) {
        perms |= BigInt((chunks[i] as number) >>> 0) << BigInt(i * 32);
      }
      return perms;
    }
    case "names":
      return fromNames(compiled, value as string[]);
    case "grouped":
      return fromGrouped(compiled, value as Record<string, string[]>);
    default:
      throw new Error(`[type-permission] unknown codec "${String(codec)}"`);
  }
}
