import { saveBlob } from "./recapImage";

export interface BadgeCard {
  emoji: string;
  title: string;
  blurb: string;
  /** Who earned it. */
  name: string;
  /** Already formatted ("12 Nov 2026"). */
  date: string;
  brand: string;
}

const FONT = `-apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
const EMOJI_FONT = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;

/** Draws a badge as a square picture (PNG) in the app's dark look, ready to post or send. Browser only. */
export async function badgePng(c: BadgeCard): Promise<Blob> {
  const S = 1080;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext("2d")!;

  const wrap = (text: string, size: number, weight: number, width: number): string[] => {
    g.font = `${weight} ${size}px ${FONT}`;
    const out: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > width && line) {
        out.push(line);
        line = word;
      } else line = test;
    }
    if (line) out.push(line);
    return out;
  };
  const text = (t: string, x: number, y: number, size: number, weight: number, color: string, align: CanvasTextAlign = "center") => {
    g.font = `${weight} ${size}px ${FONT}`;
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = "alphabetic";
    g.fillText(t, x, y);
  };

  // Background with a soft glow behind the badge.
  g.fillStyle = "#090B10";
  g.fillRect(0, 0, S, S);
  const glow = g.createRadialGradient(S / 2, 400, 40, S / 2, 400, 520);
  glow.addColorStop(0, "rgba(59,130,246,0.38)");
  glow.addColorStop(1, "rgba(59,130,246,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);

  // The medal.
  g.beginPath();
  g.arc(S / 2, 400, 230, 0, Math.PI * 2);
  g.fillStyle = "#121620";
  g.fill();
  g.lineWidth = 14;
  g.strokeStyle = "#F5B83D";
  g.stroke();
  g.font = `220px ${EMOJI_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#FFFFFF";
  g.fillText(c.emoji, S / 2, 410);

  text("BADGE EARNED", S / 2, 722, 34, 800, "#F5B83D");
  let y = 800;
  for (const line of wrap(c.title, 84, 800, S - 160).slice(0, 2)) {
    text(line, S / 2, y, 84, 800, "#FFFFFF");
    y += 92;
  }
  for (const line of wrap(c.blurb, 36, 500, S - 240).slice(0, 2)) {
    text(line, S / 2, y - 18, 36, 500, "#8892A6");
    y += 46;
  }

  // Who and when, then the brand.
  text(`${c.name}  ·  ${c.date}`, S / 2, 988, 34, 700, "#E8ECF4");
  g.fillStyle = "#3B82F6";
  g.fillRect(0, S - 56, S, 56);
  text(c.brand, S / 2, S - 18, 30, 800, "#FFFFFF");

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the picture."))), "image/png"));
}

/**
 * Opens the phone's share sheet with the picture when it can (WhatsApp, Instagram, Messages...), otherwise saves it.
 * "cancelled" means the person closed the share sheet.
 */
export async function shareBadge(blob: Blob, filename: string, message: string): Promise<"shared" | "saved" | "cancelled"> {
  const file = new File([blob], filename, { type: "image/png" });
  if (typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: message });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "cancelled";
    }
  }
  saveBlob(blob, filename);
  return "saved";
}
