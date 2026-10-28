/**
 * GPS coordinates stored in a JPEG's EXIF block — the place the photo was taken.
 * Canvas re-encoding drops this, so read it from the original file bytes.
 */

export function gpsFromJpeg(bytes: Uint8Array): { lat: number; lng: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return null;
    if (marker === 0xe1) {
      const start = i + 4;
      if (
        start + 6 <= bytes.length &&
        bytes[start] === 0x45 &&
        bytes[start + 1] === 0x78 &&
        bytes[start + 2] === 0x69 &&
        bytes[start + 3] === 0x66 &&
        bytes[start + 4] === 0 &&
        bytes[start + 5] === 0
      ) {
        const gps = gpsFromTiff(bytes, start + 6, i + 2 + len);
        if (gps) return gps;
      }
    }
    i += 2 + len;
  }
  return null;
}

function gpsFromTiff(bytes: Uint8Array, tiff: number, end: number): { lat: number; lng: number } | null {
  if (tiff + 8 > end) return null;
  const le = bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49;
  const be = bytes[tiff] === 0x4d && bytes[tiff + 1] === 0x4d;
  if (!le && !be) return null;

  const u16 = (o: number): number | null => {
    if (o < 0 || o + 2 > end) return null;
    return le ? bytes[o] | (bytes[o + 1] << 8) : (bytes[o] << 8) | bytes[o + 1];
  };
  const u32 = (o: number): number | null => {
    if (o < 0 || o + 4 > end) return null;
    const v = le
      ? bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)
      : (bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3];
    return v >>> 0;
  };

  if (u16(tiff + 2) !== 42) return null;
  const ifd0rel = u32(tiff + 4);
  if (ifd0rel == null) return null;

  const gpsRel = ifdPointer(bytes, tiff + ifd0rel, tiff, end, 0x8825, u16, u32);
  if (gpsRel == null) return null;
  const gpsIfd = tiff + gpsRel;

  const lat = rationals(bytes, gpsIfd, tiff, end, 0x0002, u16, u32);
  const lng = rationals(bytes, gpsIfd, tiff, end, 0x0004, u16, u32);
  if (!lat || !lng) return null;
  const latRef = asciiTag(bytes, gpsIfd, tiff, end, 0x0001, u16, u32);
  const lngRef = asciiTag(bytes, gpsIfd, tiff, end, 0x0003, u16, u32);

  const latitude = latRef === "S" ? -lat : lat;
  const longitude = lngRef === "W" ? -lng : lng;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { lat: latitude, lng: longitude };
}

type Read16 = (o: number) => number | null;
type Read32 = (o: number) => number | null;

function ifdPointer(
  bytes: Uint8Array,
  ifd: number,
  tiff: number,
  end: number,
  tag: number,
  u16: Read16,
  u32: Read32
): number | null {
  const entry = findEntry(ifd, end, tag, u16, u32);
  if (!entry || entry.type !== 4 || entry.count !== 1) return null;
  const rel = u32(entry.valueAt);
  if (rel == null || tiff + rel >= end) return null;
  return rel;
}

function rationals(
  bytes: Uint8Array,
  ifd: number,
  tiff: number,
  end: number,
  tag: number,
  u16: Read16,
  u32: Read32
): number | null {
  const entry = findEntry(ifd, end, tag, u16, u32);
  if (!entry || entry.type !== 5 || entry.count < 3) return null;
  const at = payloadAt(entry, tiff, end, u32);
  if (at < 0 || at + 24 > end) return null;
  const parts = [0, 1, 2].map((n) => {
    const num = u32(at + n * 8);
    const den = u32(at + n * 8 + 4);
    if (num == null || den == null || den === 0) return null;
    return num / den;
  });
  if (parts.some((p) => p == null)) return null;
  const [deg, min, sec] = parts as number[];
  return deg + min / 60 + sec / 3600;
}

function asciiTag(
  bytes: Uint8Array,
  ifd: number,
  tiff: number,
  end: number,
  tag: number,
  u16: Read16,
  u32: Read32
): string {
  const entry = findEntry(ifd, end, tag, u16, u32);
  if (!entry || entry.type !== 2 || entry.count < 1) return "";
  const at = payloadAt(entry, tiff, end, u32);
  if (at < 0) return "";
  let out = "";
  for (let n = 0; n < entry.count && at + n < end; n++) {
    const c = bytes[at + n];
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

function findEntry(ifd: number, end: number, tag: number, u16: Read16, u32: Read32) {
  const count = u16(ifd);
  if (count == null || count > 200) return null;
  for (let n = 0; n < count; n++) {
    const e = ifd + 2 + n * 12;
    if (e + 12 > end) return null;
    if (u16(e) !== tag) continue;
    const type = u16(e + 2);
    const entryCount = u32(e + 4);
    if (type == null || entryCount == null) return null;
    return { type, count: entryCount, valueAt: e + 8 };
  }
  return null;
}

function payloadAt(
  entry: { type: number; count: number; valueAt: number },
  tiff: number,
  end: number,
  u32: Read32
): number {
  const size = entry.type === 5 || entry.type === 10 ? 8 : entry.type === 3 || entry.type === 8 ? 2 : entry.type === 4 || entry.type === 9 ? 4 : 1;
  if (size * entry.count <= 4) return entry.valueAt;
  const rel = u32(entry.valueAt);
  if (rel == null || tiff + rel >= end) return -1;
  return tiff + rel;
}
