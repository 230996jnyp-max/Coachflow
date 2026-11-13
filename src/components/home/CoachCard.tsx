"use client";

import { PersonAvatar } from "@/components/ui";
import { useViewer } from "@/lib/hooks";
import { mediaUrl } from "@/lib/prefs";

/** The coach's banner, logo, photo and one-line bio at the top of a client's home screen. Nothing when the coach hasn't set any of it. */
export function CoachCard() {
  const { coach, user } = useViewer();
  if (!coach || !user || coach.id === user.id) return null;
  const p = coach.prefs ?? {};
  const gym = coach.publicGym;
  // The coach's own banner and logo come first; a gym's fill in when the coach has none.
  const banner = mediaUrl(coach.id, "banner", p.bannerV) ?? (gym ? mediaUrl(gym.id, "banner", gym.bannerV) : null);
  const gymLogo = gym ? mediaUrl(gym.id, "logo", gym.logoV) : null;
  const logo = mediaUrl(coach.id, "logo", p.logoV) ?? gymLogo;
  if (!banner && !logo && !p.bio && !p.avatarV && !gym) return null;
  const name = p.nick || coach.name;
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">
      {banner && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={banner} alt="" className="h-28 w-full object-cover sm:h-36" />
      )}
      <div className="flex items-center gap-3 p-4">
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="h-12 w-12 shrink-0 rounded-xl border border-line bg-field object-contain p-1" />
        ) : (
          <PersonAvatar user={coach} size={48} />
        )}
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Your coach</div>
          <div className="truncate font-bold">{name}</div>
          {p.bio && <div className="text-sm text-muted">{p.bio}</div>}
          {gym && <div className="mt-0.5 text-xs font-semibold text-accent">Part of {gym.name}</div>}
        </div>
      </div>
    </div>
  );
}
