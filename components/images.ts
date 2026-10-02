"use client";

export interface UploadImage {
  mediaType: "image/jpeg";
  /** Base64 without the data: prefix, as the API expects. */
  data: string;
  /** data: URL for a thumbnail. */
  preview: string;
}

// Phone photos are often 4000px+. Claude reads images best around 1568px on
// the long edge, so shrink before upload: faster, cheaper, same accuracy.
const MAX_EDGE = 1568;

export async function readImage(file: File): Promise<UploadImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not process the image in this browser.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const preview = canvas.toDataURL("image/jpeg", 0.85);
  return { mediaType: "image/jpeg", data: preview.slice(preview.indexOf(",") + 1), preview };
}
