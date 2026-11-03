"use client";

import { AlertTriangle, Trash2 } from "lucide-react";
import { NumberInput } from "@/components/NumberInput";
import { Badge, Card, IconButton, Input } from "@/components/ui";
import { dietConflicts, r0, r1, rescaleEntry, type Candidate, type DietaryProfile, type FoodEntry } from "@/lib/nutrition";
import { cn } from "@/lib/utils";

type Editable = Candidate | FoodEntry;

const CONFIDENCE: Record<string, string> = { high: "Good estimate", medium: "Rough estimate", low: "Very rough" };

/** Whatever was typed into a number box wins; per-100 g values are kept in step so the amount can still be changed in grams. */
function withNumbers<T extends Editable>(x: T, patch: Partial<Pick<Editable, "kcal" | "protein" | "carbs" | "fat">>): T {
  const next = { ...x, ...patch } as T;
  if (next.grams && next.grams > 0) {
    const f = 100 / next.grams;
    next.per100 = { kcal: r0(next.kcal * f), protein: r1(next.protein * f), carbs: r1(next.carbs * f), fat: r1(next.fat * f) };
  }
  return next;
}

/** One food: its name, how much, and the numbers, with any diet or allergy warnings and an honest "approx." label for estimates. */
export function FoodEditor<T extends Editable>({ item, onChange, onRemove, profile }: { item: T; onChange: (x: T) => void; onRemove?: () => void; profile: Pick<DietaryProfile, "diets" | "allergies"> }) {
  const warnings = dietConflicts(profile, item.contains);
  const scale = (factor: number) => onChange(rescaleEntry(item as FoodEntry, { factor }) as unknown as T);
  return (
    <Card className="space-y-3 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Input value={item.name} onChange={(e) => onChange({ ...item, name: e.target.value })} aria-label="Food name" maxLength={120} className="h-10 font-semibold" />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            {item.brand && <span>{item.brand}</span>}
            {item.approx && <Badge className="border-pr/30 bg-pr/10 text-pr">approx.{item.confidence ? ` · ${CONFIDENCE[item.confidence]}` : ""}</Badge>}
            {!item.approx && item.source === "BARCODE" && <Badge>from the barcode</Badge>}
            <span>{item.amountText}</span>
          </div>
        </div>
        {onRemove && (
          <IconButton label="Remove this food" onClick={onRemove} className="-mr-2 -mt-1">
            <Trash2 size={18} />
          </IconButton>
        )}
      </div>

      {warnings.map((w) => (
        <div key={w} className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs font-semibold text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {w}
        </div>
      ))}

      <div className="flex flex-wrap items-end gap-2">
        {item.per100 && (
          <div className="w-36">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted">Amount (g)</div>
            <NumberInput label="Amount in grams" min={1} max={5000} step={10} value={item.grams} onChange={(v) => v && onChange(rescaleEntry(item as FoodEntry, { grams: v }) as unknown as T)} compact />
          </div>
        )}
        <div className="flex gap-1.5">
          {([["Half", 0.5], ["−¼", 0.75], ["+¼", 1.25], ["Double", 2]] as const).map(([label, f]) => (
            <button key={label} type="button" onClick={() => scale(f)} className="min-h-10 rounded-lg border border-line bg-field px-2.5 text-xs font-semibold text-muted hover:text-ink">
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["kcal", "Calories", 0, 6000, 0], ["protein", "Protein g", 0, 1000, 1], ["carbs", "Carbs g", 0, 1000, 1], ["fat", "Fat g", 0, 1000, 1]] as const).map(([k, label, min, max, dec]) => (
          <div key={k}>
            <div className={cn("mb-1 text-[10px] font-bold uppercase tracking-wider text-muted")}>{label}</div>
            <NumberInput label={label} min={min} max={max} decimals={dec} step={dec ? 1 : 10} value={item[k]} onChange={(v) => onChange(withNumbers(item, { [k]: v ?? 0 }))} compact />
          </div>
        ))}
      </div>
    </Card>
  );
}
