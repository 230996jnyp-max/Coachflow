import "server-only";
import { unzipSync, strFromU8 } from "fflate";
import { getDocumentProxy, renderPageAsImage } from "unpdf";
import { aiConfigured, MAX_IMAGE_DATA_URL, transcribeImages } from "./ai";
import { HttpError } from "./http";
import { rowsToLines, type Row } from "../tableText";

/*
 * Turns an uploaded file (PDF, Word, Excel, CSV, text, RTF, HTML…) into plain text for the workout importer.
 * Tables are rebuilt as "Exercise - 4 x 8 @ 80kg" lines (see tableText.ts) so a spreadsheet or a CoachFlow PDF
 * re-imports as cleanly as a typed note.
 */

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 200_000;

export interface Extracted {
  text: string;
  kind: string;
  pages?: number;
}

const unsupported = (m: string) => new HttpError(415, m);

/* ---------------- Helpers ---------------- */
const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  const s = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

const looksBinary = (bytes: Uint8Array) => {
  const n = Math.min(bytes.length, 4000);
  let bad = 0;
  for (let i = 0; i < n; i++) if (bytes[i] === 0 || (bytes[i] < 9 && bytes[i] !== 0)) bad++;
  return n > 0 && bad / n > 0.02;
};

/** Plain-text lines → rows: pipe tables (Markdown) and tab-separated lines become cells, everything else a single cell. */
function textToRows(text: string): string[][] {
  const rows: string[][] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const cells = line.trim().slice(1, -1).split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue; // |---|---| separator
      rows.push(cells);
    } else if (line.includes("\t") && line.split("\t").filter((c) => c.trim()).length >= 3) {
      rows.push(line.split("\t").map((c) => c.trim()));
    } else rows.push([line]);
  }
  return rows;
}

/** Splits "Date: 12 Oct    Client: Ann" style label groups that a PDF or document put on one line. */
function splitLabelGroups(line: string): string[] {
  const parts = line.split(/\s{3,}/).filter(Boolean);
  if (parts.length >= 2 && parts.filter((p) => /^[A-Za-z][A-Za-z ]{1,20}:/.test(p)).length >= 2) return parts;
  return [line];
}

/* ---------------- CSV ---------------- */
function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/* ---------------- RTF / HTML ---------------- */
/** Drops RTF groups that hold no visible text (font table, colours, styles, document info, destinations). */
function stripRtfGroups(rtf: string): string {
  let out = "";
  let i = 0;
  while (i < rtf.length) {
    if (rtf[i] === "{" && /^\{\\(?:\*|fonttbl|colortbl|stylesheet|info|pict|header|footer|listtable|listoverridetable|generator)/.test(rtf.slice(i, i + 20))) {
      let depth = 0;
      for (; i < rtf.length; i++) {
        if (rtf[i] === "\\") i++;
        else if (rtf[i] === "{") depth++;
        else if (rtf[i] === "}" && --depth === 0) {
          i++;
          break;
        }
      }
      continue;
    }
    out += rtf[i++];
  }
  return out;
}

function rtfToText(rtf: string): string {
  return stripRtfGroups(rtf)
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\(par|line|row)\b ?/g, "\n")
    .replace(/\\(tab|cell)\b ?/g, "\t")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\\\\/g, "\\");
}

function htmlToRows(html: string): string[][] {
  const clean = html.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ");
  const rows: string[][] = [];
  const re = /<tr[\s\S]*?<\/tr>|<\/?(?:p|div|br|li|h[1-6]|ul|ol|section|article)\b[^>]*>/gi;
  let last = 0;
  const strip = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const flushText = (s: string) => {
    const t = strip(s);
    if (t) rows.push([t]);
  };
  for (const m of clean.matchAll(re)) {
    flushText(clean.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    if (/^<tr/i.test(m[0])) rows.push([...m[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map((c) => strip(c[0])));
  }
  flushText(clean.slice(last));
  return rows;
}

/* ---------------- DOCX ---------------- */
function xmlText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:(?:br|cr)\b[^>]*\/>/g, " ")
      .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, "$1\u0001")
      .replace(/<[^>]+>/g, "")
      .replace(/\u0001/g, ""),
  );
}

