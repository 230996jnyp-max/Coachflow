"use client";

import { Calculator } from "lucide-react";
import { useState } from "react";
import { NumberInput } from "@/components/NumberInput";
import { Button, Field, Input, Modal, Notice, Segmented, Select } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { ACTIVITY_LABEL, ALLERGIES, atwater, calcTargets, DIETS, DISCLAIMER, type Activity, type CalcGoal, type DietaryProfile, type NutritionTargets, type Sex } from "@/lib/nutrition";
import { saveSettings, saveTargets } from "@/lib/nutritionClient";
import { fromCm, fromKg, lengthUnit, toCm, toKg, weightUnit, cn } from "@/lib/utils";

function Chips({ options, value, onToggle }: { options: string[]; value: string[]; onToggle: (o: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} type="button" aria-pressed={on} onClick={() => onToggle(o)} className={cn("min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors", on ? "border-accent bg-accent/15 text-accent" : "border-line bg-field text-muted hover:text-ink")}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** My diet and allergies, my calorie and macro targets (unless my coach set them), and the "18 or older" answer. */
export function NutritionSettings({ settings, targets, onClose, onChanged }: { settings: DietaryProfile; targets: NutritionTargets | null; onClose: () => void; onChanged: () => void }) {
  const { unit } = useViewer();
  const [diets, setDiets] = useState(settings.diets);
  const [allergies, setAllergies] = useState(settings.allergies);
  const [other, setOther] = useState(settings.other);
  const [adult, setAdult] = useState<boolean | null>(settings.adult);
  const [kcal, setKcal] = useState<number | undefined>(targets?.kcal);
  const [protein, setProtein] = useState<number | undefined>(targets?.protein);
  const [carbs, setCarbs] = useState<number | undefined>(targets?.carbs);
  const [fat, setFat] = useState<number | undefined>(targets?.fat);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [calc, setCalc] = useState(false);
  const [sex, setSex] = useState<Sex>("male");
  const [age, setAge] = useState<number | undefined>(undefined);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const [weight, setWeight] = useState<number | undefined>(undefined);
  const [activity, setActivity] = useState<Activity>("moderate");
  const [goal, setGoal] = useState<CalcGoal>("maintain");
  const [calcNotes, setCalcNotes] = useState<string[]>([]);

  const coachSet = targets?.setBy === "COACH";
  const minor = adult === false;
  const toggle = (list: string[], set: (v: string[]) => void, key: "diets" | "allergies") => (o: string) => {
    const next = list.includes(o) ? list.filter((x) => x !== o) : [...list, o];
    set(next);
    void saveSettings({ [key]: next }).then((e) => e && setMsg({ tone: "error", text: e }));
  };

  const runCalc = () => {
    const r = calcTargets({ sex, age: age ?? 0, heightCm: toCm(height ?? 0, unit), weightKg: toKg(weight ?? 0, unit), activity, goal });
    if (!r.ok) return setMsg({ tone: "error", text: r.error });
    setKcal(r.targets.kcal);
    setProtein(r.targets.protein);
    setCarbs(r.targets.carbs);
    setFat(r.targets.fat);
    setCalcNotes([`Your body burns about ${r.maintenance} kcal a day at this activity level.`, ...r.notes]);
    setMsg(null);
  };

  const saveT = async () => {
    setBusy(true);
    setMsg(null);
    const err = await saveTargets({ kcal: kcal ?? 0, protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 });
    setBusy(false);
    if (err) return setMsg({ tone: "error", text: err });
    setMsg({ tone: "success", text: "Targets saved." });
    onChanged();
  };
  const clearT = async () => {
    setBusy(true);
    const err = await saveTargets({ clear: true });
    setBusy(false);
    if (err) return setMsg({ tone: "error", text: err });
    setKcal(undefined);
    setProtein(undefined);
    setCarbs(undefined);
    setFat(undefined);
    setMsg({ tone: "success", text: "Targets cleared." });
    onChanged();
  };
  const changeAdult = async (v: boolean) => {
    setAdult(v);
    const err = await saveSettings({ adult: v });
    if (err) setMsg({ tone: "error", text: err });
    else onChanged();
  };
  const saveOther = () => void saveSettings({ other }).then((e) => e && setMsg({ tone: "error", text: e }));

  return (
    <Modal open onClose={onClose} title="Diet, allergies & targets" wide footer={<Button onClick={() => { onChanged(); onClose(); }}>Done</Button>}>
      <div className="space-y-6">
        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        <section className="space-y-2">
          <h3 className="text-sm font-bold">Diet</h3>
          <Chips options={Object.keys(DIETS)} value={diets} onToggle={toggle(diets, setDiets, "diets")} />
          <h3 className="pt-2 text-sm font-bold">Allergies</h3>
          <Chips options={Object.keys(ALLERGIES)} value={allergies} onToggle={toggle(allergies, setAllergies, "allergies")} />
          <Field label="Anything else? (optional)" hint="Your coach can see this. The app warns you when a food you log probably conflicts with your diet or allergies. It can miss things, so always check labels.">
            <Input value={other} onChange={(e) => setOther(e.target.value)} onBlur={saveOther} placeholder="e.g. no coriander, lactose intolerant" maxLength={200} />
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-bold">Daily targets</h3>
          <Segmented value={adult === false ? "no" : "yes"} onChange={(v) => void changeAdult(v === "yes")} options={[{ value: "yes", label: "I’m 18 or older" }, { value: "no", label: "I’m under 18" }]} />
          {minor ? (
            <Notice>Calorie and macro targets aren’t offered under 18. You can still keep your food diary. Talk to your coach or a doctor about what’s right for you.</Notice>
          ) : coachSet && targets ? (
            <Notice>
              Your coach set your targets: <strong>{targets.kcal} kcal</strong> · {targets.protein} g protein · {targets.carbs} g carbs · {targets.fat} g fat. Ask your coach if you’d like them changed.
            </Notice>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Calories">
                  <NumberInput label="Calories per day" min={0} max={6000} step={50} allowEmpty value={kcal} onChange={setKcal} />
                </Field>
                <Field label="Protein g">
                  <NumberInput label="Protein per day" min={0} max={500} allowEmpty value={protein} onChange={setProtein} />
                </Field>
                <Field label="Carbs g">
                  <NumberInput label="Carbs per day" min={0} max={1000} allowEmpty value={carbs} onChange={setCarbs} />
                </Field>
                <Field label="Fat g">
                  <NumberInput label="Fat per day" min={0} max={400} allowEmpty value={fat} onChange={setFat} />
                </Field>
              </div>
              {kcal !== undefined && (protein ?? 0) + (carbs ?? 0) + (fat ?? 0) > 0 && <p className="text-xs text-muted">Your macros add up to about {Math.round(atwater({ protein: protein ?? 0, carbs: carbs ?? 0, fat: fat ?? 0 }))} kcal.</p>}
              <div className="flex flex-wrap gap-2">
                <Button onClick={saveT} disabled={busy || !kcal || !protein}>
                  Save targets
                </Button>
                <Button variant="secondary" onClick={() => setCalc((c) => !c)}>
                  <Calculator size={16} /> Calculate for me
                </Button>
                {targets && (
                  <Button variant="ghost" onClick={clearT} disabled={busy}>
                    Clear
                  </Button>
                )}
              </div>
              {calc && (
                <div className="space-y-3 rounded-2xl border border-line bg-field p-3">
                  <p className="text-xs text-muted">A starting point from your body and goal. Nothing here is saved until you press Save targets.</p>
                  <Segmented value={sex} onChange={setSex} options={[{ value: "male", label: "Male" }, { value: "female", label: "Female" }]} />
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Age">
                      <NumberInput label="Age" min={0} max={110} allowEmpty value={age} onChange={setAge} />
                    </Field>
                    <Field label={`Height (${lengthUnit(unit)})`}>
                      <NumberInput label="Height" min={0} max={unit === "metric" ? 250 : 100} decimals={unit === "metric" ? 0 : 1} allowEmpty value={height} onChange={setHeight} placeholder={String(Math.round(fromCm(170, unit)))} />
                    </Field>
                    <Field label={`Weight (${weightUnit(unit)})`}>
                      <NumberInput label="Weight" min={0} max={unit === "metric" ? 300 : 660} decimals={1} allowEmpty value={weight} onChange={setWeight} placeholder={String(Math.round(fromKg(70, unit)))} />
                    </Field>
                  </div>
                  <Field label="How active are you?">
                    <Select value={activity} onChange={(e) => setActivity(e.target.value as Activity)}>
                      {(Object.keys(ACTIVITY_LABEL) as Activity[]).map((a) => (
                        <option key={a} value={a}>
                          {ACTIVITY_LABEL[a]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Segmented value={goal} onChange={setGoal} options={[{ value: "lose", label: "Lose fat" }, { value: "maintain", label: "Maintain" }, { value: "gain", label: "Build muscle" }]} className="w-full" />
                  <Button variant="outline" className="w-full" onClick={runCalc}>
                    Calculate
                  </Button>
                  {calcNotes.map((n) => (
                    <p key={n} className="text-xs text-muted">
                      {n}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        <p className="text-xs text-muted">{DISCLAIMER}</p>
      </div>
    </Modal>
  );
}
