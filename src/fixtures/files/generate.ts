import { crc32, deflateSync } from 'node:zlib';
import { zip } from './zip';

/**
 * Generators for small, genuinely valid files of each type the product handles. Built in memory and
 * deterministic (no timestamps, no randomness), so a test can compare a download with what it uploaded
 * byte for byte. Each opens in its real application: a PDF reader, Word, Excel, an image viewer, a player.
 */

/** A one-page PDF with a line of text; the xref offsets are computed, so readers accept it as-is. */
export function pdf(text = 'KPost QA bench test document'): Buffer {
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, '')}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefAt = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) body += `${String(o).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

/** A width×height RGB PNG filled with one colour. */
export function png(width = 4, height = 4, rgb: [number, number, number] = [32, 96, 200]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3)]);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A baseline 1×1 JPEG — the bytes the profile/group image tests have used since 2026-09 (live-verified). */
export const JPEG_1X1_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';
export const jpeg = (): Buffer => Buffer.from(JPEG_1X1_BASE64, 'base64');

/**
 * A JPEG of exactly `bytes` bytes: the 1×1 image with COM (comment, 0xFFFE) segments after the SOI.
 * Decoders skip comments, so it is still the same valid picture — used for size-rule boundaries
 * (signature 10–50 KB, profile/group photo 520 000 B).
 */
export function jpegOfSize(bytes: number): Buffer {
  const base = jpeg();
  let remaining = bytes - base.length;
  if (remaining < 4) return base;
  const segments: Buffer[] = [];
  while (remaining >= 4) {
    // One segment carries at most 65 533 payload bytes; never leave a 1–3 byte tail that cannot hold a header.
    let payload = Math.min(remaining - 4, 65_533);
    const tail = remaining - 4 - payload;
    if (tail > 0 && tail < 4) payload -= 4 - tail;
    const seg = Buffer.alloc(4 + payload, 0x20);
    seg[0] = 0xff;
    seg[1] = 0xfe;
    seg.writeUInt16BE(payload + 2, 2);
    segments.push(seg);
    remaining -= seg.length;
  }
  return Buffer.concat([base.subarray(0, 2), ...segments, base.subarray(2)]);
}

/** The standard 1×1 transparent GIF89a. */
export const gif = (): Buffer =>
  Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** The standard 1×1 lossless WEBP (the one feature-detection libraries use). */
export const webp = (): Buffer =>
  Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

/** A short silent mono 16-bit PCM WAV — the format Katchup voice notes are recorded in. */
export function wav(milliseconds = 200, sampleRate = 8_000): Buffer {
  const samples = Math.round((sampleRate * milliseconds) / 1000);
  const data = samples * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8, 'ascii');
  b.write('fmt ', 12, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(data, 40);
  return b;
}

/** A one-paragraph Word document. */
export function docx(text = 'KPost QA bench test document'): Buffer {
  return zip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  });
}

/** A one-sheet workbook; each row is written as inline strings. */
export function xlsx(rows: string[][] = [['email'], ['qatest2@kpostindia.com']]): Buffer {
  const col = (i: number): string => String.fromCharCode(65 + i);
  const sheetRows = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 1}">${r
          .map((v, ci) => `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${v}</t></is></c>`)
          .join('')}</row>`,
    )
    .join('');
  return zip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  });
}

/**
 * Every byte value 0x00–0xFF repeated inside a PDF envelope — the payload the integrity specs have always
 * used: a server that re-encodes text, strips NULs or trims high bytes cannot hand it back unchanged.
 */
export function allBytes(repeats = 8): Buffer {
  const every = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n%QA integrity\n', 'latin1'),
    ...Array.from({ length: repeats }, () => every),
    Buffer.from('\n%%EOF\n', 'latin1'),
  ]);
}
