"use client";

import { ArrowLeft, ArrowRight, Check, Dumbbell, Mail, ShieldCheck, UserRound, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NumberInput } from "@/components/NumberInput";
import { ThemeMenu } from "@/components/ThemeSwitcher";
import { Button, Card, Field, Input, Notice, Segmented, Select, Textarea } from "@/components/ui";
import { CATALOG } from "@/lib/gyms";
import { checkAge, cleanCoachCode, CLIENT_GOALS, coachTitle, LEVELS, PERSONAL_GOALS, TRIAL_DAYS, WEEKLY_TARGETS, type Level, type SignupRole } from "@/lib/signupRules";
import { CORE_SPORTS, sportLabel } from "@/lib/sports";
import { api } from "@/lib/store";
import { cn, lengthUnit, toKg, weightUnit } from "@/lib/utils";
import { Captcha } from "./Captcha";

const BLURB: Record<string, string> = {
  "Strength & Gym": "Hypertrophy and general fitness",
  "Powerlifting & Maximal Strength": "Squat, bench, deadlift",
  "Yoga & Mindful Movement": "Flows, holds, breathwork",
  "Mobility & Flexibility": "Mobility, rehab and prehab",
  "Boxing & Combat Conditioning": "Bag, pads, footwork",
  "Basketball & Court Athletics": "Shooting, handles, plyos",
  "Swimming & Aquatics": "Stroke drills, pace sets",
  "Endurance & Conditioning": "Running, track, HYROX",
};

const ROLES: { role: SignupRole; title: string; text: string; icon: React.ReactNode }[] = [
  { role: "COACH", title: "I am a Coach / Trainer", text: "Manage clients, schedules, group classes and programming.", icon: <Dumbbell size={22} /> },
  { role: "CLIENT", title: "I am training with a Coach", text: "Connect with my coach, book sessions and log workouts.", icon: <Users size={22} /> },
  { role: "PERSONAL", title: "Training on my own", text: "Track my workouts, routines and progress without a coach.", icon: <UserRound size={22} /> },
];

