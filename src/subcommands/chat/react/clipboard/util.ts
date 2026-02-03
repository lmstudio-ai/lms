// Tiny magic-number helpers for detecting if a Buffer is an image.
// This is intentionally minimal and best-effort (no full parsing).

type MagicSignature = { offset: number; bytes: readonly number[] };

type MagicNumber = {
  signatures: readonly MagicSignature[];
  format: "JPEG" | "PNG" | "GIF" | "BMP" | "WEBP";
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/bmp" | "image/webp";
  extension: "jpg" | "png" | "gif" | "bmp" | "webp";
};

function matchesMagicSignatures(content: Buffer, signatures: readonly MagicSignature[]): boolean {
  return signatures.every(({ offset, bytes }) => {
    if (content.length < offset + bytes.length) return false;
    return bytes.every((byte, index) => content[offset + index] === byte);
  });
}

// Check for common image format magic numbers
const BASE64_MAGIC_NUMBERS: readonly MagicNumber[] = [
  { signatures: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }], format: "JPEG", mimeType: "image/jpeg", extension: "jpg" },
  {
    signatures: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }],
    format: "PNG",
    mimeType: "image/png",
    extension: "png",
  },
  { signatures: [{ offset: 0, bytes: [0x47, 0x49, 0x46] }], format: "GIF", mimeType: "image/gif", extension: "gif" },
  { signatures: [{ offset: 0, bytes: [0x42, 0x4d] }], format: "BMP", mimeType: "image/bmp", extension: "bmp" },
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

export function isImageViaMagic(content: Buffer): boolean {
  for (const { signatures } of BASE64_MAGIC_NUMBERS) {
    if (matchesMagicSignatures(content, signatures)) return true;
  }
  return false;
}

export function detectImageViaMagic(content: Buffer): {
  format: MagicNumber["format"];
  mimeType: MagicNumber["mimeType"];
  extension: MagicNumber["extension"];
} | null {
  for (const entry of BASE64_MAGIC_NUMBERS) {
    if (matchesMagicSignatures(content, entry.signatures)) {
      return { format: entry.format, mimeType: entry.mimeType, extension: entry.extension };
    }
  }
  return null;
}
