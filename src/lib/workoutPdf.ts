import type { ExportDoc } from "./workoutExport";

/*
 * Formatted PDF writer (jsPDF + autotable, loaded on demand so it never weighs down the main bundle).
 * Layout: brand header with the CoachFlow logo, document title, then one titled table per workout / routine.
 */

const INK: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [100, 110, 128];
const ACCENT: [number, number, number] = [59, 130, 246];
const BAND: [number, number, number] = [13, 18, 32];
const LINE: [number, number, number] = [226, 230, 238];

/** jsPDF's built-in fonts only cover Latin-1; swap anything else (emoji, curly punctuation) for a safe stand-in. */
function safe(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/·/g, "|")
    .replace(/[^\x20-\x7E -ÿ]/g, "");
}

async function logoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch("/pwa-icon/192", { cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function fileSafe(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 60) || "workout";
}

/** Builds the PDF and returns it as a Blob (the caller decides whether to download or share it). */
export async function buildPdf(doc: ExportDoc): Promise<Blob> {
  const [{ jsPDF }, { autoTable }, logo] = await Promise.all([import("jspdf"), import("jspdf-autotable"), logoDataUrl()]);
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 40;

  const headed = new Set<number>();
  const header = () => {
    headed.add(pdf.getCurrentPageInfo().pageNumber);
    pdf.setFillColor(...BAND);
    pdf.rect(0, 0, W, 78, "F");
    let x = M;
    if (logo) {
      try {
        pdf.addImage(logo, "PNG", M, 17, 44, 44);
        x = M + 56;
      } catch {
        /* no logo */
      }
    }
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(20);
    pdf.text(safe(doc.brand), x, 43);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(170, 182, 205);
    pdf.text(safe(doc.title), W - M, 38, { align: "right" });
    pdf.text(safe(doc.subtitle), W - M, 54, { align: "right" });
    pdf.setFillColor(...ACCENT);
    pdf.rect(0, 78, W, 3, "F");
  };

  header();
  let y = 108;
  const lastY = () => (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;

  doc.blocks.forEach((b, i) => {
    const needed = 120 + Math.min(b.rows.length, 4) * 24;
    if (i > 0 && y + needed > H - 40) {
      pdf.addPage();
      header();
      y = 108;
    }

    pdf.setTextColor(...INK);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    const titleLines = pdf.splitTextToSize(safe(b.title), W - 2 * M) as string[];
    pdf.text(titleLines, M, y);
    y += titleLines.length * 17;

    if (b.meta.length) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(...MUTED);
      pdf.text(safe(b.meta.map((m) => `${m.label}: ${m.value}`).join("    ")), M, y);
      y += 14;
    }
    y += 4;

    autoTable(pdf, {
      startY: y,
      margin: { left: M, right: M, top: 100, bottom: 40 },
      head: [["Exercise", "Sets", "Reps", "Weight", "Notes"]],
      body: b.rows.map((r) => [safe(r.name), safe(r.sets), safe(r.reps), safe(r.weight), safe(r.notes)]),
      theme: "grid",
      styles: { font: "helvetica", fontSize: 9.5, cellPadding: 6, textColor: INK, lineColor: LINE, lineWidth: 0.6, valign: "top" },
      headStyles: { fillColor: ACCENT, textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [247, 249, 252] },
      columnStyles: {
        0: { cellWidth: "auto", fontStyle: "bold" },
        1: { cellWidth: 52, halign: "center" },
        2: { cellWidth: 78, halign: "center" },
        3: { cellWidth: 92, halign: "center" },
        4: { cellWidth: 130 },
      },
      // Pages created by a long table also get the brand header.
      didDrawPage: (data) => {
        if (!headed.has(data.pageNumber)) header();
      },
    });
    y = lastY() + 12;

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(...ACCENT);
    pdf.text(safe(b.summary), M, y);
    y += 14;
    if (b.notes) {
      pdf.setFont("helvetica", "normal");
      pdf.setTextColor(...MUTED);
      const nl = pdf.splitTextToSize(safe(`Notes: ${b.notes}`), W - 2 * M) as string[];
      pdf.text(nl, M, y);
      y += nl.length * 12;
    }
    y += 22;
  });

  return pdf.output("blob");
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
