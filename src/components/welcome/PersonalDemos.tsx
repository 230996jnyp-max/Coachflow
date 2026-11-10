"use client";

import { useEffect, useRef, useState } from "react";

/* Hands-on samples for people who train on their own. Browser only: invented numbers, nothing is sent or saved. */

/** Your own log: change the weight, log a set, and a heavier set than before is flagged as a new best. */
export function PersonalLogger() {
  const [weight, setWeight] = useState(80);
  const [sets, setSets] = useState<number[]>([80, 80]);
  const [best, setBest] = useState(false);
  const log = () => {
    const prior = Math.max(...sets);
    setBest(weight > prior);
    setSets((s) => (s.length >= 5 ? [weight] : [...s, weight]));
  };
  return (
    <div>
      <div className="wc-bignum" aria-live="polite">
        {weight}
        <small>kg</small>
      </div>
      <div className="wc-stepper">
        <button type="button" className="wc-step" aria-label="Lower the weight by 2.5 kilograms" onClick={() => setWeight((w) => Math.max(20, w - 2.5))}>
          -
        </button>
        <button type="button" className="wc-step" aria-label="Raise the weight by 2.5 kilograms" onClick={() => setWeight((w) => Math.min(300, w + 2.5))}>
          +
        </button>
        <button type="button" className="wc-btn wc-btn-primary wc-btn-small" onClick={log}>
          Log set
        </button>
        <span className="wc-tag" data-on={best}>
          New best
        </span>
      </div>
      <ul className="wc-rows">
        {sets.map((w, i) => (
          <li key={`${i}-${w}`}>
            <span>Set {i + 1}</span>
            <span className="wc-fig">{w} kg x 5</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Food = { key: string; name: string; kcal: number; protein: number; words: string[] };
const FOODS: Food[] = [
  { key: "egg", name: "Egg", kcal: 70, protein: 6, words: ["egg"] },
  { key: "toast", name: "Toast slice", kcal: 80, protein: 3, words: ["toast", "bread"] },
  { key: "flat", name: "Flat white", kcal: 120, protein: 6, words: ["flat white", "latte", "coffee"] },
  { key: "banana", name: "Banana", kcal: 105, protein: 1, words: ["banana"] },
  { key: "oats", name: "Bowl of oats", kcal: 300, protein: 10, words: ["oats", "porridge"] },
  { key: "bowl", name: "Chicken rice bowl", kcal: 620, protein: 42, words: ["chicken rice", "chicken bowl"] },
  { key: "yogurt", name: "Greek yogurt", kcal: 150, protein: 15, words: ["yogurt", "yoghurt"] },
  { key: "shake", name: "Protein shake", kcal: 160, protein: 25, words: ["shake", "protein"] },
  { key: "oatdrink", name: "Oat drink, 250 ml", kcal: 120, protein: 3, words: ["oat drink", "oat milk"] },
];
const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
const TARGET = 2200;

type Entry = { name: string; kcal: number; protein: number };

/** Reads "2 eggs, toast and a flat white" into foods the sample knows. */
function readWords(text: string): { found: Entry[]; missed: string[] } {
  const found: Entry[] = [];
  const missed: string[] = [];
  for (const raw of text.toLowerCase().split(/,|\band\b|\+|\n/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d+|a|an|one|two|three|four)\s+/.exec(part);
    const qty = m ? (NUM[m[1]] ?? Number(m[1])) : 1;
    const food = FOODS.find((f) => f.words.some((w) => part.includes(w)));
    if (food) found.push({ name: qty > 1 ? `${qty} x ${food.name}` : food.name, kcal: food.kcal * qty, protein: food.protein * qty });
    else missed.push(part);
  }
  return { found, missed };
}

/** Log food by describing it, searching or scanning a barcode, against a sample daily target. Calorie targets are for adults. */
export function FoodLogDemo() {
  const [how, setHow] = useState<"words" | "search" | "barcode">("words");
  const [text, setText] = useState("2 eggs, toast and a flat white");
  const [query, setQuery] = useState("oat");
  const [scanning, setScanning] = useState(false);
  const [eaten, setEaten] = useState<Entry[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const add = (e: Entry[]) => setEaten((cur) => [...cur, ...e].slice(-8));
  const kcal = eaten.reduce((n, e) => n + e.kcal, 0);
  const protein = eaten.reduce((n, e) => n + e.protein, 0);
  const pct = Math.min(1, kcal / TARGET);
  const results = FOODS.filter((f) => query.trim() && f.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 4);

  const estimate = () => {
    const { found, missed } = readWords(text);
    if (found.length === 0) return setNote("The sample knows eggs, toast, coffee, banana, oats, yogurt and shakes. Try one of those.");
    add(found);
    setNote(missed.length ? `Couldn't read: ${missed.join(", ")}.` : null);
  };
  const scan = () => {
    if (scanning) return;
    setScanning(true);
    setNote(null);
    timer.current = setTimeout(() => {
      setScanning(false);
      add([{ name: "Oat drink, 250 ml", kcal: 120, protein: 3 }]);
    }, 1300);
  };

  return (
    <div>
      <div className="wc-chips" role="group" aria-label="How to log food">
        {(["words", "search", "barcode"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className="wc-day"
            aria-pressed={how === k}
            onClick={() => {
              setHow(k);
              setNote(null);
            }}
          >
            {k === "words" ? "Describe it" : k === "search" ? "Search" : "Scan a barcode"}
          </button>
        ))}
      </div>

      {how === "words" && (
        <div>
          <label htmlFor="wc-food-words" className="wc-sr">
            What did you eat
          </label>
          <textarea id="wc-food-words" className="wc-notes" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          <button type="button" className="wc-btn wc-btn-primary wc-btn-small" onClick={estimate}>
            Estimate
          </button>
        </div>
      )}
      {how === "search" && (
        <div>
          <label htmlFor="wc-food-search" className="wc-sr">
            Search foods
          </label>
          <input id="wc-food-search" className="wc-searchbox" value={query} placeholder="Search foods" onChange={(e) => setQuery(e.target.value)} />
          <div className="wc-chips">
            {results.length === 0 && <span className="wc-footnote">No match in this sample.</span>}
            {results.map((f) => (
              <button key={f.key} type="button" className="wc-day" onClick={() => add([{ name: f.name, kcal: f.kcal, protein: f.protein }])}>
                + {f.name}, {f.kcal} kcal
              </button>
            ))}
          </div>
        </div>
      )}
      {how === "barcode" && (
        <div>
          <div className="wc-scan" data-on={scanning} aria-hidden="true">
            <i />
            <span>{scanning ? "Scanning" : "Point at a barcode"}</span>
          </div>
          <button type="button" className="wc-btn wc-btn-primary wc-btn-small" onClick={scan} disabled={scanning}>
            {scanning ? "Scanning" : "Scan a sample barcode"}
          </button>
        </div>
      )}

      {note && <p className="wc-footnote" role="status">{note}</p>}
      <div className="wc-meter" role="img" aria-label={`${kcal} of ${TARGET} calories`}>
        <i style={{ transform: `scaleX(${pct})` }} />
      </div>
      <div className="wc-meter-text" aria-live="polite">
        <strong className="wc-fig">{kcal}</strong> of {TARGET} kcal, <strong className="wc-fig">{protein} g</strong> protein
      </div>
      <ul className="wc-rows">
        {eaten.length === 0 && <li>Nothing logged yet.</li>}
        {eaten.map((e, n) => (
          <li key={`${n}-${e.name}`}>
            <span>{e.name}</span>
            <span className="wc-fig">{e.kcal} kcal</span>
          </li>
        ))}
      </ul>
      <p className="wc-footnote">Food numbers are estimates. Calorie targets are for adults; under 18s get the diary without them.</p>
    </div>
  );
}

const SPORTS: { sport: string; drill: string; log: string; next: string }[] = [
  { sport: "Strength", drill: "Back squat", log: "Weight and reps for every set", next: "Up one plate step when every set felt easy" },
  { sport: "Powerlifting", drill: "Competition bench", log: "Weight, reps and how hard it felt", next: "Up one plate step, or a deload when effort stays very high" },
  { sport: "Mobility", drill: "Couch stretch", log: "How long you held it", next: "Hold 5 to 10 seconds longer" },
  { sport: "Yoga", drill: "Warrior II", log: "How long you held it", next: "Hold 5 to 10 seconds longer" },
  { sport: "Boxing", drill: "Heavy bag rounds", log: "Rounds completed", next: "One more round" },
  { sport: "Swimming", drill: "100 m freestyle", log: "Your split time", next: "A slightly faster split" },
  { sport: "Basketball", drill: "Free throws", log: "Shots made", next: "One or two more makes" },
  { sport: "Endurance", drill: "Tempo run", log: "Your split time", next: "A slightly faster split" },
];

/** Pick a sport and see what you log for it and what the next target nudges. */
export function SportDemo() {
  const [i, setI] = useState(0);
  const s = SPORTS[i];
  return (
    <div>
      <div className="wc-chips" role="group" aria-label="Pick a sport">
        {SPORTS.map((x, n) => (
          <button key={x.sport} type="button" className="wc-day" aria-pressed={n === i} onClick={() => setI(n)}>
            {x.sport}
          </button>
        ))}
      </div>
      <div className="wc-sport" aria-live="polite">
        <div className="wc-sport-drill">{s.drill}</div>
        <dl>
          <div>
            <dt>You log</dt>
            <dd>{s.log}</dd>
          </div>
          <div>
            <dt>Next target</dt>
            <dd>{s.next}</dd>
          </div>
        </dl>
      </div>
      <p className="wc-footnote">Each sport has its own drills, and suggestions follow the one number that matters.</p>
    </div>
  );
}
