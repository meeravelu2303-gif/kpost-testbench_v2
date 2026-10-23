import { crc32 } from 'node:zlib';
import { expect, test } from '@playwright/test';
import {
  AWKWARD_NAMES,
  FILES,
  HOSTILE_MARKER,
  jpegFile,
  sha256,
  uniqueName,
} from '@fixtures/files';

/**
 * The sample files (`src/fixtures/files`) are what every upload/download test sends and compares, so a
 * broken one would turn a product verdict into noise. These checks need no network and no browser.
 * Independently confirmed once, 2026-10-23: DOCX/XLSX opened by .NET ZipFile with every part parsing as XML;
 * JPEG/PNG/GIF (incl. the 520 000-byte padded JPEG) decoded by GDI+; the WAV loaded by SoundPlayer.
 */
test.describe('Sample files are valid, deterministic files of their type @framework', () => {
  test('every file is byte-identical on every generation (stable SHA-256)', () => {
    for (const f of Object.values(FILES)) {
      expect(sha256(f.bytes()), `${f.key} is deterministic`).toBe(sha256(f.bytes()));
    }
  });

  test('each file starts with its format signature', () => {
    const sig: Record<string, (b: Buffer) => boolean> = {
      pdf: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
      integrity: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
      docx: (b) => b.readUInt32LE(0) === 0x04034b50,
      xlsx: (b) => b.readUInt32LE(0) === 0x04034b50,
      jpeg: (b) => b[0] === 0xff && b[1] === 0xd8 && b.at(-2) === 0xff && b.at(-1) === 0xd9,
      png: (b) => b.subarray(1, 4).toString('latin1') === 'PNG',
      gif: (b) => b.subarray(0, 6).toString('latin1') === 'GIF89a',
      webp: (b) =>
        b.subarray(0, 4).toString('latin1') === 'RIFF' &&
        b.subarray(8, 12).toString('latin1') === 'WEBP',
      wav: (b) =>
        b.subarray(0, 4).toString('latin1') === 'RIFF' &&
        b.subarray(8, 12).toString('latin1') === 'WAVE',
      exe: (b) => b.subarray(0, 2).toString('latin1') === 'MZ',
      empty: (b) => b.length === 0,
    };
    for (const [key, ok] of Object.entries(sig)) {
      expect(ok(FILES[key as keyof typeof FILES].bytes()), `${key} has its signature`).toBe(true);
    }
  });

  test('the PDF cross-reference table points at each object (readers open it without repair)', () => {
    const text = FILES.pdf.bytes().toString('latin1');
    const startxref = Number(text.match(/startxref\n(\d+)/)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets, 'one entry per object').toHaveLength(5);
    offsets.forEach((o, i) =>
      expect(text.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`).toBe(true),
    );
  });

  test('every PNG chunk carries a correct CRC', () => {
    const b = FILES.png.bytes();
    for (let at = 8; at < b.length;) {
      const len = b.readUInt32BE(at);
      const typed = b.subarray(at + 4, at + 8 + len);
      expect(b.readUInt32BE(at + 8 + len), `${typed.subarray(0, 4).toString('latin1')} CRC`).toBe(
        crc32(typed),
      );
      at += 12 + len;
    }
  });

  test('RIFF sizes match the file length (WAV, WEBP)', () => {
    for (const f of [FILES.wav, FILES.webp]) {
      const b = f.bytes();
      expect(b.readUInt32LE(4), `${f.key} RIFF size`).toBe(b.length - 8);
    }
  });

  test('the ZIP containers list every part in their central directory', () => {
    for (const f of [FILES.docx, FILES.xlsx]) {
      const b = f.bytes();
      const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      expect(end, `${f.key} has an end-of-directory record`).toBeGreaterThan(0);
      const entries = b.readUInt16LE(end + 10);
      expect(entries, `${f.key} part count`).toBe(f.key === 'docx' ? 3 : 5);
      const dirAt = b.readUInt32LE(end + 16);
      expect(b.readUInt32LE(dirAt), `${f.key} directory starts where the record says`).toBe(
        0x02014b50,
      );
    }
  });

  test('padded JPEGs have exactly the requested size and still end like a JPEG', () => {
    for (const n of [10 * 1024, 50 * 1024, 520_000, 520_001, 70_000]) {
      const b = jpegFile(n).bytes();
      expect(b, `${n} bytes`).toHaveLength(n);
      expect(
        b[0] === 0xff && b[1] === 0xd8 && b.at(-2) === 0xff && b.at(-1) === 0xd9,
        `${n}: SOI…EOI`,
      ).toBe(true);
    }
  });

  test('hostile files are inert: a marker, no script, no network reference', () => {
    for (const f of Object.values(FILES).filter((x) => x.kind === 'hostile' && x.key !== 'exe')) {
      const text = f.bytes().toString('utf8');
      expect(text, `${f.key} carries the marker`).toContain(HOSTILE_MARKER);
      expect(text, `${f.key} has no script`).not.toMatch(/<script|javascript:|on\w+\s*=/i);
      expect(text, `${f.key} references nothing external`).not.toMatch(
        /https?:\/\/(?!www\.w3\.org)/,
      );
    }
  });

  test('unique names keep the extension and are recognisably QA', () => {
    const name = uniqueName(FILES.pdf, 'katchup');
    expect(name).toMatch(/^qa-katchup-\d+-document\.pdf$/);
    expect(AWKWARD_NAMES.traversalPosix).toContain('../');
  });
});
