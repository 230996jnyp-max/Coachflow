/*
 * Live versions of the app's own screens for the hero. They are drawn in markup and moved by one shared 10 second loop (see welcome.css, "live screens"),
 * so what happens on one phone lines up with what happens on the other: a set is ticked, the volume and the chart or the coach's list react, a note comes back.
 * Names and numbers are demo data and are consistent across the screens: 62.5 kg x 8 = 500, 72.5 kg x 8 = 580, 75 kg x 6 = 450.
 */

function Bar() {
  return (
    <div className="lv-bar">
      <i className="lv-logo" />
      <b>CoachFlow</b>
      <span className="lv-ava">{/* initials */}AT</span>
    </div>
  );
}

function Row({ n, prev, kg, reps, done }: { n: number; prev: string; kg: string; reps: string; done: 0 | 2 | 3 }) {
  return (
    <div className="lv-row" data-live={done || undefined} data-n={done || undefined}>
      <span className="lv-set">{n}</span>
      <span className="lv-prev">{prev}</span>
      <span className="lv-field">{kg}</span>
      <span className="lv-field">{reps}</span>
      <span className="lv-tick" data-n={done || 1}>
        <u />
      </span>
    </div>
  );
}

/** The workout logger. Set 2 and set 3 tick themselves; set 3 is a new best; in the coach version a note arrives at the end. */
export function LiveLogger({ note }: { note: boolean }) {
  return (
    <div className="lv" aria-hidden="true">
      <div className="lv-in">
        <Bar />
        <div className="lv-head">
          <strong>Back squat</strong>
          <small>Quads, barbell</small>
        </div>
        <div className="lv-cols">
          <span>Set</span>
          <span>Previous</span>
          <span>Kg</span>
          <span>Reps</span>
          <span />
        </div>
        <Row n={1} prev="50 kg x 8" kg="62.5" reps="8" done={0} />
        <Row n={2} prev="50 kg x 8" kg="72.5" reps="8" done={2} />
        <Row n={3} prev="none" kg="75" reps="6" done={3} />
        <div className="lv-suggest">
          <i /> Suggested next: 77.5 kg x 5
        </div>
        <div className="lv-add">+ Add set</div>
        <div className="lv-next">
          <strong>Bench press</strong>
          <small>Chest, barbell</small>
          <div className="lv-next-row">
            <span>1</span>
            <span>60 kg x 8</span>
            <span className="lv-field">62.5</span>
            <span className="lv-field">8</span>
          </div>
        </div>
        <div className="lv-vol">
          <span>Volume</span>
          <span className="lv-swap">
            <b className="lv-v1">500 kg</b>
            <b className="lv-v2">1,080 kg</b>
            <b className="lv-v3">1,530 kg</b>
          </span>
        </div>
        <div className="lv-toast">New best: 75 kg</div>
        {note && (
          <div className="lv-note">
            <b>Coach</b> Great depth. Add 2.5 kg on Thursday.
          </div>
        )}
      </div>
    </div>
  );
}

const WEEKS = [0.42, 0.46, 0.5, 0.53, 0.57, 0.6, 0.64];

/** The progress screen. The volume number and this week's bar grow as the sets are ticked on the logger. */
export function LiveProgress() {
  return (
    <div className="lv" aria-hidden="true">
      <div className="lv-in">
        <Bar />
        <div className="lv-head">
          <strong>Progress</strong>
          <small>Strength, cardio, body</small>
        </div>
        <div className="lv-tiles">
          <div className="lv-tile">
            <small>Volume today</small>
            <span className="lv-swap lv-big">
              <b className="lv-v1">500 kg</b>
              <b className="lv-v2">1,080 kg</b>
              <b className="lv-v3">1,530 kg</b>
            </span>
          </div>
          <div className="lv-tile">
            <small>Week streak</small>
            <span className="lv-big lv-amber">8</span>
          </div>
        </div>
        <div className="lv-chart-title">Weekly volume</div>
        <div className="lv-chart">
          {WEEKS.map((h, i) => (
            <i key={i} style={{ transform: `scaleY(${h})` }} />
          ))}
          <i className="lv-grow" />
        </div>
        <div className="lv-toast lv-toast-green">Streak kept</div>
      </div>
    </div>
  );
}

const ROWS: { name: string; tag: string; credits: number; next: string }[] = [
  { name: "Bella Lim", tag: "Hypertrophy", credits: 8, next: "Wed 11 Nov" },
  { name: "Cara Ng", tag: "Fat loss", credits: 5, next: "Wed 11 Nov" },
  { name: "Dan Ong", tag: "Conditioning", credits: 5, next: "Tue 10 Nov" },
];

/** The coach's client list. Alice's row and a banner react to each set she ticks, and the coach's note goes back to her. */
export function LiveClients() {
  return (
    <div className="lv" aria-hidden="true">
      <div className="lv-in">
        <Bar />
        <div className="lv-banners">
          <div className="lv-banner lv-b1">Alice logged set 2</div>
          <div className="lv-banner lv-b2">Alice hit a new best</div>
          <div className="lv-banner lv-b3">Note sent to Alice</div>
        </div>
        <div className="lv-head">
          <strong>Clients</strong>
          <small>7 active clients</small>
        </div>
        <div className="lv-client lv-client-live">
          <div className="lv-client-top">
            <span className="lv-ava lv-ava-big">AT</span>
            <span className="lv-name">
              Alice Tan<small>Strength</small>
            </span>
            <span className="lv-status lv-swap">
              <b className="lv-s1">Training now</b>
              <b className="lv-s2">2 sets</b>
              <b className="lv-s3">3 sets, new best</b>
              <b className="lv-s4">Note sent</b>
            </span>
          </div>
          <div className="lv-mini">
            <span>
              <b>8</b>
              <small>credits</small>
            </span>
            <span>
              <b>Tue 10 Nov</b>
              <small>next session</small>
            </span>
          </div>
        </div>
        {ROWS.map((r) => (
          <div className="lv-client" key={r.name}>
            <div className="lv-client-top">
              <span className="lv-ava lv-ava-big lv-ava-alt">{r.name.split(" ").map((p) => p[0]).join("")}</span>
              <span className="lv-name">
                {r.name}
                <small>{r.tag}</small>
              </span>
            </div>
            <div className="lv-mini">
              <span>
                <b>{r.credits}</b>
                <small>credits</small>
              </span>
              <span>
                <b>{r.next}</b>
                <small>next session</small>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
