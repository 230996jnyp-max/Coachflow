"use client";

import { format, parseISO } from "date-fns";
import { Camera, Check, ClipboardList, History, Keyboard, Loader2, Plus, ScanBarcode, Search, Sparkles, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NumberInput } from "@/components/NumberInput";
import { Button, Field, Input, Modal, Notice, Segmented, Tabs, Textarea } from "@/components/ui";
import { searchCommonFoods } from "@/lib/commonFoods";
import { MEALS, recentFoods, sumMacros, type Candidate, type DietaryProfile, type FoodEntry, type MealType, type PackagedFood } from "@/lib/nutrition";
import { useSyncStatus } from "@/lib/syncStatus";
import { candidateFromCommon, candidateFromEntry, candidateFromEstimate, candidateFromPackaged, estimateFood, lookupBarcode, manualCandidate, saveCandidates, searchPackaged, shrinkImage } from "@/lib/nutritionClient";
import { FoodEditor } from "./FoodEditor";
import { Scanner } from "./Scanner";

type Tab = "photo" | "describe" | "search" | "scan" | "recent" | "manual";
type Add = (list: Candidate[], opts?: { review?: boolean; note?: string }) => void;

/** Add food to a day: from a photo, a few words, a search, a barcode, a recent food or by typing the numbers. Everything ends in one review step. */
export function AddFood({ day, initialMeal, entries, profile, onClose, onSaved }: { day: string; initialMeal: MealType; entries: FoodEntry[]; profile: Pick<DietaryProfile, "diets" | "allergies">; onClose: () => void; onSaved: () => void }) {
  const { online } = useSyncStatus();
  // With no signal the photo, describe and scan tabs (they ask the server) can't work, so it opens on the built-in foods.
  const [tab, setTab] = useState<Tab>(() => (online ? "photo" : "search"));
  const [basket, setBasket] = useState<Candidate[]>([]);
  const [review, setReview] = useState(false);
  const [note, setNote] = useState("");
  const [meal, setMeal] = useState<MealType>(initialMeal);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");

  const add: Add = (list, opts) => {
    if (list.length === 0) return;
    setBasket((b) => [...b, ...list]);
    if (opts?.note !== undefined) setNote(opts.note);
    if (opts?.review) setReview(true);
  };
  const total = sumMacros(basket);
  const save = async () => {
    setSaving(true);
    setError(null);
    const err = await saveCandidates(day, meal, basket);
    setSaving(false);
    if (err) setError(err);
    else onSaved();
  };

  const footer = review ? (
    <>
      <Button variant="secondary" onClick={() => setReview(false)} disabled={saving}>
        Add more
      </Button>
      <Button onClick={save} disabled={saving || basket.length === 0}>
        {saving ? "Saving…" : `Save ${basket.length} food${basket.length === 1 ? "" : "s"} · ${total.kcal} kcal`}
      </Button>
    </>
  ) : basket.length > 0 ? (
    <Button onClick={() => setReview(true)}>Review {basket.length} food{basket.length === 1 ? "" : "s"} · {total.kcal} kcal →</Button>
  ) : undefined;

  return (
    <Modal open onClose={saving ? () => undefined : onClose} title={`Add food · ${format(parseISO(day), "EEE d MMM")}`} wide footer={footer}>
      {review ? (
        <div className="space-y-3">
          <Segmented value={meal} onChange={setMeal} options={MEALS.map((m) => ({ value: m.id, label: m.label }))} className="w-full" />
          {note && <Notice>{note}</Notice>}
          {error && <Notice tone="error">{error}</Notice>}
          {basket.map((c) => (
            <FoodEditor key={c.key} item={c} profile={profile} onChange={(x) => setBasket((b) => b.map((y) => (y.key === c.key ? x : y)))} onRemove={() => setBasket((b) => b.filter((y) => y.key !== c.key))} />
          ))}
          {basket.length === 0 && <p className="py-6 text-center text-sm text-muted">Nothing here yet. Go back and add a food.</p>}
          {basket.some((c) => c.approx) && <p className="text-xs text-muted">Foods marked “approx.” are estimates. Check the amount and the numbers before you save, and change anything that looks off.</p>}
        </div>
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "photo", label: "Photo", icon: <Camera size={16} /> },
              { value: "describe", label: "Describe", icon: <Type size={16} /> },
              { value: "search", label: "Search", icon: <Search size={16} /> },
              { value: "scan", label: "Scan", icon: <ScanBarcode size={16} /> },
              { value: "recent", label: "Recent", icon: <History size={16} /> },
              { value: "manual", label: "Manual", icon: <Keyboard size={16} /> },
            ]}
          />
          {!online && (tab === "photo" || tab === "describe" || tab === "scan") && <Notice>No signal. This needs the server. Search (the built-in foods), Recent and Manual work offline, and what you save waits on your phone until you are back online.</Notice>}
          {tab === "photo" && <PhotoTab meal={meal} onAdd={add} />}
          {tab === "describe" && <DescribeTab meal={meal} onAdd={add} />}
          {tab === "search" && (
            <SearchTab
              meal={meal}
              basket={basket}
              onAdd={add}
              onManual={(name) => {
                setManualName(name);
                setTab("manual");
              }}
            />
          )}
          {tab === "scan" && <ScanTab onAdd={add} />}
          {tab === "recent" && <RecentTab entries={entries} basket={basket} onAdd={add} />}
          {tab === "manual" && <ManualTab key={manualName} initialName={manualName} onAdd={add} />}
        </>
      )}
    </Modal>
  );
}

