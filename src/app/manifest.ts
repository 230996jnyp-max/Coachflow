import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CoachFlow — PT Tracker & Booking",
    short_name: "CoachFlow",
    description: "Workout tracker, client progress and session booking for personal training.",
    id: "/",
    lang: "en-SG",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#090B10",
    theme_color: "#090B10",
    categories: ["fitness", "health", "lifestyle"],
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Start workout", url: "/workout", description: "Log a workout" },
      { name: "Book a session", url: "/book", description: "Open the booking calendar" },
    ],
  };
}
