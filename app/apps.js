/*
 * Launcher configuration. Edit this file to change which apps appear.
 *
 * dock:  the main row under the banner (up to 8).
 * more:  the "All apps" grid below it.
 *
 * Each app:
 *   name   label shown on screen
 *   ids    webOS app IDs to try, in order (first one found is opened)
 *   color  brand colour for the tile background
 *   hero   banner colours and text when focused (dock only)
 *
 * Apps installed on the TV that are not listed here are added to the end
 * of "All apps" automatically.
 */
var LAUNCHER_CONFIG = {
  profileInitial: "V",

  /* LG's own apps are hidden except these (HDMI inputs always show) */
  showLgApps: ["com.webos.app.browser", "com.webos.app.discovery"],

  dock: [
    {
      name: "Live TV",
      ids: ["com.webos.app.livetv"],
      color: "#1565C0",
      hero: { base: "#0A1628", tint: "#1A55B0", glow: "#3B82F6",
              label: "Broadcast", title: "Live TV",
              desc: "Jump straight into live channels." }
    },
    {
      name: "Netflix",
      ids: ["netflix"],
      color: "#E50914",
      hero: { base: "#1A0506", tint: "#B71C1C", glow: "#E53935",
              label: "Streaming", title: "Netflix",
              desc: "Series, films and your Continue Watching row." }
    },
    {
      name: "YouTube",
      ids: ["youtube.leanback.v4"],
      color: "#FF0000",
      hero: { base: "#1A0808", tint: "#C62828", glow: "#EF5350",
              label: "Video", title: "YouTube",
              desc: "Your subscriptions and recommendations on the big screen." }
    },
    {
      name: "Prime Video",
      ids: ["amazon"],
      color: "#00A8E1",
      hero: { base: "#061820", tint: "#0277BD", glow: "#29B6F6",
              label: "Streaming", title: "Prime Video",
              desc: "Movies and shows from your Prime watchlist." }
    },
    {
      name: "JioHotstar",
      ids: ["hotstar"],
      color: "#0F1014",
      hero: { base: "#06081A", tint: "#1E2A78", glow: "#3949AB",
              label: "Streaming", title: "JioHotstar",
              desc: "Cricket, Indian originals and the latest shows." }
    },
    {
      name: "ZEE5",
      ids: ["com.zee5.app"],
      color: "#2B0B3A",
      hero: { base: "#14061C", tint: "#6A1B9A", glow: "#AB47BC",
              label: "Streaming", title: "ZEE5",
              desc: "Shows, films and live TV in every Indian language." }
    },
    {
      name: "Sony LIV",
      ids: ["com.sonyliv2.tvapp"],
      color: "#111111",
      hero: { base: "#0E0E12", tint: "#37474F", glow: "#607D8B",
              label: "Streaming", title: "Sony LIV",
              desc: "Sports, originals and Sony shows." }
    },
    {
      name: "Disney+",
      ids: ["com.disney.disneyplus-prod"],
      color: "#113CCF",
      hero: { base: "#060E2A", tint: "#1A47B8", glow: "#5C6BC0",
              label: "Streaming", title: "Disney+",
              desc: "Family favourites and new originals." }
    },
    {
      name: "Spotify",
      ids: ["spotify-beehive"],
      color: "#1DB954",
      hero: { base: "#061A0C", tint: "#1B8A40", glow: "#4CAF50",
              label: "Music", title: "Spotify",
              desc: "Your playlists, albums and podcasts." }
    },
    {
      name: "Photos",
      ids: ["com.webos.app.photovideo", "com.webos.app.mediadiscovery"],
      color: "#FF9500",
      hero: { base: "#1A1006", tint: "#E65100", glow: "#FB8C00",
              label: "Media", title: "Photos & Videos",
              desc: "Play photos, videos and music from USB or your home network." }
    },
    {
      name: "Settings",
      ids: ["com.palm.app.settings"],
      color: "#636366",
      hero: { base: "#101114", tint: "#3A3D46", glow: "#5D616C",
              label: "System", title: "Settings",
              desc: "Picture, sound, network and connected devices." }
    }
  ],

  more: [
    { name: "Browser",      ids: ["com.webos.app.browser"],    color: "#4285F4" },
    { name: "HDMI 1",       ids: ["com.webos.app.hdmi1"],      color: "#3A3A3C" },
    { name: "HDMI 2",       ids: ["com.webos.app.hdmi2"],      color: "#3A3A3C" },
    { name: "HDMI 3",       ids: ["com.webos.app.hdmi3"],      color: "#3A3A3C" },
    { name: "HDMI 4",       ids: ["com.webos.app.hdmi4"],      color: "#3A3A3C" },
    { name: "LG Channels",  ids: ["com.webos.app.lgchannels"], color: "#A5004F" },
    { name: "Screen Share",  ids: ["com.webos.app.miracast"],   color: "#0097A7" },
    { name: "Apps",          ids: ["com.webos.app.discovery"],  color: "#5E35B1" }
  ]
};
