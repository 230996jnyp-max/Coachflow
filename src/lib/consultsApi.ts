"use client";

import type { ConsultFacts, ConsultStatus, Recommendation, RefundChoice, ReporterRole, Sanction } from "./consults";
import { api } from "./store";

/* Browser side of consults and the coach's public page: the shapes the API returns and the calls. */

export interface TrainerCard {
  id: string;
  name: string;
  slug: string;
  headline: string;
  avatarV: number;
  profilePath: string | null;
  rating: number | null;
}

export interface ConsultBrief {
  ready: boolean;
  goal: string;
  experience: string;
  sessionsPerWeek: number;
  equipment: string;
  pastInjuries: string;
  plan: { weekStart: string; summary: string; days: { name: string; focus: string; exercises: number }[] } | null;
  gentle: boolean;
  needsClearance: boolean;
  health: { question: string; detail: string }[] | null;
}

export interface ConsultView {
  id: string;
  status: ConsultStatus;
  myRole: ReporterRole;
  priceCents: number;
  question: string;
  shareHealth: boolean;
  createdAt: string;
  acceptBy: string | null;
  acceptedAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
  refundedCents: number;
  trainer: TrainerCard | null;
  person: { firstName: string; brief: ConsultBrief; recent: { title: string; date: string; exercises: number }[] } | null;
  payout: { status: string; cents: number; dueAt: string | null } | null;
  stars: number | null;
  review: string | null;
  canRate: boolean;
  canReport: boolean;
  reported: boolean;
}

export interface SoloBoard {
  role: "SOLO";
  available: boolean;
  reason: string | null;
  priceCents: number;
  minutes: number;
  consults: ConsultView[];
}

export interface TrainerBoard {
  role: "TRAINER";
  enabled: boolean;
  stripeReady: boolean;
  suspended: boolean;
  waiting: { id: string; question: string; waitingMin: number; acceptBy: string }[];
  live: ConsultView | null;
  history: ConsultView[];
  earnings: { paidCents: number; heldCents: number; count: number };
}

export interface PublicData {
  headline: string;
  about: string;
  experienceYears: number | null;
  certifications: string[];
  area: string;
  showPackages: boolean;
}

export interface MyPublicProfile {
  isPublic: boolean;
  takesConsults: boolean;
  data: PublicData;
  path: string;
  stripeReady: boolean;
  consultsSuspended: boolean;
}

export interface AdminReport {
  id: string;
  consultId: string;
  reporterRole: ReporterRole;
  reporterName: string;
  reason: string;
  reasonLabel: string;
  details: string;
  createdAt: string;
  status: string;
  resolution: { refund: RefundChoice; refundCents: number; sanction: Sanction; note: string } | null;
  trainer: { id: string; name: string } | null;
  person: { id: string; name: string };
  consult: { status: string; priceCents: number; refundedCents: number; trainerCents: number; payoutStatus: string; acceptedAt: string | null; endedAt: string | null; endedBy: string | null; question: string };
  facts: ConsultFacts;
  recommendation: Recommendation;
}

export interface AdminConsults {
  reports: AdminReport[];
  recent: { id: string; status: string; createdAt: string; person: string; trainer: string | null; priceCents: number; refundedCents: number; trainerCents: number; payoutStatus: string; stars: number | null; reported: boolean }[];
  totals: { done: number; grossCents: number; refundedCents: number; trainerCents: number; keptCents: number };
  blocked: { userId: string; name: string; role: string; reason: string; since: string }[];
  ready: boolean;
}

export const loadBoard = () => api<SoloBoard | TrainerBoard>("/api/consults");
export const loadConsult = (id: string) => api<ConsultView>(`/api/consults/${encodeURIComponent(id)}`);
export const consultAction = <T = ConsultView>(id: string, action: string, extra: Record<string, unknown> = {}) => api<T>(`/api/consults/${encodeURIComponent(id)}`, { body: { action, ...extra } });
export const startConsult = (question: string, shareHealth: boolean) => api<{ id: string; url: string }>("/api/consults", { body: { question, shareHealth } });

/** A trainer's photo for people who aren't their clients: the public page's copy (only when the trainer's page is on). */
export const trainerPhoto = (t: Pick<TrainerCard, "slug" | "avatarV" | "profilePath">) => (t.avatarV && t.profilePath ? `/api/public/coach/${encodeURIComponent(t.slug)}/avatar?v=${t.avatarV}` : null);
