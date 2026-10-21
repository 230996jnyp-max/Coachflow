import type { MuscleGroup } from "@/lib/types";

/** Stylised front/back body with the worked muscles highlighted (primary = red, secondary = amber). */

type Role = "primary" | "secondary" | "none";

const FILL: Record<Role, string> = { primary: "#EF4444", secondary: "#F59E0B", none: "#2B3448" };
const BASE = "#1B2232";
const STROKE = "#0E131D";

interface Part {
  id: string;
  muscles: MuscleGroup[];
  shape: { t: "ellipse"; cx: number; cy: number; rx: number; ry: number } | { t: "path"; d: string } | { t: "rect"; x: number; y: number; w: number; h: number; r: number };
}

const el = (cx: number, cy: number, rx: number, ry: number) => ({ t: "ellipse" as const, cx, cy, rx, ry });
const pa = (d: string) => ({ t: "path" as const, d });
const rc = (x: number, y: number, w: number, h: number, r: number) => ({ t: "rect" as const, x, y, w, h, r });

const FRONT: Part[] = [
  { id: "f-traps", muscles: ["Traps"], shape: pa("M82,62 L100,54 L118,62 L130,76 L70,76 Z") },
  { id: "f-delt-l", muscles: ["Front Delts", "Side Delts"], shape: el(56, 90, 15, 19) },
  { id: "f-delt-r", muscles: ["Front Delts", "Side Delts"], shape: el(144, 90, 15, 19) },
  { id: "f-chest-l", muscles: ["Chest"], shape: pa("M72,80 Q98,76 99,98 Q98,116 76,114 Q64,100 72,80 Z") },
  { id: "f-chest-r", muscles: ["Chest"], shape: pa("M128,80 Q102,76 101,98 Q102,116 124,114 Q136,100 128,80 Z") },
  { id: "f-abs", muscles: ["Abdominals"], shape: rc(86, 118, 28, 72, 9) },
  { id: "f-obl-l", muscles: ["Obliques"], shape: pa("M72,118 L85,120 L85,192 L76,186 Q66,152 72,118 Z") },
  { id: "f-obl-r", muscles: ["Obliques"], shape: pa("M128,118 L115,120 L115,192 L124,186 Q134,152 128,118 Z") },
  { id: "f-bi-l", muscles: ["Biceps"], shape: el(38, 130, 11, 26) },
  { id: "f-bi-r", muscles: ["Biceps"], shape: el(162, 130, 11, 26) },
  { id: "f-fa-l", muscles: ["Forearms"], shape: el(30, 192, 9, 26) },
  { id: "f-fa-r", muscles: ["Forearms"], shape: el(170, 192, 9, 26) },
  { id: "f-quad-l", muscles: ["Quadriceps"], shape: pa("M72,204 Q66,262 76,306 L97,306 Q103,258 98,204 Z") },
  { id: "f-quad-r", muscles: ["Quadriceps"], shape: pa("M128,204 Q134,262 124,306 L103,306 Q97,258 102,204 Z") },
  { id: "f-calf-l", muscles: ["Calves"], shape: el(85, 348, 11, 34) },
  { id: "f-calf-r", muscles: ["Calves"], shape: el(115, 348, 11, 34) },
];

const BACK: Part[] = [
  { id: "b-traps", muscles: ["Traps"], shape: pa("M84,60 L100,54 L116,60 L134,82 L100,128 L66,82 Z") },
  { id: "b-delt-l", muscles: ["Rear Delts", "Side Delts"], shape: el(56, 90, 15, 19) },
  { id: "b-delt-r", muscles: ["Rear Delts", "Side Delts"], shape: el(144, 90, 15, 19) },
  { id: "b-upper", muscles: ["Upper Back"], shape: pa("M76,98 L124,98 L120,134 L80,134 Z") },
  { id: "b-lat-l", muscles: ["Lats"], shape: pa("M68,100 L82,132 L88,182 L70,164 Q62,132 68,100 Z") },
  { id: "b-lat-r", muscles: ["Lats"], shape: pa("M132,100 L118,132 L112,182 L130,164 Q138,132 132,100 Z") },
  { id: "b-lower", muscles: ["Lower Back"], shape: rc(86, 148, 28, 40, 7) },
  { id: "b-tri-l", muscles: ["Triceps"], shape: el(38, 130, 11, 26) },
  { id: "b-tri-r", muscles: ["Triceps"], shape: el(162, 130, 11, 26) },
  { id: "b-fa-l", muscles: ["Forearms"], shape: el(30, 192, 9, 26) },
  { id: "b-fa-r", muscles: ["Forearms"], shape: el(170, 192, 9, 26) },
  { id: "b-glute-l", muscles: ["Glutes"], shape: el(86, 214, 18, 20) },
  { id: "b-glute-r", muscles: ["Glutes"], shape: el(114, 214, 18, 20) },
  { id: "b-ham-l", muscles: ["Hamstrings"], shape: pa("M70,238 Q66,284 78,322 L97,322 Q101,282 98,238 Z") },
  { id: "b-ham-r", muscles: ["Hamstrings"], shape: pa("M130,238 Q134,284 122,322 L103,322 Q99,282 102,238 Z") },
  { id: "b-calf-l", muscles: ["Calves"], shape: el(85, 352, 12, 32) },
  { id: "b-calf-r", muscles: ["Calves"], shape: el(115, 352, 12, 32) },
];

