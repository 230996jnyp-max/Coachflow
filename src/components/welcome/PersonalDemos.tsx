"use client";

import { useState } from "react";

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

const FOODS = [
  { name: "Oats and banana", kcal: 380, protein: 12 },
  { name: "Chicken rice bowl", kcal: 620, protein: 42 },
  { name: "Greek yogurt", kcal: 150, protein: 15 },
  { name: "Protein shake", kcal: 160, protein: 25 },
];
const TARGET = 2200;

/** A quick food diary against a sample daily target. Calorie targets are for adults; under 18s get the diary without them. */
export function NutritionDemo() {
  const [eaten, setEaten] = useState<number[]>([]);
  const kcal = eaten.reduce((n, i) => n + FOODS[i].kcal, 0);
  const protein = eaten.reduce((n, i) => n + FOODS[i].protein, 0);
  const pct = Math.min(1, kcal / TARGET);
  return (
    <div>
      <div className="wc-chips">
        {FOODS.map((f, i) => (
          <button key={f.name} type="button" className="wc-day" onClick={() => setEaten((e) => (e.length >= 8 ? [i] : [...e, i]))}>
            + {f.name}
          </button>
        ))}
      </div>
      <div className="wc-meter" role="img" aria-label={`${kcal} of ${TARGET} calories`}>
        <i style={{ transform: `scaleX(${pct})` }} />
      </div>
      <div className="wc-meter-text" aria-live="polite">
        <strong className="wc-fig">{kcal}</strong> of {TARGET} kcal, <strong className="wc-fig">{protein} g</strong> protein
      </div>
      <ul className="wc-rows">
        {eaten.length === 0 && <li>Tap a food to add it.</li>}
        {eaten.map((i, n) => (
          <li key={`${n}-${i}`}>
            <span>{FOODS[i].name}</span>
            <span className="wc-fig">{FOODS[i].kcal} kcal</span>
          </li>
        ))}
      </ul>
      <p className="wc-footnote">Calorie targets are for adults. Under 18s get the diary without them.</p>
    </div>
  );
}
