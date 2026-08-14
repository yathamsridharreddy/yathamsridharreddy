# 🏎️ Velocity Rush

A 3D street-racing game that runs in your **laptop browser** — with a twist:
**your phones become wireless joysticks**. Scan a QR code with one or two
phones and drive with dual virtual sticks while the race renders full-screen
on the laptop.

Built with [three.js](https://threejs.org/) (WebGL), WebAudio engine/skid
sound synthesized in code, and a tiny Node.js relay server
(WebSocket with an SSE + POST fallback).

![stack](https://img.shields.io/badge/three.js-r128-black) ![stack](https://img.shields.io/badge/node-%3E%3D18-green)

## How to play

1. **Start the server**

   ```bash
   cd car-game
   npm install
   npm start            # → http://localhost:3000
   ```

2. **Open the game on the laptop** — `http://localhost:3000` (or your
   machine's LAN IP / a public preview URL so phones can reach it).

3. **Scan the QR code** shown on the start screen with **one or two phones**.
   Each phone opens the controller page and joins as Player 1 / Player 2.

4. Pick a mode and hit **START ENGINE**:

   | Mode | Description |
   |------|-------------|
   | 🏁 **2 Cars — Race** | Each phone drives its own car — **first to finish 3 laps wins**, with a 3‑2‑1‑GO countdown, live standings, winner banner + podium results. |
   | 🤝 **1 Car — Co-op** | One car, two drivers: P1 steers, P2 works the pedals. Beat your best 3‑lap time. |

### Controls

| Who | Input |
|-----|-------|
| Laptop keyboard | `W A S D` / arrows drive P1 · `Shift` **nitro 🔥** · `Space` drift · `C` camera · `R` reset · `M` mode · `H` help |
| Phone (per player) | **Left stick** steer · **Right stick** gas/brake · **🔥 NITRO** boost · **DRIFT** handbrake · **CAM / RST / HORN** buttons |

### Race features

- 3‑2‑1‑GO countdown with engine revving on the grid
- Nitro boost (regenerating meter) with exhaust flames + FOV kick
- Asphalt-style feel: speed-based FOV stretch, camera shake, drift smoke,
  persistent skid marks, sparks on impact, speed-line overlay, hit flash
- Broadcast-style camera that zooms out to keep **both cars in frame**,
  plus an edge-of-screen arrow pointing at the rival car
- FINISH gantry, final-lap alert, winner banner with confetti 🎉,
  podium results screen with total time + best lap, instant **REMATCH**
- Phones show live speed, nitro meter, position, and race banners (GO!, winner…)

The phones show live speed + lap telemetry, support fullscreen + landscape
lock (⛶), vibration, and wake-lock. Up to two phones connect at once; slots
are freed automatically when a phone disconnects.

## Architecture

```
┌─────────────┐  input (WS / SSE+POST)  ┌───────────┐  relay  ┌──────────────┐
│  Phone P1   │ ───────────────────────▶│  Node.js  │ ───────▶│ Laptop screen│
│  Phone P2   │ ◀───────────────────────│  relay    │ ◀───────│ (three.js)   │
└─────────────┘   telemetry (speed/lap) └───────────┘         └──────────────┘
```

- `server.js` — static hosting + slot assignment (P1/P2) + message relay.
- `public/index.html` + `js/game.js` — the 3D game: elliptic circuit,
  buildings/trees/mountains, arcade-drift physics, lap timing, minimap,
  chase/hood cameras, synthesized engine & skid audio, drift smoke.
- `public/controller.html` + `js/controller.js` — the phone joystick UI
  (multi-touch pointer capture, 30 Hz input stream, reconnect w/ backoff).
- `js/net.js` — shared transport: tries WebSocket, falls back to
  SSE + POST if a proxy blocks WS upgrades.

## Tests

Integration tests exercised in development (Node): relay protocol (slot
assignment, input/telemetry routing, disconnect/rejoin, SSE fallback), the
phone controller UI under jsdom, and headless runs of the full game scene +
car physics.

## Notes

- Phones reach the game through whatever URL the laptop serves (LAN IP or a
  public tunnel/preview URL) — the QR code always encodes the correct origin.
- Works fully offline once loaded: three.js and the QR encoder are vendored
  in `public/js/vendor/`.
