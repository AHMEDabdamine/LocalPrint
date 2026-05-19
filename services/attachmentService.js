import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_BASE = path.join(__dirname, '..', 'uploads');

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const MAX_ATTACHMENT_SIZE = 25 * 1024 * 1024; // 25MB

/**
 * Sanitize a filename: remove path separators and dangerous characters.
 */
function sanitizeFilename(name) {
  return name
    .replace(/[/\\:<>"|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 200);
}

/**
 * Save a base64-encoded attachment to disk under uploads/YYYY/MM/DD/.
 * Returns the relative path from uploads base.
 */
export async function saveAttachment(filename, mimeType, base64Data, gmailMessageId) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    console.warn(`⚠️  Rejected attachment with unsupported MIME type: ${mimeType}`);
    return null;
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > MAX_ATTACHMENT_SIZE) {
    console.warn(`⚠️  Attachment too large (${buffer.length} bytes): ${filename}`);
    return null;
  }

  const now = new Date();
  const year = now.getFullYear().toString();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const subDir = path.join(year, month, day);
  const dir = path.join(UPLOADS_BASE, subDir);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const safeName = `${gmailMessageId}_${sanitizeFilename(filename)}`;
  const filePath = path.join(dir, safeName);
  fs.writeFileSync(filePath, buffer);

  return path.join(subDir, safeName);
}

/**
 * Get the full file path from a relative path.
 */
export function getAttachmentFullPath(relativePath) {
  return path.join(UPLOADS_BASE, relativePath);
}
