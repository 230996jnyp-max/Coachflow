import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { WORKOUT_EMOJIS, type WorkoutComment, type WorkoutEmoji, type WorkoutReaction, type WorkoutTalk } from "@/lib/types";
import { loadClientFor, usersByIds } from "./accounts";
import { displayName } from "./chat";
import { decrypt, encrypt } from "./crypto";
import { db } from "./db";
import { notify } from "./groups";
import { badRequest, forbidden, notFound, str } from "./http";
import { hit } from "./rateLimit";
import { clientNotes, workoutComments, workoutReactions, workouts, type UserRow } from "./schema";
import { openWorkout } from "./training";

/*
 * The conversation around one finished workout: comments and quick 👍 / 🔥 reactions between a client and their coach.
 * Only those two people can see or add to it. Someone training without a coach has nothing to talk to, so `canTalk` is false for them.
 * Comment text is encrypted with the comment id as authenticated data. Nobody else's account can read it, including other coaches.
 */

const aad = (id: string) => `wcomment:${id}`;
const MAX_COMMENTS = 300;

interface Access {
  /** The workout's owner (a client). */
  owner: UserRow;
  title: string;
  /** The other person in the conversation: the coach for a client, the client for a coach. null without a coach. */
  other: UserRow | null;
}

/** Loads the workout and checks `me` is its client or that client's coach. Everyone else gets "not found". */
async function access(me: UserRow, workoutId: string): Promise<Access> {
  const d = await db();
  const [row] = await d.select().from(workouts).where(eq(workouts.id, workoutId)).limit(1);
  if (!row) throw notFound("Workout not found.");
  const owner = await loadClientFor(me, row.clientId);
  if (!owner) throw notFound("Workout not found.");
  let other: UserRow | null = null;
  if (me.role === "CLIENT") {
    if (owner.coachId) other = (await usersByIds([owner.coachId]))[0] ?? null;
  } else {
    other = owner;
  }
  // A workout nobody can read any more still keeps its conversation; the title is only used in notification text.
  const w = openWorkout(row);
  return { owner, title: w?.title || "a workout", other: owner.coachId ? other : null };
}

/** "Ben" from "Ben Andrew", and "Darsh" from "Coach Darsh Kumar". */
function firstName(row: UserRow): string {
  const parts = displayName(row).trim().split(/\s+/);
  return /^coach$/i.test(parts[0]) && parts[1] ? parts[1] : parts[0] || "Someone";
}
const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Comments, reactions and whether this person may add to them. */
export async function talkFor(me: UserRow, workoutId: string): Promise<WorkoutTalk> {
  const { owner, other } = await access(me, workoutId);
  const canTalk = !!owner.coachId && !!other;
  if (!owner.coachId) return { canTalk: false, comments: [], reactions: [] };
  const d = await db();
  const rows = await d.select().from(workoutComments).where(eq(workoutComments.workoutId, workoutId)).orderBy(asc(workoutComments.createdAt)).limit(MAX_COMMENTS);
  const reacts = await d.select().from(workoutReactions).where(eq(workoutReactions.workoutId, workoutId));
  const people = new Map((await usersByIds([...new Set([...rows.map((r) => r.authorId), ...reacts.map((r) => r.userId)])])).map((u) => [u.id, u]));

  const comments: WorkoutComment[] = [];
  for (const r of rows) {
    try {
      const author = people.get(r.authorId);
      comments.push({
        id: r.id,
        workoutId,
        authorId: r.authorId,
        authorName: author ? displayName(author) : "Former member",
        authorRole: author?.role === "CLIENT" ? "CLIENT" : "COACH",
        text: decrypt(r.bodyEnc, aad(r.id)),
        createdAt: r.createdAt.toISOString(),
      });
    } catch (e) {
      console.error("Could not decrypt workout comment", r.id, e);
    }
  }

  const reactions: WorkoutReaction[] = WORKOUT_EMOJIS.map((emoji) => {
    const mine = reacts.filter((x) => x.emoji === emoji);
    return {
      emoji,
      count: mine.length,
      mine: mine.some((x) => x.userId === me.id),
      names: mine.map((x) => people.get(x.userId)).filter((u): u is UserRow => !!u).map(firstName),
    };
  });
  return { canTalk, comments, reactions };
}

