import { createHash } from 'node:crypto';
import { allBytes, docx, gif, jpeg, jpegOfSize, pdf, png, wav, webp, xlsx } from './generate';

export { allBytes, docx, gif, jpeg, jpegOfSize, pdf, png, wav, webp, xlsx } from './generate';
export { JPEG_1X1_BASE64 } from './generate';

/**
 * Sample files for upload/download tests: one valid file per type plus edge and hostile cases,
 * generated deterministically so a download can be compared byte for byte. Hostile files are inert
 * (a marker, no script).
 */
export interface SampleFile {
  /** Stable key, e.g. 'pdf'. */
  key: string;
  /** What the file is, for test titles. */
  label: string;
  fileName: string;
  /** The extension the product's presign requests send (no dot). */
  extension: string;
  mimeType: string;
  kind: 'document' | 'image' | 'audio' | 'text' | 'hostile' | 'edge';
  bytes: () => Buffer;
}

const file = (f: SampleFile): SampleFile => f;

const XSS_MARKER = 'data-kpost-qa-xss';

export const FILES = {
  pdf: file({
    key: 'pdf',
    label: 'PDF document',
    fileName: 'qa-document.pdf',
    extension: 'pdf',
    mimeType: 'application/pdf',
    kind: 'document',
    bytes: () => pdf(),
  }),
  docx: file({
    key: 'docx',
    label: 'Word document',
    fileName: 'qa-document.docx',
    extension: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'document',
    bytes: () => docx(),
  }),
  xlsx: file({
    key: 'xlsx',
    label: 'Excel workbook',
    fileName: 'qa-sheet.xlsx',
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'document',
    bytes: () => xlsx(),
  }),
  csv: file({
    key: 'csv',
    label: 'CSV file',
    fileName: 'qa-sheet.csv',
    extension: 'csv',
    mimeType: 'text/csv',
    kind: 'text',
    bytes: () => Buffer.from('email,name\nqatest2@kpostindia.com,Qatest2 Bench\n', 'utf8'),
  }),
  txt: file({
    key: 'txt',
    label: 'text file',
    fileName: 'qa-note.txt',
    extension: 'txt',
    mimeType: 'text/plain',
    kind: 'text',
    bytes: () =>
      Buffer.from('KPost QA bench — plain text attachment, UTF-8: தமிழ் 文件 ✓\n', 'utf8'),
  }),
  jpeg: file({
    key: 'jpeg',
    label: 'JPEG image',
    fileName: 'qa-photo.jpg',
    extension: 'jpg',
    mimeType: 'image/jpeg',
    kind: 'image',
    bytes: () => jpeg(),
  }),
  png: file({
    key: 'png',
    label: 'PNG image',
    fileName: 'qa-image.png',
    extension: 'png',
    mimeType: 'image/png',
    kind: 'image',
    bytes: () => png(),
  }),
  gif: file({
    key: 'gif',
    label: 'GIF image',
    fileName: 'qa-image.gif',
    extension: 'gif',
    mimeType: 'image/gif',
    kind: 'image',
    bytes: () => gif(),
  }),
  webp: file({
    key: 'webp',
    label: 'WEBP image',
    fileName: 'qa-image.webp',
    extension: 'webp',
    mimeType: 'image/webp',
    kind: 'image',
    bytes: () => webp(),
  }),
  wav: file({
    key: 'wav',
    label: 'WAV voice note',
    fileName: 'qa-voice.wav',
    extension: 'wav',
    mimeType: 'audio/wav',
    kind: 'audio',
    bytes: () => wav(),
  }),
  integrity: file({
    key: 'integrity',
    label: 'all-bytes integrity payload',
    fileName: 'qa-integrity.pdf',
    extension: 'pdf',
    mimeType: 'application/pdf',
    kind: 'document',
    bytes: () => allBytes(),
  }),
  empty: file({
    key: 'empty',
    label: 'zero-byte file',
    fileName: 'qa-empty.txt',
    extension: 'txt',
    mimeType: 'text/plain',
    kind: 'edge',
    bytes: () => Buffer.alloc(0),
  }),
  html: file({
    key: 'html',
    label: 'HTML page (hostile)',
    fileName: 'qa-page.html',
    extension: 'html',
    mimeType: 'text/html',
    kind: 'hostile',
    bytes: () =>
      Buffer.from(
        `<!doctype html><html><body><p ${XSS_MARKER}="html">KPost QA bench: this file must never be served as a web page.</p></body></html>\n`,
        'utf8',
      ),
  }),
  svg: file({
    key: 'svg',
    label: 'SVG image with markup (hostile)',
    fileName: 'qa-image.svg',
    extension: 'svg',
    mimeType: 'image/svg+xml',
    kind: 'hostile',
    bytes: () =>
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4" ${XSS_MARKER}="svg"><rect width="4" height="4" fill="#2060c8"/></svg>\n`,
        'utf8',
      ),
  }),
  exe: file({
    key: 'exe',
    label: 'Windows executable header (hostile)',
    fileName: 'qa-tool.exe',
    extension: 'exe',
    mimeType: 'application/x-msdownload',
    kind: 'hostile',
    bytes: () => Buffer.concat([Buffer.from('MZ', 'latin1'), Buffer.alloc(62)]),
  }),
  spoofedJpeg: file({
    key: 'spoofedJpeg',
    label: 'HTML disguised as .jpg (hostile)',
    fileName: 'qa-spoof.jpg',
    extension: 'jpg',
    mimeType: 'image/jpeg',
    kind: 'hostile',
    bytes: () =>
      Buffer.from(`<html><body ${XSS_MARKER}="spoof">not an image</body></html>\n`, 'utf8'),
  }),
} satisfies Record<string, SampleFile>;

export type FileKey = keyof typeof FILES;

/** The marker the hostile files carry: a download whose body contains it was served back verbatim. */
export const HOSTILE_MARKER = XSS_MARKER;

/** A JPEG of an exact size, as a sample file (size-rule boundaries). */
export function jpegFile(bytes: number, label = `${bytes}-byte JPEG`): SampleFile {
  return file({
    key: `jpeg-${bytes}`,
    label,
    fileName: `qa-photo-${bytes}.jpg`,
    extension: 'jpg',
    mimeType: 'image/jpeg',
    kind: 'edge',
    bytes: () => jpegOfSize(bytes),
  });
}

/** File names a server must store safely (never as a path, never mangled beyond recognition). */
export const AWKWARD_NAMES = {
  traversalPosix: '../../qa-traversal.txt',
  traversalWindows: '..\\..\\qa-traversal.txt',
  unicode: 'qa-தமிழ்-文件 (1).pdf',
  spaces: 'qa report final  v2.pdf',
  doubleExtension: 'qa-invoice.pdf.exe',
  long: `qa-${'x'.repeat(200)}.txt`,
} as const;

export const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/** A unique, recognisable name for one upload: `qa-<tag>-<time>-<original>`. */
export const uniqueName = (f: SampleFile, tag: string): string =>
  `qa-${tag}-${Date.now() % 100_000_000}-${f.fileName.replace(/^qa-/, '')}`;

/** The shape Playwright's `setInputFiles` / `filechooser.setFiles` take. */
export const asUpload = (
  f: SampleFile,
  name = f.fileName,
): { name: string; mimeType: string; buffer: Buffer } => ({
  name,
  mimeType: f.mimeType,
  buffer: f.bytes(),
});
