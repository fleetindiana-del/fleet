import { test } from "node:test";
import assert from "node:assert/strict";
import { gpsFromJpeg } from "./jpegGps.ts";

/** Little-endian JPEG whose EXIF says 19°4'30" N, 72°52'39" E. */
function sample(): Uint8Array {
  const b = new Uint8Array(200);
  const w16 = (o: number, v: number) => {
    b[o] = v & 255;
    b[o + 1] = (v >> 8) & 255;
  };
  const w32 = (o: number, v: number) => {
    b[o] = v & 255;
    b[o + 1] = (v >> 8) & 255;
    b[o + 2] = (v >> 16) & 255;
    b[o + 3] = (v >> 24) & 255;
  };
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  b[3] = 0xe1;
  // length covers Exif header + TIFF through the rationals
  const appLen = 2 + 6 + 8 + 2 + 12 + 4 + 2 + 4 * 12 + 4 + 6 * 8;
  b[4] = (appLen >> 8) & 255;
  b[5] = appLen & 255;
  b[6] = 0x45;
  b[7] = 0x78;
  b[8] = 0x69;
  b[9] = 0x66;
  b[10] = 0;
  b[11] = 0;
  const t = 12;
  b[t] = 0x49;
  b[t + 1] = 0x49;
  w16(t + 2, 42);
  w32(t + 4, 8);
  const ifd0 = t + 8;
  w16(ifd0, 1);
  w16(ifd0 + 2, 0x8825);
  w16(ifd0 + 4, 4);
  w32(ifd0 + 6, 1);
  const gpsRel = 8 + 2 + 12 + 4;
  w32(ifd0 + 10, gpsRel);
  w32(ifd0 + 14, 0);
  const gps = t + gpsRel;
  w16(gps, 4);
  const tags = [
    [1, 2, 2],
    [2, 5, 3],
    [3, 2, 2],
    [4, 5, 3],
  ] as const;
  tags.forEach(([tag, type, count], i) => {
    const e = gps + 2 + i * 12;
    w16(e, tag);
    w16(e + 2, type);
    w32(e + 4, count);
  });
  // N and E inline
  b[gps + 2 + 8] = 0x4e;
  b[gps + 2 + 8 + 1] = 0;
  b[gps + 2 + 2 * 12 + 8] = 0x45;
  b[gps + 2 + 2 * 12 + 8 + 1] = 0;
  const rat = gps + 2 + 4 * 12 + 4;
  w32(gps + 2 + 12 + 8, rat - t);
  w32(gps + 2 + 3 * 12 + 8, rat + 24 - t);
  const parts = [19, 1, 4, 1, 30, 1, 72, 1, 52, 1, 39, 1];
  parts.forEach((v, i) => w32(rat + i * 4, v));
  const end = rat + 48;
  b[end] = 0xff;
  b[end + 1] = 0xd9;
  return b.slice(0, end + 2);
}

test("reads the GPS coordinates embedded in a JPEG", () => {
  const gps = gpsFromJpeg(sample());
  assert.ok(gps);
  assert.ok(Math.abs(gps.lat - (19 + 4 / 60 + 30 / 3600)) < 1e-6);
  assert.ok(Math.abs(gps.lng - (72 + 52 / 60 + 39 / 3600)) < 1e-6);
});

test("ignores a photo with no EXIF", () => {
  assert.equal(gpsFromJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
});