function Chips({ options, value, onToggle, label }: { options: { key: string; label: string; hint?: string }[]; value: string[]; onToggle: (k: string) => void; label?: (k: string) => string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.key);
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.key)}
            className={cn("min-h-10 rounded-xl border px-3 text-left text-xs font-semibold transition-colors", on ? "border-accent bg-accent/15 text-accent" : "border-line bg-field text-muted hover:text-ink")}
          >
            <span className="block">{label ? label(o.key) : o.label}</span>
            {o.hint && <span className="block text-[11px] font-normal opacity-80">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const USER_RE = /^[a-z0-9_.-]{3,32}$/;
const todayIso = () => new Date().toISOString().slice(0, 10);

/** The three-step sign-up: your details, how you'll use CoachFlow, then a few questions for that role. */
export function SignupWizard({ initialRole = null }: { initialRole?: SignupRole | null }) {
  const [step, setStep] = useState(1);
  // The welcome page can pre-pick a role; the sign-up page reads it from the address and passes it in.
  const [role, setRole] = useState<SignupRole | null>(initialRole);
  // Step 1
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  // An email typed on the welcome page is passed along in this tab's session storage (once), never in the address.
  const [email, setEmail] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const v = sessionStorage.getItem("cf_signup_email") ?? "";
      sessionStorage.removeItem("cf_signup_email");
      return v;
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [unit, setUnit] = useState<"metric" | "imperial">("metric");
  const [terms, setTerms] = useState(false);
  const [guardian, setGuardian] = useState(false);
  const [taken, setTaken] = useState<{ username?: boolean; email?: boolean }>({});
  // Step 3
  const [niches, setNiches] = useState<string[]>([]);
  const [level, setLevel] = useState<Level | "">("");
  const [goal, setGoal] = useState("");
  const [years, setYears] = useState<number | undefined>(0);
  const [tagline, setTagline] = useState("");
  const [gymChoice, setGymChoice] = useState<string[]>([]);
  const [gymText, setGymText] = useState("");
  // A coach code typed on the welcome page arrives through this tab's session storage (once). It is looked up below so the coach's name shows.
  const [code, setCode] = useState(() => {
    if (typeof window === "undefined") return "";
    try {
      const v = sessionStorage.getItem("cf_signup_coach_code") ?? "";
      sessionStorage.removeItem("cf_signup_coach_code");
      return cleanCoachCode(v) ?? "";
    } catch {
      return "";
    }
  });
  const [coach, setCoach] = useState<{ name: string; tagline: string } | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [medical, setMedical] = useState("");
  const [focuses, setFocuses] = useState<string[]>([]);
  const [weekly, setWeekly] = useState<number>(3);
  const [weight, setWeight] = useState<number | undefined>(undefined);
  // Bot checks and state
  const [website, setWebsite] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; role: SignupRole } | null>(null);
  const [resent, setResent] = useState(false);

  // A code that came from the welcome page is checked straight away, so step 3 already names the coach.
  useEffect(() => {
    if (code.length !== 6) return;
    let alive = true;
    void api<{ name: string; tagline: string }>("/api/signup/coach-code", { body: { code } }).then((r) => {
      if (!alive) return;
      if (r.ok && r.data) setCoach(r.data);
      else setCodeError(r.error ?? "We couldn't find a coach with that code.");
    });
    return () => {
      alive = false;
    };
    // Only for the code present when the form opens; typing a code is handled by onCode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each new step starts at the top of the page.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step, done]);

  const age = dob ? checkAge(dob) : null;
  const toggle = (set: React.Dispatch<React.SetStateAction<string[]>>, k: string, max = 6) => set((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : cur.length >= max ? cur : [...cur, k]));

  const checkAvail = async (what: "username" | "email") => {
    const value = (what === "username" ? username : email).trim().toLowerCase();
    if (!value || (what === "username" ? !USER_RE.test(value) : !EMAIL_RE.test(value))) return;
    const r = await api<{ username?: boolean; email?: boolean }>("/api/signup/check", { body: { [what]: value } });
    if (r.ok && r.data) setTaken((t) => ({ ...t, [what]: r.data![what] === false }));
  };

  // A six-digit code is looked up as soon as it is complete.
  const onCode = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    setCoach(null);
    setCodeError(null);
    if (digits.length === 6) {
      void api<{ name: string; tagline: string }>("/api/signup/coach-code", { body: { code: digits } }).then((r) => {
        if (r.ok && r.data) setCoach(r.data);
        else setCodeError(r.error ?? "We couldn't find a coach with that code.");
      });
    }
  };

  const step1Error = (): string | null => {
    if (fullName.trim().length < 2) return "Enter your full name.";
    if (!USER_RE.test(username.trim().toLowerCase())) return "Username: 3 to 32 letters, numbers, dots, dashes or underscores.";
    if (taken.username) return "That username is taken. Try another.";
    if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address.";
    if (taken.email) return "That email can't be used (it already has an account, or it's a temporary mailbox).";
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Password: at least 8 characters with a letter and a number.";
    if (password !== confirm) return "The two passwords don't match.";
    if (phone.replace(/\D/g, "").length < 6) return "Enter your phone / WhatsApp number.";
    if (!dob) return "Enter your date of birth.";
    if (age && !age.ok) return age.error;
    if (age && age.ok && age.needsGuardian && !guardian) return "Under 18s need a parent or guardian's OK. Tick the box to confirm.";
    if (!terms) return "Accept the Terms and the Privacy Policy to continue.";
    return null;
  };

  const step3Error = (): string | null => {
    if (role === "COACH") return niches.length === 0 ? "Pick at least one thing you coach." : null;
    if (role === "CLIENT") {
      if (!cleanCoachCode(code)) return "Enter your coach's 6-digit code.";
      if (!coach) return codeError ?? "Checking your coach's code…";
      if (!goal) return "Pick your main goal.";
      if (!level) return "Pick your experience level.";
      return null;
    }
    if (niches.length === 0) return "Pick at least one thing you train.";
    if (!level) return "Pick your experience level.";
    if (!goal) return "Pick your main goal.";
    return null;
  };

  const next = () => {
    setError(null);
    const e = step === 1 ? step1Error() : step === 2 ? (role ? null : "Choose how you'll use CoachFlow.") : step3Error();
    if (e) return setError(e);
    setStep((s) => s + 1);
  };

  const submit = async () => {
    const e = step1Error() ?? step3Error();
    if (e || !role || busy) return setError(e ?? "Choose how you'll use CoachFlow.");
    setBusy(true);
    setError(null);
    const gyms = [...gymChoice, ...gymText.split(",").map((g) => g.trim()).filter(Boolean)];
    const r = await api("/api/signup", {
      body: {
        role,
        fullName: fullName.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        password,
        phone: phone.trim(),
        dob,
        unit,
        guardian,
        terms,
        niches,
        level,
        goal,
        experienceYears: years ?? 0,
        tagline: tagline.trim(),
        gyms,
        coachCode: cleanCoachCode(code) ?? "",
        medicalNotes: medical.trim(),
        focuses,
        weeklyTarget: weekly,
        weightKg: weight ? Math.round(toKg(weight, unit) * 10) / 10 : 0,
        website,
        captcha,
      },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Something went wrong. Please try again.");
    setDone({ email: email.trim().toLowerCase(), role });
  };

  const resend = async () => {
    if (!done) return;
    await api("/api/auth/resend", { body: { identifier: done.email } });
    setResent(true);
  };

  const sportOptions = CORE_SPORTS.map((s) => ({ key: s, label: sportLabel(s), hint: BLURB[s] }));
  const chainGyms = CATALOG.filter((c) => c.group === "chain" && c.brand).map((c) => ({ key: c.brand!, label: c.brand! }));

  return (
    <div className="pt-safe pb-safe animate-fade-in flex min-h-dvh items-start justify-center px-4 py-8 sm:items-center">
      <div className="absolute right-4 top-4">
        <ThemeMenu />
      </div>
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-on-accent shadow-lg shadow-accent/30">
            <Dumbbell size={28} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Create your CoachFlow account</h1>
          {!done && <p className="mt-1 text-sm text-muted">Step {step} of 3 · {TRIAL_DAYS} days free, no card needed</p>}
        </div>

        {done ? (
          <Card className="space-y-4 p-6 text-center">
            <Mail size={44} className="mx-auto rounded-full bg-accent/15 p-2.5 text-accent" />
            <h2 className="text-lg font-bold">Check your email</h2>
            <p className="text-sm text-muted">
              We sent a confirmation link to <strong className="text-ink">{done.email}</strong>. Open it to start your {TRIAL_DAYS}-day free trial, then sign in.
            </p>
            {done.role === "CLIENT" && <p className="text-sm text-muted">Once you confirm, your coach gets your request. You can start logging workouts straight away while you wait for them to accept.</p>}
            <p className="text-xs text-muted">The link works for 48 hours. Check your spam folder if you can&apos;t see it.</p>
            <div className="flex flex-col items-center gap-2">
              <Button variant="secondary" onClick={resend} disabled={resent}>
                {resent ? "Sent again" : "Resend the email"}
              </Button>
              <Link href="/login" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent">
                <ArrowLeft size={15} /> Go to sign in
              </Link>
            </div>
          </Card>
        ) : (
          <Card className="p-5">
            <div className="mb-4 flex gap-1.5" aria-hidden="true">
              {[1, 2, 3].map((n) => (
                <div key={n} className={cn("h-1.5 flex-1 rounded-full", n <= step ? "bg-accent" : "bg-line")} />
              ))}
            </div>

            {step === 1 && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold">Your details</h2>
                <Field label="Full name">
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" maxLength={100} />
                </Field>
                <Field label="Username" hint={taken.username ? undefined : "Letters, numbers, dots, dashes, underscores."} error={taken.username ? "That username is taken." : null}>
                  <Input value={username} onChange={(e) => { setUsername(e.target.value); setTaken((t) => ({ ...t, username: undefined })); }} onBlur={() => void checkAvail("username")} autoCapitalize="none" autoCorrect="off" autoComplete="username" maxLength={32} />
                </Field>
                <Field label="Email address" error={taken.email ? "This email can't be used. It may already have an account." : null}>
                  <Input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setTaken((t) => ({ ...t, email: undefined })); }} onBlur={() => void checkAvail("email")} autoCapitalize="none" autoComplete="email" maxLength={200} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Password">
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" maxLength={128} />
                  </Field>
                  <Field label="Confirm password">
                    <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" maxLength={128} />
                  </Field>
                </div>
                <p className="-mt-2 text-xs text-muted">At least 8 characters, with a letter and a number.</p>
                <Field label="Phone / WhatsApp number">
                  <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" inputMode="tel" maxLength={30} />
                </Field>
                <Field label="Date of birth" hint={age && age.ok ? `You're ${age.age}.` : undefined}>
                  <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} max={todayIso()} min="1900-01-01" autoComplete="bday" />
                </Field>
                {age && age.ok && age.needsGuardian && (
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1 h-4 w-4" checked={guardian} onChange={(e) => setGuardian(e.target.checked)} />
                    <span>I&apos;m under 18 and my parent or guardian agrees I can use CoachFlow. (Under-18 accounts have no calorie tracking and no AI features.)</span>
                  </label>
                )}
                <Field label="Units (optional)">
                  <Segmented value={unit} onChange={setUnit} options={[{ value: "metric", label: "kg / cm" }, { value: "imperial", label: "lbs / in" }]} className="w-full" />
                </Field>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                  <span>
                    I agree to the{" "}
                    <Link href="/terms" target="_blank" className="font-semibold text-accent hover:underline">Terms</Link> and the{" "}
                    <Link href="/privacy" target="_blank" className="font-semibold text-accent hover:underline">Privacy Policy</Link>.
                  </span>
                </label>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <h2 className="text-lg font-bold">How will you use CoachFlow?</h2>
                {ROLES.map((r) => (
                  <button
                    key={r.role}
                    type="button"
                    aria-pressed={role === r.role}
                    onClick={() => { setRole(r.role); setNiches([]); setGoal(""); setLevel(""); }}
                    className={cn("flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors", role === r.role ? "border-accent bg-accent/10" : "border-line bg-field hover:border-accent/40")}
                  >
                    <span className={cn("mt-0.5 shrink-0", role === r.role ? "text-accent" : "text-muted")}>{r.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold">{r.title}</span>
                      <span className="block text-xs text-muted">{r.text}</span>
                    </span>
                    {role === r.role && <Check size={18} className="mt-0.5 shrink-0 text-accent" />}
                  </button>
                ))}
              </div>
            )}

            {step === 3 && role === "COACH" && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold">About your coaching</h2>
                <div>
                  <div className="mb-2 text-sm font-semibold">What do you coach? <span className="font-normal text-muted">(first is your main one)</span></div>
                  <Chips options={sportOptions} value={niches} onToggle={(k) => toggle(setNiches, k)} />
                  <p className="mt-2 text-xs text-muted">Any other sport can be added with AI search right after you sign in.</p>
                </div>
                <Field label="Years of coaching experience">
                  <NumberInput label="Years of coaching experience" min={0} max={60} value={years} onChange={setYears} />
                </Field>
                <Field label="Tagline (optional)" hint="Shown to a client who types your coach code.">
                  <Input value={tagline} onChange={(e) => setTagline(e.target.value)} maxLength={140} placeholder="e.g. Strength coach in Sengkang" />
                </Field>
                <div>
                  <div className="mb-2 text-sm font-semibold">Where do you usually train clients? <span className="font-normal text-muted">(optional)</span></div>
                  <Chips options={chainGyms} value={gymChoice} onToggle={(k) => toggle(setGymChoice, k, 6)} />
                  <Input className="mt-2" value={gymText} onChange={(e) => setGymText(e.target.value)} maxLength={200} placeholder="Other places, separated by commas" />
                  <p className="mt-1 text-xs text-muted">You can pick exact branches on the map in Settings later.</p>
                </div>
              </div>
            )}

            {step === 3 && role === "CLIENT" && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold">Connect with your coach</h2>
                <Field label="Your coach's 6-digit code" hint="Ask your coach for it. It's on their dashboard.">
                  <Input value={code} onChange={(e) => onCode(e.target.value)} inputMode="numeric" autoComplete="off" maxLength={7} placeholder="123456" className="text-center text-lg tracking-[0.3em]" />
                </Field>
                {coach && (
                  <Notice tone="success">
                    ✓ Matched with {coachTitle(coach.name)}
                    {coach.tagline ? ` · ${coach.tagline}` : ""}
                  </Notice>
                )}
                {codeError && <Notice tone="error">{codeError}</Notice>}
                <Field label="Main goal">
                  <Select value={goal} onChange={(e) => setGoal(e.target.value)}>
                    <option value="">Choose…</option>
                    {CLIENT_GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </Select>
                </Field>
                <div>
                  <div className="mb-2 text-sm font-semibold">Sport focus <span className="font-normal text-muted">(optional)</span></div>
                  <Chips options={sportOptions} value={focuses} onToggle={(k) => toggle(setFocuses, k, 4)} />
                </div>
                <Field label="Experience level">
                  <Segmented value={(level || "") as Level} onChange={setLevel} options={LEVELS.map((l) => ({ value: l, label: l }))} className="w-full" />
                </Field>
                <Field label="Medical / injury notes (optional)" hint="Encrypted. Only your coach sees these, once they accept you.">
                  <Textarea value={medical} onChange={(e) => setMedical(e.target.value)} maxLength={2000} rows={3} />
                </Field>
              </div>
            )}

            {step === 3 && role === "PERSONAL" && (
              <div className="space-y-4">
                <h2 className="text-lg font-bold">What do you train?</h2>
                <div>
                  <div className="mb-2 text-sm font-semibold">Pick one or more <span className="font-normal text-muted">(first is your main one)</span></div>
                  <Chips options={sportOptions} value={niches} onToggle={(k) => toggle(setNiches, k)} />
                  <p className="mt-2 text-xs text-muted">We&apos;ll load the exercises and starter routines for them. Any other sport can be added with AI search after you sign in.</p>
                </div>
                <Field label="Experience level">
                  <Segmented value={(level || "") as Level} onChange={setLevel} options={LEVELS.map((l) => ({ value: l, label: l }))} className="w-full" />
                </Field>
                <div>
                  <div className="mb-2 text-sm font-semibold">Days a week you want to train</div>
                  <Segmented value={String(weekly)} onChange={(v) => setWeekly(Number(v))} options={WEEKLY_TARGETS.map((n) => ({ value: String(n), label: n === 6 ? "6+" : String(n) }))} className="w-full" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={`Body weight (${weightUnit(unit)}, optional)`}>
                    <NumberInput label="Body weight" min={0} max={unit === "metric" ? 400 : 880} decimals={1} allowEmpty value={weight} onChange={setWeight} />
                  </Field>
                  <Field label="Main goal">
                    <Select value={goal} onChange={(e) => setGoal(e.target.value)}>
                      <option value="">Choose…</option>
                      {PERSONAL_GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
                    </Select>
                  </Field>
                </div>
                <p className="text-xs text-muted">Heights in {lengthUnit(unit)} and body measurements can be added later in Progress.</p>
              </div>
            )}

            {/* Trap for bots: hidden from people and from screen readers. */}
            <div className="absolute -left-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true">
              <label>
                Website
                <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
            </div>
            {step === 3 && <Captcha onToken={setCaptcha} />}

            {error && <div className="mt-4"><Notice tone="error">{error}</Notice></div>}

            <div className="mt-5 flex items-center gap-2">
              {step > 1 && (
                <Button variant="ghost" onClick={() => { setError(null); setStep((s) => s - 1); }} disabled={busy}>
                  <ArrowLeft size={16} /> Back
                </Button>
              )}
              <div className="flex-1" />
              {step < 3 ? (
                <Button onClick={next}>
                  Continue <ArrowRight size={16} />
                </Button>
              ) : (
                <Button onClick={submit} disabled={busy}>
                  <ShieldCheck size={16} /> {busy ? "Creating…" : "Create my account"}
                </Button>
              )}
            </div>
            <p className="mt-4 text-center text-sm text-muted">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-accent hover:underline">
                Sign in
              </Link>
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
