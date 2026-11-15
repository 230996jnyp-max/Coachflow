import { MOVEMENT_ITEMS, POSTURE_ITEMS, RATING_LABEL, SCORE_LABEL, TEST_FIELDS, type AssessmentData, type FocusArea, type PhotoView } from "@/lib/assessment";

/*
 * A printable page of an assessment (the browser's "Save as PDF" makes the PDF). Built as plain HTML so it needs no library, and opened
 * in its own window so the app itself isn't printed.
 */

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export interface PrintInput {
  brand: string;
  clientName: string;
  coachName: string;
  assessmentId: string;
  data: AssessmentData;
  focus: FocusArea[];
  photos: PhotoView[];
  includePhotos: boolean;
  summary?: string | null;
  filledBy: "COACH" | "CLIENT";
}

export function assessmentHtml(p: PrintInput): string {
  const d = p.data;
  const postureRows = POSTURE_ITEMS.filter((i) => d.posture[i.id]?.rating)
    .map((i) => `<tr><td>${esc(i.label)}</td><td>${esc(RATING_LABEL[d.posture[i.id].rating as "normal"])}</td><td>${esc(d.posture[i.id].note)}</td></tr>`)
    .join("");
  const otherRows = d.others
    .filter((o) => o.rating)
    .map((o) => `<tr><td>${esc(o.name)}</td><td>${esc(RATING_LABEL[o.rating as "normal"])}</td><td>${esc(o.note)}</td></tr>`)
    .join("");
  const moveRows = MOVEMENT_ITEMS.filter((m) => d.movement[m.id])
    .map((m) => {
      const e = d.movement[m.id];
      const val = m.sided ? `Left ${e.left === null ? "-" : e.left} · Right ${e.right === null ? "-" : e.right}` : e.score === null ? "-" : `${e.score} (${SCORE_LABEL[e.score].split(" · ")[1]})`;
      return `<tr><td>${esc(m.label)}</td><td>${esc(val)}</td><td>${esc(e.note)}</td></tr>`;
    })
    .join("");
  const testRows = TEST_FIELDS.filter((t) => d.tests[t.id] !== undefined)
    .map((t) => `<tr><td>${esc(t.label)}</td><td>${esc(d.tests[t.id])} ${esc(t.unit)}</td><td></td></tr>`)
    .join("");
  const cardio = d.tests.cardioName || d.tests.cardioResult ? `<tr><td>${esc(d.tests.cardioName || "Cardio test")}</td><td>${esc(d.tests.cardioResult)}</td><td></td></tr>` : "";
  const table = (title: string, rows: string) => (rows ? `<h2>${esc(title)}</h2><table><thead><tr><th>Item</th><th>Result</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>` : "");
  const focus = p.focus.length
    ? `<h2>What to work on besides building muscle</h2><ol>${p.focus
        .map((f) => `<li><strong>${esc(f.area)}</strong> <span class="lvl ${f.level}">${f.level === "high" ? "Priority" : "Worth working on"}</span><br>${esc(f.why)}${f.exercises.length ? `<br><em>Exercises to look at:</em> ${esc(f.exercises.slice(0, 4).join(", "))}` : ""}${f.cues.length ? `<br><em>Also:</em> ${esc(f.cues.join(" · "))}` : ""}</li>`)
        .join("")}</ol>`
    : "";
  const photos =
    p.includePhotos && p.photos.length
      ? `<h2>Posture photos</h2><div class="ph">${p.photos.map((v) => `<figure><img src="/api/assessments/${esc(p.assessmentId)}/photos/${esc(v)}" alt="${esc(v)}"><figcaption>${esc(v)}</figcaption></figure>`).join("")}</div>`
      : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Posture and fitness assessment - ${esc(p.clientName)}</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:32px auto;max-width:760px;padding:0 20px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
.meta{color:#555;font-size:13px;margin-bottom:12px}table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #e3e3e3;vertical-align:top}th{color:#555;font-weight:600}
ol{padding-left:20px}li{margin:0 0 8px}.lvl{font-size:11px;border-radius:999px;padding:1px 8px;margin-left:6px}.lvl.high{background:#fde2e2;color:#9b1c1c}.lvl.medium{background:#fff1d6;color:#7a4b00}
.ph{display:flex;gap:12px}figure{margin:0;flex:1}img{width:100%;border-radius:8px}figcaption{text-align:center;font-size:12px;color:#555;text-transform:capitalize}
.note{background:#f5f5f5;border-radius:8px;padding:10px 12px;white-space:pre-wrap}.foot{margin-top:28px;color:#777;font-size:11px}
@media print{body{margin:0}}
</style></head><body>
<h1>Posture and fitness assessment</h1>
<div class="meta">${esc(p.clientName)} · ${esc(d.takenAt)} · ${p.filledBy === "CLIENT" ? "Filled in by the client" : `With ${esc(p.coachName)}`} · ${esc(p.brand)}</div>
${focus}
${p.summary ? `<h2>In plain words</h2><div class="note">${esc(p.summary)}</div>` : ""}
${table("Posture", postureRows)}${table("Others", otherRows)}${table("Movement", moveRows)}${table("Fitness tests", testRows + cardio)}
${d.pain ? `<h2>Pain or discomfort</h2><div class="note">${esc(d.pain)}</div>` : ""}
${d.coachNotes ? `<h2>Coach's notes</h2><div class="note">${esc(d.coachNotes)}</div>` : ""}
${d.clientNotes ? `<h2>Client's notes</h2><div class="note">${esc(d.clientNotes)}</div>` : ""}
${photos}
<div class="foot">This is a coaching record, not a medical assessment. It is private to the client and their coach.</div>
<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},300)})</script>
</body></html>`;
}

/** Opens the printable page in a new window (the person then chooses "Save as PDF" or a printer). Returns false if the window was blocked. */
export function openPrint(html: string): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