function roleFor(muscles: MuscleGroup[], primary: MuscleGroup, secondary: MuscleGroup[]): Role {
  if (primary === "Full Body") return "secondary";
  if (primary === "Cardio") return muscles.some((m) => (["Quadriceps", "Hamstrings", "Glutes", "Calves"] as MuscleGroup[]).includes(m) || secondary.includes(m)) ? "secondary" : "none";
  if (muscles.includes(primary)) return "primary";
  if (muscles.some((m) => secondary.includes(m))) return "secondary";
  return "none";
}

function Shape({ part, role }: { part: Part; role: Role }) {
  const common = { fill: FILL[role], stroke: STROKE, strokeWidth: 1.5 };
  const s = part.shape;
  if (s.t === "ellipse") return <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} {...common} />;
  if (s.t === "rect") return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} {...common} />;
  return <path d={s.d} {...common} strokeLinejoin="round" />;
}

function Figure({ parts, primary, secondary, label }: { parts: Part[]; primary: MuscleGroup; secondary: MuscleGroup[]; label: string }) {
  return (
    <g>
      {/* body base */}
      <circle cx={100} cy={30} r={19} fill={BASE} stroke={STROKE} strokeWidth={1.5} />
      <rect x={91} y={47} width={18} height={18} rx={5} fill={BASE} />
      <path d="M62,72 Q100,60 138,72 L132,205 Q100,216 68,205 Z" fill={BASE} stroke={STROKE} strokeWidth={1.5} />
      <path d="M70,200 L98,200 L97,382 L77,382 Z M130,200 L102,200 L103,382 L123,382 Z" fill={BASE} stroke={STROKE} strokeWidth={1.5} />
      <circle cx={28} cy={222} r={8} fill={BASE} />
      <circle cx={172} cy={222} r={8} fill={BASE} />
      <ellipse cx={85} cy={388} rx={12} ry={5} fill={BASE} />
      <ellipse cx={115} cy={388} rx={12} ry={5} fill={BASE} />
      {parts.map((p) => (
        <Shape key={p.id} part={p} role={roleFor(p.muscles, primary, secondary)} />
      ))}
      <text x={100} y={408} textAnchor="middle" fontSize={11} fontWeight={700} fill="#8892A6" letterSpacing={1.5}>
        {label}
      </text>
    </g>
  );
}

export function MuscleMap({ primary, secondary, className }: { primary: MuscleGroup; secondary: MuscleGroup[]; className?: string }) {
  return (
    <div className={className}>
      <svg viewBox="0 0 420 415" role="img" aria-label={`Muscles worked: ${primary}${secondary.length ? ", also " + secondary.join(", ") : ""}`} className="mx-auto h-auto w-full max-w-sm">
        <Figure parts={FRONT} primary={primary} secondary={secondary} label="FRONT" />
        <g transform="translate(220,0)">
          <Figure parts={BACK} primary={primary} secondary={secondary} label="BACK" />
        </g>
      </svg>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: FILL.primary }} /> Primary: <span className="font-semibold text-ink">{primary}</span>
        </span>
        {secondary.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: FILL.secondary }} /> Secondary: <span className="font-semibold text-ink">{secondary.join(", ")}</span>
          </span>
        )}
      </div>
    </div>
  );
}
