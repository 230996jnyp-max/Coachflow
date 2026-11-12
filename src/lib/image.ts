"use client";

import type { MediaKind } from "./prefs";

/** The longest side (pixels) and JPEG quality each picture is shrunk to before it is sent, so uploads stay small and fast. */
const TARGET: Record<MediaKind, { max: number; square?: boolean; quality: number }> = {
  avatar: { max: 320, square: true, quality: 0.85 },
  logo: { max: 400, quality: 0.9 },
  banner: { max: 1200, quality: 0.8 },
  bg: { max: 1280, quality: 0.72 },
};

/** Reads a chosen picture, shrinks it (profile photos are cropped square from the middle) and returns it ready to upload. */
export async function pictureToUpload(file: File, kind: MediaKind): Promise<{ mime: string; data: string }> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a picture file.");
  if (file.size > 15_000_000) throw new Error("That file is too large. Choose one under 15 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That picture couldn't be opened."));
      i.src = url;
    });
    const t = TARGET[kind];
    let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
    if (t.square) {
      const s = Math.min(sw, sh);
      sx = (sw - s) / 2;
      sy = (sh - s) / 2;
      sw = sh = s;
    }
    const scale = Math.min(1, t.max / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser couldn't prepare the picture.");
    // A transparent logo should stay transparent, so only fill behind photos.
    if (kind !== "logo") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    const mime = kind === "logo" ? "image/png" : "image/jpeg";
    const dataUrl = canvas.toDataURL(mime, t.quality);
    return { mime, data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