/* ---------------- Photo ---------------- */
function PhotoTab({ meal, onAdd }: { meal: MealType; onAdd: Add }) {
  const input = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      setImage(await shrinkImage(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That photo couldn't be opened.");
    }
  };
  const run = async () => {
    if (!image) return;
    setBusy(true);
    setError(null);
    const r = await estimateFood({ image, text: caption.trim() || undefined, meal });
    setBusy(false);
    if ("error" in r) return setError(r.error);
    if (r.estimate.items.length === 0) return setError(r.estimate.note || "I couldn't find any food in that photo. Try another photo or describe it.");
    onAdd(r.estimate.items.map((i) => candidateFromEstimate(i, "AI_PHOTO")), { review: true, note: r.estimate.note });
  };

  return (
    <div className="space-y-3">
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="Your meal" className="max-h-64 w-full rounded-2xl border border-line object-cover" />
      ) : (
        <button type="button" onClick={() => input.current?.click()} className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line text-muted hover:border-accent hover:text-accent">
          <Camera size={28} />
          <span className="text-sm font-semibold">Take or choose a photo of your meal</span>
        </button>
      )}
      {image && (
        <>
          <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Anything the photo doesn’t show? (optional)" maxLength={200} />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
              Another photo
            </Button>
            <Button className="flex-1" onClick={run} disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {busy ? "Estimating…" : "Estimate this meal"}
            </Button>
          </div>
        </>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <p className="text-xs text-muted">The AI estimates what’s on the plate and you check it before saving. Your photo is read once and not kept.</p>
    </div>
  );
}

/* ---------------- Describe ---------------- */
const EXAMPLES = ["2 eggs on toast and a flat white", "chicken rice, one plate", "a bowl of ramen and a can of cola", "protein shake with banana and oats"];

