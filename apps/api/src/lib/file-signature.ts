/** Identify file types from their content ("magic bytes"); client-declared MIME types are never trusted. */
export interface DetectedType {
  mime: string;
  ext: string;
}

const SIGNATURES: Array<DetectedType & { test: (b: Buffer) => boolean }> = [
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) =>
      b.length > 8 &&
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) =>
      b.length > 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
  {
    mime: 'image/avif',
    ext: 'avif',
    test: (b) =>
      b.length > 12 &&
      b.toString('ascii', 4, 8) === 'ftyp' &&
      /^avi[fs]$/.test(b.toString('ascii', 8, 12)),
  },
  {
    mime: 'application/pdf',
    ext: 'pdf',
    test: (b) => b.length > 5 && b.toString('ascii', 0, 5) === '%PDF-',
  },
];

export function detectFileType(buffer: Buffer, allowed?: readonly string[]): DetectedType | null {
  const match = SIGNATURES.find((s) => s.test(buffer));
  if (!match) return null;
  if (allowed && !allowed.includes(match.mime)) return null;
  return { mime: match.mime, ext: match.ext };
}
