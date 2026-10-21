/* eslint-disable @next/next/no-img-element */
"use client";

import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { Camera, ColumnsIcon, GitCompare, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, Segmented, Select, Textarea } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { ymd } from "@/lib/scheduling";
import { addPhoto, deletePhoto } from "@/lib/store";
import type { PhotoPose, ProgressPhoto } from "@/lib/types";
import { cn, fmtWeight, fromKg, round, toKg, weightUnit } from "@/lib/utils";

const POSES: PhotoPose[] = ["Front", "Side", "Back", "Other"];

/** Downscale and compress a picked image so the local store stays small. */
async function fileToDataUrl(file: File, maxDim = 900, quality = 0.82): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Could not read image"));
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const photoLabel = (p: ProgressPhoto) => `${format(parseISO(p.date), "d MMM yyyy")} · ${p.pose}`;

export function PhotosTab({ clientId }: { clientId: string }) {
  const { db, unit } = useViewer();
  const [pose, setPose] = useState<PhotoPose | "All">("All");
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<ProgressPhoto | null>(null);
  const [del, setDel] = useState<ProgressPhoto | null>(null);
  const [mode, setMode] = useState<"gallery" | "compare">("gallery");

  const photos = useMemo(
    () => db.photos.filter((p) => p.clientId === clientId).sort((a, b) => b.date.localeCompare(a.date)),
    [db.photos, clientId],
  );
  const filtered = pose === "All" ? photos : photos.filter((p) => p.pose === pose);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "gallery", label: <span className="flex items-center gap-1.5"><ColumnsIcon size={14} /> Gallery</span> },
            { value: "compare", label: <span className="flex items-center gap-1.5"><GitCompare size={14} /> Compare</span> },
          ]}
        />
        <Button onClick={() => setAdding(true)}>
          <Camera size={16} /> Add photo
        </Button>
      </div>

      {photos.length === 0 ? (
        <EmptyState
          icon={<Camera size={28} />}
          title="No progress photos yet"
          hint="Upload front, side and back check-in photos to compare your transformation over time."
          action={<Button onClick={() => setAdding(true)}>Upload first photo</Button>}
        />
      ) : mode === "gallery" ? (
        <>
          <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
            {(["All", ...POSES] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPose(p)}
                className={cn(
                  "min-h-9 shrink-0 rounded-full border px-3 text-xs font-semibold",
                  pose === p ? "border-accent bg-accent text-white" : "border-line bg-field text-muted",
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {filtered.map((p) => (
              <button key={p.id} onClick={() => setView(p)} className="group overflow-hidden rounded-2xl border border-line bg-surface text-left">
                <div className="aspect-[3/4] overflow-hidden bg-field">
                  <img src={p.dataUrl} alt={`${p.pose} progress photo ${p.date}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                </div>
                <div className="p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{format(parseISO(p.date), "d MMM yy")}</span>
                    <Badge>{p.pose}</Badge>
                  </div>
                  <div className="mt-0.5 text-xs text-muted">{p.weightKg ? fmtWeight(p.weightKg, unit) : "—"}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <Compare photos={photos} />
      )}

      {adding && <AddPhotoModal clientId={clientId} onClose={() => setAdding(false)} />}

      <Modal open={!!view} onClose={() => setView(null)} title={view ? photoLabel(view) : ""}
        footer={
          view && (
            <Button
              variant="danger"
              onClick={() => {
                setDel(view);
                setView(null);
              }}
            >
              <Trash2 size={16} /> Delete
            </Button>
          )
        }
      >
        {view && (
          <div className="space-y-3">
            <img src={view.dataUrl} alt="" className="mx-auto max-h-[60dvh] rounded-xl object-contain" />
            <div className="text-sm text-muted">
              {view.weightKg ? `Body weight ${fmtWeight(view.weightKg, unit)}` : "No weight recorded"}
              {view.notes && <p className="mt-1 text-ink">{view.notes}</p>}
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} danger title="Delete photo?" message="This progress photo will be permanently removed." confirmLabel="Delete" onConfirm={() => del && deletePhoto(del.id)} />
    </div>
  );
}

function Compare({ photos }: { photos: ProgressPhoto[] }) {
  const { unit } = useViewer();
  const chronological = useMemo(() => [...photos].sort((a, b) => a.date.localeCompare(b.date)), [photos]);
  const [poseFilter, setPoseFilter] = useState<PhotoPose | "All">("Front");
  const pool = poseFilter === "All" ? chronological : chronological.filter((p) => p.pose === poseFilter);
  const [beforeId, setBeforeId] = useState("");
  const [afterId, setAfterId] = useState("");
  const [style, setStyle] = useState<"side" | "slider">("side");
  const [pos, setPos] = useState(50);

  const before = pool.find((p) => p.id === beforeId) ?? pool[0];
  const after = pool.find((p) => p.id === afterId) ?? pool[pool.length - 1];

  if (pool.length < 2)
    return (
      <EmptyState icon={<GitCompare size={28} />} title="Need two photos to compare" hint="Upload at least two photos with the same pose (e.g. Front) to unlock side-by-side comparison." />
    );

  const days = differenceInCalendarDays(parseISO(after.date), parseISO(before.date));
  const wDelta = before.weightKg && after.weightKg ? after.weightKg - before.weightKg : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={poseFilter} onChange={(v) => { setPoseFilter(v); setBeforeId(""); setAfterId(""); }} options={(["Front", "Side", "Back", "All"] as const).map((p) => ({ value: p, label: p }))} />
        <Segmented value={style} onChange={setStyle} options={[{ value: "side", label: "Side by side" }, { value: "slider", label: "Slider" }]} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Before">
          <Select value={before.id} onChange={(e) => setBeforeId(e.target.value)}>
            {pool.map((p) => (
              <option key={p.id} value={p.id}>
                {photoLabel(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="After">
          <Select value={after.id} onChange={(e) => setAfterId(e.target.value)}>
            {pool.map((p) => (
              <option key={p.id} value={p.id}>
                {photoLabel(p)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {style === "side" ? (
        <div className="grid grid-cols-2 gap-3">
          {[before, after].map((p, i) => (
            <div key={p.id + i} className="overflow-hidden rounded-2xl border border-line bg-surface">
              <div className="aspect-[3/4] bg-field">
                <img src={p.dataUrl} alt={i === 0 ? "Before" : "After"} className="h-full w-full object-cover" />
              </div>
              <div className="p-2.5 text-center">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted">{i === 0 ? "Before" : "After"}</div>
                <div className="text-sm font-semibold">{format(parseISO(p.date), "d MMM yyyy")}</div>
                <div className="text-xs text-muted">{p.weightKg ? fmtWeight(p.weightKg, unit) : "—"}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mx-auto max-w-sm">
          <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-line bg-field">
            <img src={after.dataUrl} alt="After" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
              <img src={before.dataUrl} alt="Before" className="absolute inset-0 h-full w-full object-cover" />
            </div>
            <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white/80" style={{ left: `${pos}%` }} />
            <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold">Before</span>
            <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-bold">After</span>
          </div>
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Comparison slider" className="mt-3 h-11 w-full accent-blue-500" />
        </div>
      )}

      <Card className="grid grid-cols-3 divide-x divide-line p-4 text-center">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Elapsed</div>
          <div className="mt-1 text-lg font-bold">{days >= 14 ? `${round(days / 7, 1)} wks` : `${days} days`}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Weight change</div>
          <div className={cn("mt-1 text-lg font-bold", wDelta === undefined ? "" : "text-accent")}>
            {wDelta === undefined ? "—" : `${wDelta > 0 ? "+" : ""}${round(fromKg(wDelta, unit), 1)} ${weightUnit(unit)}`}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Photos</div>
          <div className="mt-1 text-lg font-bold">{before.pose === after.pose ? before.pose : "Mixed"}</div>
        </div>
      </Card>
    </div>
  );
}

function AddPhotoModal({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const { unit } = useViewer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<string | null>(null);
  const [date, setDate] = useState(() => ymd(new Date()));
  const [pose, setPose] = useState<PhotoPose>("Front");
  const [weight, setWeight] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      setData(await fileToDataUrl(f));
    } catch {
      setError("That file couldn’t be read as an image.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add progress photo"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!data}
            onClick={() => {
              const w = parseFloat(weight);
              addPhoto({
                clientId,
                date,
                pose,
                notes: notes.trim(),
                weightKg: Number.isNaN(w) ? undefined : round(toKg(w, unit), 2),
                dataUrl: data!,
              });
              onClose();
            }}
          >
            Save photo
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-field text-muted hover:border-accent"
        >
          {data ? (
            <img src={data} alt="Preview" className="h-full w-full object-contain" />
          ) : (
            <span className="flex flex-col items-center gap-2 text-sm">
              <Upload size={28} />
              {busy ? "Processing…" : "Tap to take or choose a photo"}
            </span>
          )}
        </button>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} max={ymd(new Date())} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Pose">
            <Select value={pose} onChange={(e) => setPose(e.target.value as PhotoPose)}>
              {POSES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={`Body weight at check-in (${weightUnit(unit)})`}>
          <Input type="number" inputMode="decimal" step="0.1" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Lighting, time of day, how you feel…" />
        </Field>
      </div>
    </Modal>
  );
}
