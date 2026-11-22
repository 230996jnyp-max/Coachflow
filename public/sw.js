/* CoachFlow service worker: offline shell + runtime caching. */
const VERSION = "coachflow-v2";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

// The screens of the app. They are plain shells (the person's data is loaded by the page after it starts), so one copy serves everyone.
const APP_ROUTES = ["/home", "/workout", "/schedule", "/nutrition", "/progress", "/classes", "/exercises", "/book", "/messages", "/notifications", "/settings", "/programs", "/ai-trainer", "/trainer"];

// A workout opens at /workout/<id>, and a new workout's id exists only on the phone, so its page can't have been saved. Every workout page is the
// same shell with the id inside it, so one saved copy (made with this stand-in id, the same length as a real one) is reused with the real id put in.
const TEMPLATE_ID = "w_offlinetmpl1";
const WORKOUT_PAGE = /^\/workout\/(w_[A-Za-z0-9-]{12})$/;

// On a weak signal a request can hang for a long time. When a saved copy exists, give the network this long before using it.
const SLOW_MS = 5000;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.addAll(["/login", "/manifest.webmanifest"]).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** fetch(), but gives up (rejects) after `ms`. */
function fetchWithin(req, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(req, { signal: ctl.signal }).finally(() => clearTimeout(timer));
}

/** What to show for an address that has no saved copy and can't be loaded: a workout page rebuilt from the saved shell, else the nearest saved screen. */
async function offlineFallback(cache, url) {
  const m = WORKOUT_PAGE.exec(url.pathname);
  if (m) {
    const shell = await cache.match(`/workout/${TEMPLATE_ID}`);
    if (shell) {
      const html = (await shell.text()).split(TEMPLATE_ID).join(m[1]);
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (await cache.match("/workout")) return Response.redirect(new URL("/workout", url.origin).href, 302);
  }
  if (await cache.match("/home")) return Response.redirect(new URL("/home", url.origin).href, 302);
  return (await cache.match("/login")) || Response.error();
}

/** Keeps a cache to its newest `max` entries (old versions of the app's scripts would otherwise pile up). */
async function trim(name, max) {
  try {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((k) => cache.delete(k)));
  } catch {
    /* best effort */
  }
}

/** Saves one app screen and the scripts and styles it needs, so it opens with no signal. Never throws. */
async function saveScreen(path) {
  try {
    const pages = await caches.open(PAGE_CACHE);
    const res = await fetch(path, { credentials: "same-origin" });
    // A redirect means this is not the screen itself (for example a sign-in page): don't keep it under this address.
    if (!res.ok || res.redirected || !(res.headers.get("content-type") || "").includes("text/html")) return;
    const html = await res.clone().text();
    await pages.put(path, res);
    const files = new Set();
    for (const m of html.matchAll(/(?:\/_next\/)?static\/[A-Za-z0-9_\-./%~\[\]]+?\.(?:js|css)/g)) files.add("/_next/" + m[0].replace(/^\/_next\//, ""));
    const statics = await caches.open(STATIC_CACHE);
    await Promise.all(
      [...files].map(async (f) => {
        if (await statics.match(f)) return;
        const r = await fetch(f).catch(() => null);
        if (r && r.ok) await statics.put(f, r);
      }),
    );
  } catch {
    /* best effort */
  }
}

// The app asks for the screens to be saved after it has loaded (and sends the page's own address so a screen opened by link is kept too).
self.addEventListener("message", (event) => {
  const d = event.data || {};
  if (d.type === "save-screens") {
    event.waitUntil(
      Promise.all([...APP_ROUTES, `/workout/${TEMPLATE_ID}`].map(saveScreen)).then(() => Promise.all([trim(STATIC_CACHE, 700), trim(PAGE_CACHE, 400)])),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Static build assets + icons: stale-while-revalidate.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pwa-icon/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
    return;
  }

  // Navigations: network first (a saved copy is used when it is slow or there is no signal), then the home screen, then the login shell.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGE_CACHE);
        const saved = await cache.match(req, { ignoreSearch: true });
        try {
          const res = saved ? await fetchWithin(req, SLOW_MS) : await fetch(req);
          if (res.ok && !res.redirected) cache.put(req, res.clone());
          return res;
        } catch {
          return saved || (await offlineFallback(cache, url));
        }
      })(),
    );
    return;
  }

  // Moving between screens inside the app (Next asks for each screen's data): the same, so screens already seen still open with no signal.
  if (url.searchParams.has("_rsc") || req.headers.get("RSC") === "1") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGE_CACHE);
        const saved = await cache.match(req, { ignoreVary: true });
        try {
          const res = saved ? await fetchWithin(req, SLOW_MS) : await fetch(req);
          if (res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return saved || Response.error();
        }
      })(),
    );
  }
});

// A push from the server (bookings, messages, reminders). Skipped while CoachFlow is open and in front: the app already shows it.
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: "CoachFlow", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      if (list.some((c) => c.visibilityState === "visible" && c.focused)) return undefined;
      return self.registration.showNotification(d.title || "CoachFlow", {
        body: d.body || "",
        icon: "/pwa-icon/192",
        badge: "/pwa-icon/192",
        tag: d.tag || undefined,
        data: { url: d.url || "/" },
      });
    }),
  );
});

// Focus (or open) the app when a notification is tapped.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/messages";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.navigate(url).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
