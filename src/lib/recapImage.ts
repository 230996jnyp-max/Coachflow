import type { Recap } from "./recap";

/** Draws the recap card as a picture (PNG), in the app's dark look, ready to save or share. Browser only. */
export async function recapPng(r: Recap): Promise<Blob> {
  const W = 900;
  const pad = 56;
  const measure = document.createElement("canvas").getContext("2d")!;
  const font = (size: number, weight = 500) => `${weight} ${size}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  const wrap = (text: string, size: number, weight: number, width: number): string[] => {
    measure.font = font(size, weight);
    const out: string[] = [];
    for (const para of text.split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const test = line ? `${line} ${word}` : word;
        if (measure.measureText(test).width > width && line) {
          out.push(line);
          line = word;
        } else line = test;
      }
      out.push(line);
    }
    return out;
  };

  // First pass: work out the height.
  const titleLines = wrap(r.title, 52, 800, W - pad * 2);
  const noteLines = r.notes ? wrap(r.notes, 28, 500, W - pad * 2 - 40) : [];
  let H = 140 + titleLines.length * 62 + 60 + 150; // header + title + meta + stat tiles
  if (r.prs.length) H += 70 + r.prs.slice(0, 8).length * 64;
  if (noteLines.length) H += 70 + noteLines.length * 38;
  if (r.credits) H += 110;
  H += 170;

  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const g = canvas.getContext("2d")!;
  g.scale(scale, scale);

  const rect = (x: number, y: number, w: number, h: number, fill: string, radius = 0) => {
    g.fillStyle = fill;
    g.beginPath();
    if (radius) g.roundRect(x, y, w, h, radius);
    else g.rect(x, y, w, h);
    g.fill();
  };
  const text = (t: string, x: number, y: number, size: number, weight: number, color: string, align: CanvasTextAlign = "left") => {
    g.font = font(size, weight);
    g.fillStyle = color;
    g.textAlign = align;
    g.textBaseline = "alphabetic";
    g.fillText(t, x, y);
  };

  rect(0, 0, W, H, "#090B10");
  rect(0, 0, W, 110, "#3B82F6");
  text(r.brand, pad, 70, 40, 800, "#FFFFFF");
  text("Workout recap", W - pad, 68, 26, 600, "#DCE8FF", "right");

  let y = 110 + 80;
  for (const line of titleLines) {
    text(line, pad, y, 52, 800, "#FFFFFF");
    y += 62;
  }
  const meta = [r.clientName, r.date, r.duration].filter(Boolean).join("  ·  ");
  text(meta, pad, y - 6, 28, 500, "#8892A6");
  y += 24;
  if (r.focus.length) {
    let x = pad;
    for (const f of r.focus.slice(0, 4)) {
      g.font = font(24, 700);
      const w = g.measureText(f).width + 36;
      rect(x, y, w, 44, "rgba(59,130,246,0.18)", 22);
      text(f, x + 18, y + 31, 24, 700, "#7FB0FF");
      x += w + 12;
    }
    y += 70;
  } else y += 10;

  // Stat tiles
  const tiles: [string, string][] = [
    ["Exercises", String(r.exercises)],
    ["Sets", String(r.sets)],
    [r.volume ? "Volume" : "Duration", r.volume || r.duration || "—"],
  ];
  const tw = (W - pad * 2 - 24) / 3;
  tiles.forEach(([label, value], i) => {
    const x = pad + i * (tw + 12);
    rect(x, y, tw, 120, "#121620", 20);
    text(value, x + tw / 2, y + 62, 40, 800, "#FFFFFF", "center");
    text(label.toUpperCase(), x + tw / 2, y + 98, 20, 700, "#8892A6", "center");
  });
  y += 120 + 40;

  if (r.prs.length) {
    text(`🏆  ${r.prs.length} NEW PERSONAL RECORD${r.prs.length === 1 ? "" : "S"}`, pad, y + 24, 28, 800, "#F5B83D");
    y += 56;
    for (const p of r.prs.slice(0, 8)) {
      rect(pad, y, W - pad * 2, 54, "rgba(245,184,61,0.14)", 14);
      text(p.exercise, pad + 20, y + 35, 25, 700, "#FFFFFF");
      text(p.records.join(" · "), W - pad - 20, y + 35, 22, 700, "#F5B83D", "right");
      y += 64;
    }
    y += 6;
  }

  if (noteLines.length) {
    text("COACH NOTES", pad, y + 20, 22, 700, "#8892A6");
    y += 44;
    for (const line of noteLines) {
      text(line, pad + 20, y + 24, 28, 500, "#E8ECF4");
      y += 38;
    }
    y += 20;
  }

  if (r.credits) {
    rect(pad, y, W - pad * 2, 84, "#121620", 20);
    text("🎟️  Sessions left", pad + 28, y + 52, 28, 700, "#FFFFFF");
    text(`${r.credits.oneOnOne}${r.credits.group ? `  ·  group ${r.credits.group}` : ""}`, W - pad - 28, y + 54, 34, 800, "#3B82F6", "right");
    y += 110;
  }

  text("Keep going. Consistency builds records.", W / 2, H - 44, 22, 500, "#59627A", "center");

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make the picture."))), "image/png"));
}

/** The same card as a one-page PDF (the picture placed on a page of the same shape). */
export async function recapPdf(r: Recap): Promise<Blob> {
  const png = await recapPng(r);
  const url = URL.createObjectURL(png);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Couldn't make the PDF."));
      i.src = url;
    });
    const { jsPDF } = await import("jspdf");
    const w = 210; // mm, an A4-wide page cut to the card's height
    const h = (img.naturalHeight / img.naturalWidth) * w;
    const pdf = new jsPDF({ unit: "mm", format: [w, h], orientation: "portrait" });
    pdf.addImage(img, "PNG", 0, 0, w, h);
    return pdf.output("blob");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
