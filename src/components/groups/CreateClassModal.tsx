"use client";

import { format } from "date-fns";
import { useState } from "react";
import { GymSelect } from "@/components/GymSelect";
import { NumberInput } from "@/components/NumberInput";
import { TimeSelect } from "@/components/TimeSelect";
import { Button, Field, Input, Modal, Notice, Select, Textarea, Toggle } from "@/components/ui";
import { gymToBooking, isGymComplete, placeForBooking } from "@/lib/gyms";
import { useViewer } from "@/lib/hooks";
import { atTime, travelProblem, ymd } from "@/lib/scheduling";
import { createClass } from "@/lib/store";
import { locOf } from "@/lib/travel";
import type { PlaceInfo } from "@/lib/types";
import { classesAsBookings } from "./groupUi";

/** Coach: schedule a group class (optionally repeating every week). */
export function CreateClassModal({ open, onClose, initialDate }: { open: boolean; onClose: () => void; initialDate?: Date }) {
  return open ? <Form key={initialDate?.getTime() ?? "new"} onClose={onClose} initialDate={initialDate} /> : null;
}

function Form({ onClose, initialDate }: { onClose: () => void; initialDate?: Date }) {
  const { db, user } = useViewer();
  const templates = db.templates.filter((t) => t.ownerId === user?.id && t.exercises.length > 0);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => ymd(initialDate ?? new Date(Date.now() + 86400000)));
  const [time, setTime] = useState(() => (initialDate ? format(initialDate, "HH:mm") : "10:00"));
  const [minutes, setMinutes] = useState(60);
  const [capacity, setCapacity] = useState(6);
  const [weeks, setWeeks] = useState(1);
  const [templateId, setTemplateId] = useState("");
  const [gym, setGym] = useState("");
  const [place, setPlace] = useState<PlaceInfo | null>(null);
  const [notes, setNotes] = useState("");
  const [waive, setWaive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const start = atTime(date, time);
  const problem = (() => {
    if (!gym || !isGymComplete(gym) || Number.isNaN(start.getTime())) return null;
    const loc = gymToBooking(gym, db.gyms);
    const end = new Date(start.getTime() + minutes * 60000);
    return travelProblem([...db.bookings, ...classesAsBookings(db.groups)], start, end, locOf({ gymId: loc.gymId, customGym: loc.customGym, place: placeForBooking(gym, place) ?? undefined }), db.settings);
  })();

  const submit = async () => {
    setError(null);
    if (!title.trim()) return setError("Give the class a title.");
    if (Number.isNaN(start.getTime())) return setError("Choose a date and time.");
    if (!Number.isInteger(capacity) || capacity < 2 || capacity > 30) return setError("Spots must be a whole number between 2 and 30.");
    if (!gym || !isGymComplete(gym)) return setError("Choose where the class is held (search and pick the exact location).");
    if (problem && !waive) return setError(`${problem} Switch on “Waive travel buffer” to schedule it anyway.`);
    const loc = gymToBooking(gym, db.gyms);
    setBusy(true);
    const res = await createClass({
      title: title.trim(),
      start,
      durationMin: minutes,
      capacity,
      repeatWeeks: weeks,
      gymId: loc.gymId,
      customGym: loc.customGym,
      place: placeForBooking(gym, place),
      templateId: templateId || undefined,
      notes: notes.trim(),
      waiveTravel: waive,
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    if (res.skipped.length) return setSkipped(res.skipped);
    onClose();
  };

  if (skipped.length) {
    return (
      <Modal open onClose={onClose} title="Class scheduled" footer={<Button onClick={onClose}>Done</Button>}>
        <Notice tone="warn">
          Scheduled, but {skipped.length} week{skipped.length === 1 ? " was" : "s were"} skipped:
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
            {skipped.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </Notice>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Schedule a group class"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Scheduling…" : weeks > 1 ? `Schedule ${weeks} classes` : "Schedule class"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Class title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Athletic S&C Group" maxLength={100} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start time">
            <TimeSelect value={time} onChange={setTime} />
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Length (min)">
            <NumberInput label="Length (min)" compact min={15} max={300} step={5} value={minutes} onChange={(v) => setMinutes(v ?? minutes)} />
          </Field>
          <Field label="Max spots" hint="2 – 30">
            <NumberInput label="Max spots" compact min={2} max={30} value={capacity} onChange={(v) => setCapacity(v ?? capacity)} />
          </Field>
          <Field label="Repeat weekly">
            <Select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
              <option value={1}>Just once</option>
              {[2, 3, 4, 6, 8, 10, 12, 26].map((n) => (
                <option key={n} value={n}>
                  {n} weeks
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Location">
          <GymSelect value={gym} onChange={setGym} noneLabel="Select a gym…" place={place} onPlace={setPlace} />
        </Field>
        {db.settings.travelEnabled && (problem || waive) && (
          <div className="space-y-1">
            <Notice tone={waive ? "info" : "warn"}>{waive ? "Travel buffer waived for this class." : problem}</Notice>
            <Toggle checked={waive} onChange={setWaive} label="Waive travel buffer" />
          </div>
        )}
        <Field label="Group workout (optional)" hint="Pick a saved routine now, or choose one when you start the class.">
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Choose later</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Notes for attendees (optional)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Bring a towel and a water bottle" maxLength={500} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Modal>
  );
}
