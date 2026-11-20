import { hourLabel, WEEKDAYS, type CoachPerf, type OccupancySummary, type Retention } from "./business";

/*
 * The monthly business report as a PDF (jsPDF + autotable, loaded when asked so it never weighs down the page).
 * Landscape A4: a header, a line of key figures, what to look at, the coaches table (a gym) or the coach's own numbers, and the busiest and
 * emptiest classes. Counts and percentages only: nothing in it names a client.
 */

export interface ReportInput {
  kind: "gym" | "coach";
  /** The gym's name, or the coach's. */
  who: string;
  /** For example "Last 30 days to 16 Nov 2026". */
  period: string;
  kpis: [string, string][];
  performance: CoachPerf[] | null;
  occupancy: OccupancySummary | null;
}

const INK: [number, number, number] = [17, 24, 39];
const MUTED: [number, number, number] = [100, 110, 128];
const ACCENT: [number, number, number] = [59, 130, 246];
const BAND: [number, number, number] = [13, 18, 32];

/** jsPDF's built-in fonts only cover Latin-1; swap anything else for a safe stand-in. */
const safe = (s: string): string =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/·/g, "|")
    .replace(/[^\x20-\x7E -ÿ]/g, "");

const pct = (n: number | null) => (n === null ? "-" : `${n}%`);
const ret = (r: Retention) => (r.cohort === 0 ? "-" : r.pct === null ? `${r.kept}/${r.cohort}` : `${r.pct}% (${r.kept}/${r.cohort})`);

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

export const reportFileName = (r: Pick<ReportInput, "kind" | "who">, day: string): string => `coachflow-${r.kind}-report-${r.who.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40) || "report"}-${day}.pdf`;

/** Builds the report and returns it as a Blob; the caller saves it. */
export async function buildReportPdf(input: ReportInput): Promise<Blob> {
  const [{ jsPDF }, { autoTable }, logo] = await Promise.all([import("jspdf"), import("jspdf-autotable"), logoDataUrl()]);
  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 36;
  const lastY = () => (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;

  const header = () => {
    pdf.setFillColor(...BAND);
    pdf.rect(0, 0, W, 64, "F");
    let x = M;
    if (logo) {
      try {
        pdf.addImage(logo, "PNG", M, 14, 36, 36);
        x = M + 46;
      } catch {
        /* no logo */
      }
    }
    pdf.setTextColor(255, 255, 255);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(18);
    pdf.text("CoachFlow", x, 38);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(170, 182, 205);
    pdf.text(safe(input.kind === "gym" ? `Monthly gym report: ${input.who}` : `Monthly coaching report: ${input.who}`), W - M, 32, { align: "right" });
    pdf.text(safe(input.period), W - M, 48, { align: "right" });
    pdf.setFillColor(...ACCENT);
    pdf.rect(0, 64, W, 3, "F");
  };
  const heading = (text: string) => {
    if (y > H - 110) {
      pdf.addPage();
      header();
      y = 92;
    }
    pdf.setTextColor(...INK);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.text(safe(text), M, y);
    y += 8;
  };

  header();
  let y = 92;

  // Key figures
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(...INK);
  const cw = (W - 2 * M) / Math.max(1, input.kpis.length);
  input.kpis.forEach(([label, value], i) => {
    pdf.setFontSize(18);
    pdf.text(safe(value), M + i * cw, y + 6);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...MUTED);
    pdf.text(safe(label), M + i * cw, y + 20);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(...INK);
  });
  y += 44;

  const occ = input.occupancy;
  if (occ && occ.suggestions.length) {
    heading("What to look at");
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9.5);
    pdf.setTextColor(...INK);
    y += 8;
    for (const s of occ.suggestions) {
      const lines = pdf.splitTextToSize(safe(`- ${s.title}. ${s.detail}`), W - 2 * M) as string[];
      if (y + lines.length * 12 > H - 40) {
        pdf.addPage();
        header();
        y = 92;
      }
      pdf.text(lines, M, y);
      y += lines.length * 12 + 3;
    }
    y += 6;
  }

  const common = { margin: { left: M, right: M, top: 84, bottom: 36 }, styles: { fontSize: 8, cellPadding: 4, textColor: INK }, headStyles: { fillColor: BAND, textColor: [255, 255, 255] as [number, number, number] }, alternateRowStyles: { fillColor: [245, 247, 251] as [number, number, number] }, didDrawPage: () => header() };

  if (input.performance && input.performance.length) {
    heading(input.kind === "gym" ? "Coaches, last 30 days" : "Your performance");
    autoTable(pdf, {
      ...common,
      startY: y,
      head: [["Coach", "Clients", "Sessions", "Hours", "Attendance", "Cancelled", "Classes (fill)", "Kept 1 mo", "Kept 3 mo", "Kept 6 mo", "Workouts / client / wk", "Active in 2 wks"]],
      body: input.performance.map((p) => [safe(p.name), String(p.clients), `${p.sessions30} (before: ${p.sessionsPrev30})`, String(p.hours30), pct(p.attendancePct), pct(p.cancelPct), p.classes30 ? `${p.classes30} (${pct(p.classFillPct)})` : "-", ret(p.retention.m1), ret(p.retention.m3), ret(p.retention.m6), p.workoutsPerClientWeek === null ? "-" : String(p.workoutsPerClientWeek), pct(p.engagedPct)]),
    });
    y = lastY() + 18;
  }

  if (occ && occ.byClass.length) {
    heading("Classes, last 90 days");
    autoTable(pdf, {
      ...common,
      startY: y,
      head: [["Class", "When", "Held", "Fill", "Came", "No-show", "Waitlist"]],
      body: occ.byClass.slice(0, 14).map((s) => [safe(s.title), `${WEEKDAYS[s.weekday]} ${hourLabel(s.hour)}`, String(s.sessions), pct(s.fillPct), pct(s.attendedPct), pct(s.noShowPct), String(s.waitlistJoins)]),
    });
    y = lastY() + 12;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...MUTED);
    const t = occ.totals;
    pdf.text(safe(`${t.classes} classes held, ${pct(t.fillPct)} full on average, ${t.fullClasses} full, ${t.waitlistJoins} waitlist joins, ${t.cancels} cancellations (${t.lateCancels} late). Waitlist and cancellation counts start from the day tracking was switched on.`), M, y);
  }

  // Page numbers and the privacy line.
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(...MUTED);
    pdf.text("Counts and percentages only. No client names, health details or payments are shown in this report.", M, H - 16);
    pdf.text(`Page ${i} of ${pages}`, W - M, H - 16, { align: "right" });
  }
  return pdf.output("blob");
}
