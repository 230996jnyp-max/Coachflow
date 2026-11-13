import type { AssessmentData, PhotoView } from "@/lib/assessment";
import type { FormData, FormKind } from "@/lib/intakeForms";

/*
 * What the intake and assessment endpoints send back (the same shapes as the server builds, kept here so screens can import them
 * without pulling in server code).
 */

export interface FormRec {
  id: string;
  kind: FormKind;
  version: number;
  submittedAt: string;
  flags: number;
  reviewedAt: string | null;
  sharedAt: string | null;
  ackAt: string | null;
  reviewNote: string;
  data: FormData[FormKind];
}

export interface IntakeStateRec {
  current: Record<FormKind, FormRec | null>;
  history: FormRec[];
  request: { id: string; kinds: FormKind[]; createdAt: string; complete: boolean } | null;
}

export interface AssessmentRec {
  id: string;
  clientId: string;
  filledBy: "COACH" | "CLIENT";
  status: "DRAFT" | "DONE";
  takenAt: string;
  createdAt: string;
  updatedAt: string;
  sharedAt: string | null;
  ackAt: string | null;
  seenAt: string | null;
  photos: PhotoView[];
  data: AssessmentData;
}