/** Adds a comment and tells the other person (in the app only: no email). */
export async function addComment(me: UserRow, workoutId: string, rawText: unknown): Promise<WorkoutTalk> {
  const { owner, title, other } = await access(me, workoutId);
  if (!owner.coachId || !other) throw forbidden("Comments are between a client and their coach.");
  const text = str(rawText, "Comment", { max: 1000 });
  await hit(`wcomment:${me.id}`, 20, 10 * 60_000, "You're commenting too quickly. Wait a few minutes and try again.");
  const d = await db();
  const existing = await d.select({ id: workoutComments.id }).from(workoutComments).where(eq(workoutComments.workoutId, workoutId)).limit(MAX_COMMENTS + 1);
  if (existing.length >= MAX_COMMENTS) throw badRequest("This workout has reached its comment limit.");
  const id = `wc_${randomUUID()}`;
  await d.insert(workoutComments).values({ id, workoutId, clientId: owner.id, authorId: me.id, bodyEnc: encrypt(text, aad(id)) });
  const fromCoach = me.role !== "CLIENT";
  await notify(
    [other.id],
    "workout_comment",
    {
      title: fromCoach ? "Your coach commented on a workout" : `${firstName(me)} commented on a workout`,
      body: `“${shorten(text, 120)}” on ${title}`,
      link: `/workout/${workoutId}`,
      about: owner.id,
    },
    { email: false },
  );
  return talkFor(me, workoutId);
}

/** The author removes their own comment; a coach may remove any comment under their own client's workouts. */
export async function removeComment(me: UserRow, workoutId: string, commentId: string): Promise<WorkoutTalk> {
  const { owner } = await access(me, workoutId);
  const d = await db();
  const [row] = await d.select().from(workoutComments).where(and(eq(workoutComments.id, commentId), eq(workoutComments.workoutId, workoutId))).limit(1);
  if (!row) throw notFound("That comment is already gone.");
  const isAuthor = row.authorId === me.id;
  const isCoachOfClient = me.role !== "CLIENT" && owner.coachId === me.id;
  if (!isAuthor && !isCoachOfClient) throw forbidden("You can only remove your own comments.");
  await d.delete(workoutComments).where(eq(workoutComments.id, commentId));
  return talkFor(me, workoutId);
}

/** Turns a 👍 or 🔥 on or off. Switching one on tells the other person (in the app only). */
export async function toggleReaction(me: UserRow, workoutId: string, rawEmoji: unknown): Promise<WorkoutTalk> {
  const { owner, title, other } = await access(me, workoutId);
  if (!owner.coachId || !other) throw forbidden("Reactions are between a client and their coach.");
  if (typeof rawEmoji !== "string" || !WORKOUT_EMOJIS.includes(rawEmoji as WorkoutEmoji)) throw badRequest("Pick 👍 or 🔥.");
  const emoji = rawEmoji as WorkoutEmoji;
  await hit(`wreact:${me.id}`, 30, 10 * 60_000, "Slow down a little and try again in a few minutes.");
  const d = await db();
  const key = and(eq(workoutReactions.workoutId, workoutId), eq(workoutReactions.userId, me.id), eq(workoutReactions.emoji, emoji));
  const [had] = await d.select().from(workoutReactions).where(key).limit(1);
  if (had) {
    await d.delete(workoutReactions).where(key);
  } else {
    await d.insert(workoutReactions).values({ workoutId, userId: me.id, emoji, clientId: owner.id }).onConflictDoNothing();
    await notify(
      [other.id],
      "workout_reaction",
      {
        title: me.role === "CLIENT" ? `${firstName(me)} reacted to a workout` : "Your coach reacted to your workout",
        body: `${emoji} on ${title}`,
        link: `/workout/${workoutId}`,
        about: owner.id,
      },
      { email: false },
    );
  }
  return talkFor(me, workoutId);
}

/** When a client is deleted, everything said about their workouts and every private note about them goes too. */
export async function purgeClientTalk(clientId: string): Promise<void> {
  const d = await db();
  await d.delete(workoutComments).where(eq(workoutComments.clientId, clientId));
  await d.delete(workoutReactions).where(eq(workoutReactions.clientId, clientId));
  await d.delete(clientNotes).where(eq(clientNotes.clientId, clientId));
}
