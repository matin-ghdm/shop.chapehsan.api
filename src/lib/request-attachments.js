const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_ATTACHMENT_BYTES = 3 * 1024 * 1024;

function parseRequestAttachments(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 3) return null;
  const attachments = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    let url;
    try { url = new URL(String(entry.url || "")); } catch { return null; }
    const name = String(entry.name || "").replace(/[\r\n]/g, " ").trim().slice(0, 180);
    const size = Number(entry.size);
    const image = /\.(jpe?g|png|webp|gif|tiff?|svg|bmp|avif|heic|heif)$/i.test(name) || /\.(jpe?g|png|webp|gif|tiff?|svg|bmp|avif|heic|heif)$/i.test(url.pathname);
    if (image && size > MAX_IMAGE_ATTACHMENT_BYTES) return null;
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/i.test(url.hostname) || !url.pathname.startsWith("/request-attachments/") || !name || !Number.isInteger(size) || size < 1 || size > MAX_ATTACHMENT_BYTES) return null;
    attachments.push({ url: url.toString(), name, size });
  }
  return attachments;
}

module.exports = { parseRequestAttachments, MAX_ATTACHMENT_BYTES, MAX_IMAGE_ATTACHMENT_BYTES };
