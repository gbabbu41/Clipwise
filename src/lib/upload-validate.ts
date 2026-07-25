// Server-only — validate an uploaded image by its ACTUAL bytes (magic number),
// not the client-supplied file.name / file.type (both attacker-controllable).
// Uploads land in a PUBLIC bucket, so without this a caller could store an
// .svg/.html payload served from our storage origin (stored XSS). Forcing a
// sniffed extension + a fixed image content-type neutralizes that.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const CONTENT_TYPE: Record<"png" | "jpg" | "webp", string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

export interface DetectedImage { ext: "png" | "jpg" | "webp"; contentType: string }

/** Returns the real image kind from the file header, or null if it isn't a
 *  supported image (PNG / JPEG / WebP). */
export function detectImage(buffer: Buffer): DetectedImage | null {
  if (buffer.length < 12) return null;
  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { ext: "png", contentType: CONTENT_TYPE.png };
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: "jpg", contentType: CONTENT_TYPE.jpg };
  }
  // WebP: "RIFF" .... "WEBP"
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { ext: "webp", contentType: CONTENT_TYPE.webp };
  }
  return null;
}