function docxRows(files: Record<string, Uint8Array>): string[][] {
  const doc = files["word/document.xml"];
  if (!doc) throw unsupported("That Word file looks damaged — I couldn't find its text.");
  const xml = strFromU8(doc);
  const rows: string[][] = [];
  // Walk the body in order: tables become rows of cells, paragraphs become single-cell rows.
  const re = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[\s\S]*?<\/w:p>/g;
  for (const m of xml.matchAll(re)) {
    if (m[0].startsWith("<w:tbl")) {
      for (const tr of m[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)) {
        rows.push([...tr[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((tc) => xmlText(tc[0]).replace(/\s+/g, " ").trim()));
      }
    } else rows.push([xmlText(m[0]).replace(/[ ]{2,}/g, " ").trim()]);
  }
  return rows;
}

/* ---------------- XLSX ---------------- */
const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

function xlsxSheets(files: Record<string, Uint8Array>): { name: string; rows: string[][] }[] {
  const wb = files["xl/workbook.xml"];
  if (!wb) throw unsupported("That Excel file looks damaged — I couldn't find its sheets.");
  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    for (const si of strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(decodeEntities([...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
    }
  }
  const rels = new Map<string, string>();
  if (files["xl/_rels/workbook.xml.rels"]) {
    for (const r of strFromU8(files["xl/_rels/workbook.xml.rels"]).matchAll(/<Relationship\b[^>]*>/g)) {
      const id = r[0].match(/\bId="([^"]+)"/)?.[1];
      const target = r[0].match(/\bTarget="([^"]+)"/)?.[1];
      if (id && target) rels.set(id, target.replace(/^\//, "").replace(/^(?!xl\/)/, "xl/"));
    }
  }
  const out: { name: string; rows: string[][] }[] = [];
  let i = 0;
  for (const s of strFromU8(wb).matchAll(/<sheet\b[^>]*>/g)) {
    i++;
    const name = decodeEntities(s[0].match(/\bname="([^"]*)"/)?.[1] ?? `Sheet ${i}`);
    const rid = s[0].match(/\br:id="([^"]+)"/)?.[1];
    const file = files[(rid && rels.get(rid)) || `xl/worksheets/sheet${i}.xml`];
    if (!file) continue;
    const rows: string[][] = [];
    for (const r of strFromU8(file).matchAll(/<row\b[\s\S]*?<\/row>/g)) {
      const cells: string[] = [];
      for (const c of r[0].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const body = c[2] ?? "";
        const idx = colIndex(attrs.match(/\br="([A-Z]+\d+)"/i)?.[1] ?? "A1");
        const type = attrs.match(/\bt="([^"]+)"/)?.[1];
        let val = "";
        if (type === "s") val = shared[Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1])] ?? "";
        else if (type === "inlineStr") val = decodeEntities([...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
        else val = decodeEntities(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "");
        if (/^-?\d+\.\d{6,}$/.test(val)) val = String(Math.round(Number(val) * 1000) / 1000);
        cells[idx] = val;
      }
      rows.push(Array.from(cells, (c) => c ?? ""));
    }
    out.push({ name, rows });
  }
  return out;
}

/* ---------------- PDF ---------------- */
interface PdfItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

async function pdfRows(bytes: Uint8Array, brand: string): Promise<{ rows: Row[]; pages: number; chars: number }> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "PasswordException") throw unsupported("That PDF is password-protected. Remove the password and try again.");
    throw unsupported("I couldn't open that PDF. It may be damaged.");
  }
  const rows: Row[] = [];
  const pages = Math.min(pdf.numPages, 40);
  let chars = 0;
  for (let p = 1; p <= pages; p++) {
    const page = await pdf.getPage(p);
    const height = page.getViewport({ scale: 1 }).height;
    const content = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const it of content.items as { str?: string; transform: number[]; width: number; height: number }[]) {
      if (typeof it.str !== "string" || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) || 10 });
      chars += it.str.length;
    }
    // Group into visual lines (same baseline), left to right.
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines: PdfItem[][] = [];
    for (const it of items) {
      const line = lines[lines.length - 1];
      if (line && Math.abs(line[0].y - it.y) <= Math.max(2.5, it.h * 0.35)) line.push(it);
      else lines.push([it]);
    }
    let skipAbove = Infinity;
    // CoachFlow's own PDFs carry a branded header band on every page; it is not part of the plan.
    const firstItem = lines[0]?.slice().sort((a, b) => a.x - b.x)[0]?.str.trim().toLowerCase();
    if (firstItem && brand && firstItem === brand.toLowerCase()) skipAbove = height - 95;
    for (const line of lines) {
      if (line[0].y > skipAbove) continue;
      line.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      const xs: number[] = [];
      let cur = line[0].str;
      let curX = line[0].x;
      for (let i = 1; i < line.length; i++) {
        const prev = line[i - 1];
        const gap = line[i].x - (prev.x + prev.w);
        if (gap > Math.max(9, prev.h * 0.9)) {
          cells.push(cur.trim());
          xs.push(curX);
          cur = line[i].str;
          curX = line[i].x;
        } else cur += (gap > 1 ? " " : "") + line[i].str;
      }
      cells.push(cur.trim());
      xs.push(curX);
      const row: Row = cells;
      row.xs = xs;
      rows.push(row);
    }
    rows.push([""]);
  }
  return { rows, pages, chars };
}

