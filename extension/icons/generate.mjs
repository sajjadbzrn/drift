// Generates the extension's PNG icons (16/32/48/128) from the app's real
// logo, public/drift.png. Zero dependencies: a small PNG decoder (inflate +
// unfilter) + a premultiplied-alpha box resize, then the bundled encoder.
//
// Run with:   bun extension/icons/generate.mjs     (or: node extension/icons/generate.mjs)
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE = process.argv[2] || join(ROOT, "public", "drift.png");
const SIZES = [16, 32, 48, 128];

// ---------------------------------------------------------------- PNG encoder
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- PNG decoder
/** Decode a (non-interlaced) PNG into { width, height, rgba }. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG file");

  let ihdr = null;
  let plte = null;
  let trns = null;
  const idat = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") ihdr = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "PLTE") plte = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error("missing IHDR");

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const depth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (interlace !== 0) throw new Error("interlaced PNG is not supported");

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) throw new Error(`unsupported color type ${colorType}`);
  if (depth !== 8 && depth !== 16 && depth !== 4 && depth !== 2 && depth !== 1) {
    throw new Error(`unsupported bit depth ${depth}`);
  }

  const rowBytes = Math.ceil((width * channels * depth) / 8);
  const bpp = Math.max(1, Math.ceil((channels * depth) / 8));
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (rowBytes + 1) * height) throw new Error("truncated image data");

  // Unfilter into 8-bit-per-channel samples.
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
  };
  const samples = Buffer.alloc(rowBytes * height);
  let prev = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (rowBytes + 1)];
    const src = raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1));
    const cur = samples.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error(`bad filter ${filter}`);
      cur[x] = v;
    }
    prev = cur;
  }

  // Expand to straight RGBA8.
  const rgba = Buffer.alloc(width * height * 4);
  const at = (i) => samples[i];
  const mask = depth >= 8 ? 0xff : (1 << depth) - 1;
  const chv = (x, y, ch) => {
    if (depth < 8) {
      const idx = (x * channels + ch) * depth;
      const v = (at(y * rowBytes + Math.floor(idx / 8)) >> (8 - depth - (idx % 8))) & mask;
      return Math.round((v * 255) / mask);
    }
    const off = y * rowBytes + (x * channels + ch) * (depth / 8);
    return at(off); // 16-bit: take the high byte
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r, g, b, a;
      if (colorType === 0) {
        r = g = b = chv(x, y, 0);
        a = 255;
      } else if (colorType === 2) {
        r = chv(x, y, 0);
        g = chv(x, y, 1);
        b = chv(x, y, 2);
        a = 255;
      } else if (colorType === 4) {
        r = g = b = chv(x, y, 0);
        a = chv(x, y, 1);
      } else if (colorType === 6) {
        r = chv(x, y, 0);
        g = chv(x, y, 1);
        b = chv(x, y, 2);
        a = chv(x, y, 3);
      } else if (colorType === 3) {
        const idx = chv(x, y, 0) * 3;
        r = plte[idx];
        g = plte[idx + 1];
        b = plte[idx + 2];
        a = trns && x < trns.length ? trns[x] : 255;
      }
      const o = (y * width + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = a;
    }
  }
  return { width, height, rgba };
}

// ------------------------------------------------------------- resize + write
/** Downscale with premultiplied-alpha box filtering (no dark fringes on
 *  transparent edges). Upscales with nearest-neighbour. */
function resizeRgba(src, sw, sh, tw, th) {
  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor((x * sw) / tw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / tw));
      const y0 = Math.floor((y * sh) / th);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / th));
      let sr = 0, sg = 0, sb = 0, sa = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * sw + sx) * 4;
          const a = src[i + 3];
          sa += a;
          sr += src[i] * a;
          sg += src[i + 1] * a;
          sb += src[i + 2] * a;
        }
      }
      const n = (x1 - x0) * (y1 - y0);
      const o = (y * tw + x) * 4;
      if (sa > 0) {
        out[o] = Math.round(sr / sa);
        out[o + 1] = Math.round(sg / sa);
        out[o + 2] = Math.round(sb / sa);
        out[o + 3] = Math.round(sa / n);
      }
    }
  }
  return out;
}

const src = decodePng(readFileSync(SOURCE));
console.log(`source: ${SOURCE} (${src.width}x${src.height})`);

// Diagnostic: report whether the logo has a transparent or opaque background.
let opaque = 0, transparent = 0;
for (let i = 3; i < src.rgba.length; i += 4) {
  if (src.rgba[i] === 0) transparent++;
  else if (src.rgba[i] === 255) opaque++;
}
console.log(
  `alpha: ${(opaque / (src.width * src.height) * 100).toFixed(1)}% opaque, ` +
    `${(transparent / (src.width * src.height) * 100).toFixed(1)}% transparent`,
);

mkdirSync(OUT_DIR, { recursive: true });
// Fraction of the canvas kept as transparent margin around the logo. A little
// breathing room keeps tall/wide wordmarks from touching the icon edges.
const PAD = 0.0;
for (const size of SIZES) {
  const margin = Math.round(size * PAD);
  const inner = Math.max(1, size - margin * 2);
  // "Contain": scale the logo to fit inside the inner box without distorting
  // its aspect ratio, then centre it on a transparent square canvas.
  const scale = Math.min(inner / src.width, inner / src.height);
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  const resized = resizeRgba(src.rgba, src.width, src.height, w, h);
  const out = Buffer.alloc(size * size * 4); // fully transparent by default
  const ox = Math.floor((size - w) / 2);
  const oy = Math.floor((size - h) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = ((oy + y) * size + (ox + x)) * 4;
      out[di] = resized[si];
      out[di + 1] = resized[si + 1];
      out[di + 2] = resized[si + 2];
      out[di + 3] = resized[si + 3];
    }
  }
  writeFileSync(join(OUT_DIR, `icon${size}.png`), encodePng(size, size, out));
  console.log(`wrote extension/icons/icon${size}.png`);
}
