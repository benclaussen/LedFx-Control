# One Shots — LedFx Oneshot Control Panel

A single-page web UI for firing **oneshot** color flashes at all active virtual
devices on a local [LedFx](https://ledfx.app) instance. It talks directly to the
LedFx REST API (`/api/virtuals_tools`) from the browser — no server, no build
step. Open the HTML file and go.

Beyond simple color flashes it adds musical timing tools: BPM-based note
presets, an adaptive tap-tempo, a free-running metronome, and a one-shot
blackout.

---

## Requirements

- A running **LedFx** instance reachable from your browser (default
  `http://127.0.0.1:8082`).
- One or more **active virtuals with effects running** — a oneshot layers *over*
  the active effect, so a virtual with no effect shows nothing.
- A modern browser (Chrome, Edge, Firefox). Bootstrap 5 (Cyborg theme) is
  bundled locally.

## Getting started

1. Start LedFx and confirm the API is up (e.g. `http://127.0.0.1:8082`).
2. Open `OneShots.html` in your browser.
3. Pick or type your LedFx host, then click a color swatch to flash it.

> **Serving note:** opening over `file://` and calling `http://127.0.0.1:8082`
> can trip CORS or mixed-content depending on how LedFx sets headers. If the
> status box shows a network error while LedFx is clearly up, serve the page
> from LedFx's origin or a local static server.

## Files

| File | Role |
|------|------|
| `OneShots.html` | Markup and layout (Bootstrap grid). |
| `js/custom.js`  | All behavior — requests, controls, tap/metronome logic. |
| `css/extras.css`| Styling on top of Bootstrap. |
| `bootstrap/`    | Bundled Bootstrap 5 Cyborg theme + JS. |

---

## How it talks to LedFx

All actions hit **`<host>/api/virtuals_tools`**.

**Flash a color** — `POST` with a oneshot payload:

```json
{ "tool": "oneshot", "color": "#FF0000", "ramp": 10, "hold": 500, "fade": 100 }
```

- `ramp` — ms to fade the color *in* from zero to full weight.
- `hold` — ms to hold at full weight.
- `fade` — ms to fade *out* back to zero.
- `color` — any CSS/LedFx-accepted color; the UI sends `#RRGGBB`.

**Clear all oneshots** — `PUT` with `{ "tool": "oneshot" }`. This is the API's
"off" verb; it disables active oneshots. (This is why flashing uses `POST` — an
early version mistakenly used `PUT` and cleared instead of flashed.)

### Success vs. failure detection

LedFx returns **HTTP 200 on success but HTTP 202 on a failed payload**, so both
look "ok" to `fetch`. The app therefore trusts the JSON `status` field, not the
HTTP code:

- `{"status":"success"}` → green status.
- `{"status":"failed","payload":{"reason":"..."}}` → orange status showing the
  reason (e.g. `Invalid color: fake`).
- Network failure / timeout (8s) → red status.

Every request routes through `fetchWithTimeout` (an `AbortController`-based 8s
timeout).

---

## Features

### Host picker
A single combobox: a text field backed by a `<datalist>` of built-in presets
(Local, Surface, Other Device) that also accepts any URL you type. There is no
built-in-vs-custom mode to toggle.

- **Normalization:** missing scheme gets `http://` prepended; trailing slashes
  are stripped. Applied both to the field (on commit) and to the actual request.
- **Memory:** any host you commit is saved to `localStorage` (key
  `ledfx_custom_hosts`) and reappears as a suggestion next time. Built-ins are
  never duplicated into the saved list.
- **Firefox note:** Firefox only shows datalist suggestions filtered by what
  you've typed (prefix match), and hides them entirely if `autocomplete="off"`
  is set (it isn't). Clear the field or press the down-arrow to see the full
  list.

### Timing controls (ramp / hold / fade)
Each has a **slider paired with a synced number box**. The slider spans
`0–5000 ms` for quick dialing; the number box accepts exact values up to a
front-end cap of `MAX_MS` (10000 ms). Values above the slider's max still send
correctly — the slider just pins at 5000.

### Color grid
A responsive grid of swatches built from the `COLORS` array (16 colors; the
first five are Black, White, Red, Green, Blue). Each swatch shows its hex on
hover and flashes on click. Add or remove colors by editing that one array —
no per-color CSS.

### Custom color + Flash
A native color picker plus a **Flash custom** button for arbitrary colors.

### BPM → Hold presets
Enter a **BPM**, then click a note-division button to drop the computed
millisecond value into the **hold** field (only hold; ramp and fade are left
alone, and no request is fired).

Math: one beat (quarter note) = `60000 / BPM` ms; each button scales by its note
length. Buttons: `1` (whole), `1/2`, `1/4`, `1/8`, `1/16`, `1/32`. Example at
111 BPM → 2162 / 1081 / 541 / 270 / 135 / 68 ms. Each button's hover tooltip
shows its live ms value and recomputes as you change BPM. Values above `MAX_MS`
are clamped.

Presets live in the `NOTE_PRESETS` array as `{ name, beats }` (beats relative to
a quarter note), so `1/32` is `{ name: '1/32', beats: 0.125 }`.

### Tap tempo (adaptive)
Click **Tap** in time with the music; BPM is `60000 / average_interval`,
averaged over a sliding window (`TAP_WINDOW`, default 8) using
`(last − first) / (count − 1)` to avoid drift. The beat dot pulses on each tap,
and tapping refreshes the preset tooltips automatically.

Robustness:

- **Adaptive outlier gate** — instead of a fixed tolerance, a tap is rejected
  only if it falls beyond `TAP_SIGMA` (2.5) standard deviations of your recent
  interval spread, with a floor of `TAP_MIN_TOL` (15%). This self-tunes: tap
  tightly and it clamps down, tap loosely and it widens — no genre-specific
  dial. Until there are enough taps to measure spread, it falls back to a fixed
  `TAP_FALLBACK_TOL` (35%).
- **Stray rejection** — a lone off-beat tap (double-tap / missed beat) is
  ignored; the grid reference is *not* advanced so the next tap stays on-beat.
- **Tempo change** — two off-beat taps in a row are treated as a deliberate
  tempo change and the new interval is adopted.
- **Pause reset** — a gap longer than `TAP_RESET_MS` (2s) starts a fresh count.

Tuning constants sit at the top of the tap-tempo section.

### Metronome
A **Metronome** toggle free-runs the beat dot at the current BPM (from the field,
however it was set). The dot stays faintly lit while running.

- **Drift-corrected scheduler** — beats are scheduled against an *absolute*
  target time (`setTimeout` recomputing the delay each tick) rather than a fixed
  `setInterval`, so it doesn't accumulate lateness.
- **Phase-aligned** to your last tap, so it continues on the grid your tapping
  established.
- **Live retune** — changing the BPM (typing, tapping, or a preset) adjusts the
  next beat with no restart. Empty BPM refuses to start; clearing it mid-run
  auto-stops.
- **Limitation:** browsers throttle timers to ~1s in a background tab, so the
  beat drifts if you switch away. Fine for a foreground panel.

### Blackout
A **Blackout (10s)** button fires a single black oneshot with a fixed 10-second
hold. The 10s hold is a per-call override — it is **not** written to the hold
field, so the field keeps its value and the next oneshot naturally overrides the
blackout. Uses the current ramp and fade. Constant: `BLACKOUT_HOLD` (10000 ms).
It shares a double-height row with **Clear all oneshots**.

### Status box
Shows the outcome of each request, color-coded by border:

- Green — success · Orange — API "failed" (with reason) · Red — network/timeout ·
  Blue — in-flight.

Each line's metadata leads with a 24-hour `HH:mm:ss` timestamp, e.g.
`21:01:26 · HTTP 200 · ramp 10 / hold 500 / fade 100`.

---

## Customization cheat-sheet

| Want to change… | Edit (in `js/custom.js`) |
|-----------------|--------------------------|
| Timing cap | `MAX_MS` |
| Color swatches | `COLORS` array |
| Note-division buttons | `NOTE_PRESETS` array |
| Built-in hosts | `BUILTIN_HOSTS` array |
| Blackout hold length | `BLACKOUT_HOLD` (raise `MAX_MS` too if > 10000) |
| Tap-tempo feel | `TAP_WINDOW`, `TAP_SIGMA`, `TAP_MIN_TOL`, `TAP_FALLBACK_TOL`, `TAP_RESET_MS` |
| Clear/Blackout height | `.action-tall` in `css/extras.css` |

Saved custom hosts persist in browser `localStorage` under `ledfx_custom_hosts`;
clear that key to forget them.

---

## Notes

- The UI sends colors as `#RRGGBB`, which LedFx accepts.
- Repeated oneshots stack per the API — a newer flash layers over an older one
  (including the blackout), which is how mid-blackout overrides work.