/** A PDF with no selectable text (a scan or photo): render its first pages and let the vision AI transcribe them. */
async function scannedPdfRows(bytes: Uint8Array): Promise<{ rows: Row[]; pages: number }> {
  if (!aiConfigured()) {
    throw unsupported("That PDF has no selectable text (it looks like a scan or a photo), and AI reading isn't set up. Paste the text instead.");
  }
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages = Math.min(pdf.numPages, 4);
  const images: string[] = [];
  try {
    for (let p = 1; p <= pages; p++) {
      let url = await renderPageAsImage(pdf, p, { canvasImport: () => import("@napi-rs/canvas"), scale: 1.6, toDataURL: true });
      if (url.length > MAX_IMAGE_DATA_URL) url = await renderPageAsImage(pdf, p, { canvasImport: () => import("@napi-rs/canvas"), scale: 1, toDataURL: true });
      images.push(url);
    }
  } catch (e) {
    console.error("Could not render PDF pages", e);
    throw unsupported("I couldn't read the pages of that scanned PDF. Try uploading a photo or screenshot of the plan instead.");
  }
  return { rows: textToRows(await transcribeImages(images)), pages };
}

/* ---------------- Entry point ---------------- */
const ext = (name: string) => name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";

function finish(rows: Row[], kind: string, pages?: number): Extracted {
  const lines: string[] = [];
  for (const l of rowsToLines(rows)) lines.push(...splitLabelGroups(l));
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw unsupported("I couldn't find any text in that file.");
  return { text: text.slice(0, MAX_TEXT), kind, pages };
}

export async function extractFile(name: string, bytes: Uint8Array, brand: string): Promise<Extracted> {
  const e = ext(name);
  const head = String.fromCharCode(...bytes.subarray(0, 8));

  if (head.startsWith("%PDF") || e === "pdf") {
    const { rows, pages, chars } = await pdfRows(bytes, brand);
    if (chars >= 20) return finish(rows, "PDF", pages);
    const scan = await scannedPdfRows(bytes);
    return finish(scan.rows, "Scanned PDF (read by AI)", scan.pages);
  }

  if (head.startsWith("PK") || ["docx", "xlsx", "xlsm", "odt", "ods", "pptx"].includes(e)) {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes, { filter: (f) => /^(word\/document\.xml|xl\/|content\.xml)/.test(f.name) });
    } catch {
      throw unsupported("I couldn't open that file. It may be damaged.");
    }
    if (files["word/document.xml"]) return finish(docxRows(files), "Word document");
    if (files["xl/workbook.xml"]) {
      const sheets = xlsxSheets(files);
      const rows: string[][] = [];
      for (const s of sheets) {
        if (sheets.length > 1 && s.rows.length) rows.push([`# ${s.name}`]);
        rows.push(...s.rows, [""]);
      }
      return finish(rows, "Excel workbook");
    }
    if (files["content.xml"]) {
      const xml = strFromU8(files["content.xml"]).replace(/<text:tab\/>/g, "\t").replace(/<\/text:(?:p|h)>|<text:line-break\/>/g, "\n").replace(/<[^>]+>/g, "");
      return finish(textToRows(decodeEntities(xml)), "OpenDocument file");
    }
    throw unsupported("I can read Word (.docx), Excel (.xlsx), PDF, CSV, text, RTF and HTML files. PowerPoint isn't supported.");
  }

  if (head.startsWith("ÐÏ\u0011à")) throw unsupported("Old Word/Excel formats (.doc / .xls) can't be read. Save the file as .docx / .xlsx or PDF and try again.");
  if (/^(\x89PNG|\xff\xd8\xff|GIF8|RIFF)/.test(head) || ["png", "jpg", "jpeg", "gif", "webp", "heic", "heif", "bmp", "tiff"].includes(e)) {
    const mime = head.startsWith("\x89PNG") ? "png" : head.startsWith("\xff\xd8\xff") ? "jpeg" : head.startsWith("RIFF") ? "webp" : "";
    if (!mime) throw unsupported("That picture format isn't supported. Use a JPG, PNG or WebP photo or screenshot.");
    if (!aiConfigured()) throw unsupported("Photos can only be read when AI reading is set up. Paste the text instead.");
    const url = `data:image/${mime};base64,${Buffer.from(bytes).toString("base64")}`;
    if (url.length > MAX_IMAGE_DATA_URL) throw unsupported("That photo is too large. Try a smaller screenshot or photo (under about 2.5 MB).");
    return finish(textToRows(await transcribeImages([url])), "Photo (read by AI)");
  }
  if (looksBinary(bytes)) throw unsupported("I can't read that kind of file. Try PDF, Word (.docx), Excel (.xlsx), CSV, text, RTF or HTML.");

  const text = decodeText(bytes);
  if (e === "csv" || e === "tsv") return finish(parseCsv(text), e === "tsv" ? "TSV" : "CSV");
  if (e === "rtf" || text.startsWith("{\\rtf")) return finish(textToRows(rtfToText(text)), "RTF");
  if (e === "html" || e === "htm" || /^\s*<(!doctype|html)/i.test(text)) return finish(htmlToRows(text), "HTML");
  return finish(textToRows(text), "Text");
}
