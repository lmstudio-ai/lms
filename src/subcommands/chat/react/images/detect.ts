// Tiny magic-number helpers for detecting if a Buffer is an image.
// This is intentionally minimal and best-effort (no full parsing).

// Check for common image format magic numbers
const MAGIC_NUMBERS = [
  {
    signatures: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
    format: "JPEG",
    mimeType: "image/jpeg",
    extension: "jpg",
  },
  {
    signatures: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }],
    format: "PNG",
    mimeType: "image/png",
    extension: "png",
  },
  {
    signatures: [{ offset: 0, bytes: [0x47, 0x49, 0x46] }],
    format: "GIF",
    mimeType: "image/gif",
    extension: "gif",
  },
  {
    signatures: [{ offset: 0, bytes: [0x42, 0x4d] }],
    format: "BMP",
    mimeType: "image/bmp",
    extension: "bmp",
  },
  {
    signatures: [
      { offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }, // "II*\0" little-endian TIFF
      { offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] }, // "MM\0*" big-endian TIFF
    ],
    format: "TIFF",
    mimeType: "image/tiff",
    extension: "tiff",
  },
  {
    // RIFF-based formats share the "RIFF" prefix; WEBP is identified by a "WEBP" FourCC at bytes 8–11.
    signatures: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP"
    ],
    format: "WEBP",
    mimeType: "image/webp",
    extension: "webp",
  },
] as const;

type MagicNumber = (typeof MAGIC_NUMBERS)[number];

export function detectImageViaMagic(content: Buffer): {
  format: MagicNumber["format"];
  mimeType: MagicNumber["mimeType"];
  extension: MagicNumber["extension"];
} | null {
  for (const entry of MAGIC_NUMBERS) {
    const matches = entry.signatures.every(({ offset, bytes }) => {
      if (content.length < offset + bytes.length) return false;
      return bytes.every((byte, index) => content[offset + index] === byte);
    });
    if (matches) {
      return { format: entry.format, mimeType: entry.mimeType, extension: entry.extension };
    }
  }
  return null;
}

export function isImageViaMagic(content: Buffer): boolean {
  return detectImageViaMagic(content) !== null;
}