function DescribeTab({ meal, onAdd }: { meal: MealType; onAdd: Add }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    const r = await estimateFood({ text: text.trim(), meal });
    setBusy(false);
    if ("error" in r) return setError(r.error);
    if (r.estimate.items.length === 0) return setError(r.estimate.note || "I couldn't find any food in that. Try describing it differently.");
    onAdd(r.estimate.items.map((i) => candidateFromEstimate(i, "AI_TEXT")), { review: true, note: r.estimate.note });
  };
  return (
    <div className="space-y-3">
      <Field label="What did you eat?" hint="Any food, any cuisine. Include amounts if you know them.">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 2 eggs on toast and a flat white" maxLength={600} rows={3} />
      </Field>
      <div className="flex flex-wrap gap-1.5">
        {EXAMPLES.map((x) => (
          <button key={x} type="button" onClick={() => setText(x)} className="rounded-full border border-line bg-field px-3 py-1.5 text-xs text-muted hover:text-ink">
            {x}
          </button>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Button className="w-full" onClick={run} disabled={busy || text.trim().length < 2}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {busy ? "Estimating…" : "Estimate"}
      </Button>
    </div>
  );
}

/* ---------------- Search ---------------- */
function SearchTab({ meal, basket, onAdd, onManual }: { meal: MealType; basket: Candidate[]; onAdd: Add; onManual: (name: string) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ q: string; foods: PackagedFood[]; unavailable: boolean }>({ q: "", foods: [], unavailable: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = q.trim();
  const common = query.length >= 2 ? searchCommonFoods(query, 8) : [];
  const packaged = res.q === query ? res.foods : [];
  const searching = query.length >= 2 && res.q !== query;

  useEffect(() => {
    if (query.length < 2) return;
    let alive = true;
    const t = setTimeout(() => {
      void searchPackaged(query).then((r) => alive && setRes({ q: query, foods: r.foods, unavailable: r.unavailable }));
    }, 450);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);

  const has = (name: string, brand?: string) => basket.some((b) => b.name === name && b.brand === brand);
  const ai = async () => {
    setBusy(true);
    setError(null);
    const r = await estimateFood({ text: query, meal });
    setBusy(false);
    if ("error" in r) return setError(r.error);
    if (r.estimate.items.length === 0) return setError(r.estimate.note || "I couldn't work that out. Try describing it with more words.");
    onAdd(r.estimate.items.map((i) => candidateFromEstimate(i, "AI_TEXT")), { review: true, note: r.estimate.note });
  };

  const row = (key: string, name: string, sub: string, kcal: number, added: boolean, onClick: () => void) => (
    <button key={key} type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-accent/60">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{name}</div>
        <div className="truncate text-xs text-muted">{sub}</div>
      </div>
      <div className="shrink-0 text-right text-sm font-bold tabular-nums">{kcal}<span className="ml-0.5 text-[10px] font-semibold text-muted">kcal</span></div>
      <span className={added ? "text-success" : "text-accent"}>{added ? <Check size={18} /> : <Plus size={18} />}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a food, e.g. banana, salmon, pad thai" autoFocus maxLength={80} />
      {query.length < 2 && <p className="py-4 text-center text-sm text-muted">Type at least two letters. Everyday foods from many cuisines are built in, and packaged foods come from Open Food Facts.</p>}
      {common.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Everyday foods</div>
          {common.map((f) => row(f.id, f.name, `${f.servingLabel} (${f.servingGrams} g)${f.dish ? " · typical values" : ""}`, Math.round((f.per100.kcal * f.servingGrams) / 100), has(f.name, undefined), () => onAdd([candidateFromCommon(f)])))}
        </div>
      )}
      {query.length >= 2 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-muted">
            Packaged foods {searching && <Loader2 size={12} className="animate-spin" />}
          </div>
          {packaged.map((p, i) => row(`${p.code ?? i}`, p.name, `${p.brand ? `${p.brand} · ` : ""}${p.servingGrams ? `${p.servingGrams} g serving` : "per 100 g"}`, Math.round((p.per100.kcal * (p.servingGrams ?? 100)) / 100), has(p.name, p.brand), () => onAdd([candidateFromPackaged(p, "SEARCH")])))}
          {!searching && packaged.length === 0 && <p className="text-xs text-muted">{res.unavailable ? "The packaged-food database didn’t answer. The built-in foods above still work." : "No packaged foods found."}</p>}
        </div>
      )}
      {query.length >= 2 && (
        <div className="space-y-2 border-t border-line pt-3">
          {error && <Notice tone="error">{error}</Notice>}
          <Button variant="outline" className="w-full" onClick={ai} disabled={busy || query.length < 3}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Not here? Estimate “{query}” with AI
          </Button>
          <button type="button" onClick={() => onManual(query)} className="block w-full py-1 text-center text-xs font-semibold text-accent">
            Or enter the numbers yourself
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Scan ---------------- */
function ScanTab({ onAdd }: { onAdd: Add }) {
  const [scanning, setScanning] = useState(true);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const lookup = async (c: string) => {
    setScanning(false);
    setBusy(true);
    setMessage(null);
    const r = await lookupBarcode(c);
    setBusy(false);
    if ("error" in r) return setMessage(r.error);
    if (!r.food) return setMessage(`No product found for ${c}. Try searching by name, or take a photo.`);
    onAdd([candidateFromPackaged(r.food, "BARCODE")], { review: true });
  };

  return (
    <div className="space-y-3">
      {scanning && <Scanner onCode={(c) => void lookup(c)} />}
      {!scanning && (
        <Button variant="secondary" className="w-full" onClick={() => setScanning(true)} disabled={busy}>
          <ScanBarcode size={16} /> Scan again
        </Button>
      )}
      <Field label="Or type the barcode number">
        <div className="flex gap-2">
          <Input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 14))} inputMode="numeric" placeholder="e.g. 3017620422003" />
          <Button onClick={() => void lookup(code)} disabled={busy || code.length < 8}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : "Look up"}
          </Button>
        </div>
      </Field>
      {message && <Notice tone="warn">{message}</Notice>}
    </div>
  );
}

/* ---------------- Recent ---------------- */
function RecentTab({ entries, basket, onAdd }: { entries: FoodEntry[]; basket: Candidate[]; onAdd: Add }) {
  const list = recentFoods(entries, 15);
  if (list.length === 0) return <p className="py-8 text-center text-sm text-muted">Foods you log will show up here for one-tap adding.</p>;
  return (
    <div className="space-y-1.5">
      {list.map((e) => {
        const added = basket.some((b) => b.name === e.name && b.brand === e.brand);
        return (
          <button key={e.id} type="button" onClick={() => onAdd([candidateFromEntry(e)])} className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left hover:border-accent/60">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{e.name}</div>
              <div className="truncate text-xs text-muted">{e.amountText || "1 serving"}{e.approx ? " · approx." : ""}</div>
            </div>
            <div className="shrink-0 text-sm font-bold tabular-nums">{e.kcal}<span className="ml-0.5 text-[10px] font-semibold text-muted">kcal</span></div>
            <span className={added ? "text-success" : "text-accent"}>{added ? <Check size={18} /> : <Plus size={18} />}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Manual ---------------- */
function ManualTab({ initialName, onAdd }: { initialName: string; onAdd: Add }) {
  const [name, setName] = useState(initialName);
  const [amount, setAmount] = useState("");
  const [kcal, setKcal] = useState<number | undefined>(undefined);
  const [protein, setProtein] = useState<number | undefined>(0);
  const [carbs, setCarbs] = useState<number | undefined>(0);
  const [fat, setFat] = useState<number | undefined>(0);
  const ok = name.trim().length > 0 && (kcal ?? 0) >= 0 && kcal !== undefined;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <ClipboardList size={14} /> For when you know the numbers (a label, a restaurant menu).
      </div>
      <Field label="Food">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Protein bar" maxLength={120} />
      </Field>
      <Field label="How much (optional)">
        <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1 bar, 60 g" maxLength={80} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Calories">
          <NumberInput label="Calories" min={0} max={6000} step={10} allowEmpty value={kcal} onChange={setKcal} />
        </Field>
        <Field label="Protein g">
          <NumberInput label="Protein in grams" min={0} max={1000} decimals={1} value={protein} onChange={setProtein} />
        </Field>
        <Field label="Carbs g">
          <NumberInput label="Carbs in grams" min={0} max={1000} decimals={1} value={carbs} onChange={setCarbs} />
        </Field>
        <Field label="Fat g">
          <NumberInput label="Fat in grams" min={0} max={1000} decimals={1} value={fat} onChange={setFat} />
        </Field>
      </div>
      <Button className="w-full" disabled={!ok} onClick={() => onAdd([manualCandidate({ name: name.trim(), amountText: amount.trim(), kcal: kcal ?? 0, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 })], { review: true })}>
        Add
      </Button>
    </div>
  );
}
