'use strict';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Front-end cap for timing values (ms). API has no upper limit; this keeps the
// UI sane. Bump if you need longer envelopes.
const MAX_MS = 10000;

// Named color palette for the grid. Add/remove entries here in one place.
// The five required colors are the first five.
const COLORS = [
    { name: 'Black',        hex: '#000000' },
    { name: 'White',        hex: '#FFFFFF' },
    { name: 'Red',          hex: '#FF0000' },
    { name: 'Green',        hex: '#00FF00' },
    { name: 'Blue',         hex: '#0000FF' },
    { name: 'Cyan',         hex: '#00FFFF' },
    { name: 'Magenta',      hex: '#FF00FF' },
    { name: 'Yellow',       hex: '#FFFF00' },
    { name: 'Orange',       hex: '#FF8C00' },
    { name: 'Purple',       hex: '#640080' },
    { name: 'Pink',         hex: '#FF69B4' },
    { name: 'Warm White',   hex: '#FFE4B5' },
    { name: 'Deep Sky',     hex: '#00BFFF' },
    { name: 'Spring Green', hex: '#00FF7F' },
    { name: 'Amber',        hex: '#FFBF00' },
    { name: 'Crimson',      hex: '#DC143C' }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 8000 } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(resource, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(id);
    }
}

function getHost() {
    return document.getElementById('host').value;
}

function clampMs(value) {
    let n = parseInt(value, 10);
    if (isNaN(n) || n < 0) n = 0;
    if (n > MAX_MS) n = MAX_MS;
    return n;
}

function getTiming() {
    return {
        ramp: clampMs(document.getElementById('ramp-num').value),
        hold: clampMs(document.getElementById('hold-num').value),
        fade: clampMs(document.getElementById('fade-num').value)
    };
}

// ---------------------------------------------------------------------------
// Status box
// ---------------------------------------------------------------------------

const statusBox = document.getElementById('status');

function setStatus(state, html) {
    statusBox.className = 'status-box status-' + state; // ok | fail | error | pending
    statusBox.innerHTML = html;
}

function now() {
    return new Date().toLocaleTimeString();
}

// ---------------------------------------------------------------------------
// Timing sliders <-> number boxes (two-way sync)
// ---------------------------------------------------------------------------

['ramp', 'hold', 'fade'].forEach((key) => {
    const num = document.getElementById(key + '-num');
    const range = document.getElementById(key + '-range');
    const rangeMax = parseInt(range.max, 10);

    // Slider -> number
    range.addEventListener('input', () => {
        num.value = range.value;
    });

    // Number -> slider (clamped; slider only spans 0..rangeMax, numbers can exceed it)
    num.addEventListener('input', () => {
        const n = clampMs(num.value);
        range.value = Math.min(n, rangeMax);
    });

    // Normalize on blur (write the clamped value back)
    num.addEventListener('change', () => {
        num.value = clampMs(num.value);
        range.value = Math.min(parseInt(num.value, 10), rangeMax);
    });
});

// ---------------------------------------------------------------------------
// Core request: POST an oneshot (the flash verb)
// ---------------------------------------------------------------------------

async function flash(color) {
    const t = getTiming();
    const payload = { tool: 'oneshot', color, ramp: t.ramp, hold: t.hold, fade: t.fade };
    const url = getHost() + '/api/virtuals_tools';

    setStatus('pending', 'Sending ' + color + '...');

    let response;
    try {
        response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        const msg = err.name === 'AbortError' ? 'Request timed out' : err.message;
        setStatus('error',
            '<strong>Network error</strong> - ' + msg +
            '<div class="status-meta">' + color + ' &middot; ramp ' + t.ramp + ' / hold ' + t.hold + ' / fade ' + t.fade + ' &middot; ' + now() + '</div>');
        return;
    }

    // The API returns HTTP 200 on success but HTTP 202 on a failed payload,
    // so we trust the JSON "status" field, not response.ok.
    let data;
    try {
        data = await response.json();
    } catch (e) {
        setStatus('error',
            '<strong>Bad response</strong> - HTTP ' + response.status + ', not JSON' +
            '<div class="status-meta">' + color + ' &middot; ' + now() + '</div>');
        return;
    }

    if (data.status === 'success') {
        setStatus('ok',
            '<strong>Success</strong> <span class="status-swatch" style="background:' + color + '"></span> ' + color +
            '<div class="status-meta">HTTP ' + response.status + ' &middot; ramp ' + t.ramp + ' / hold ' + t.hold + ' / fade ' + t.fade + ' &middot; ' + now() + '</div>');
    } else {
        const reason = data.payload && data.payload.reason ? data.payload.reason : 'unknown reason';
        setStatus('fail',
            '<strong>Failed</strong> - ' + reason +
            '<div class="status-meta">HTTP ' + response.status + ' &middot; ' + color + ' &middot; ' + now() + '</div>');
    }
}

// ---------------------------------------------------------------------------
// Clear all oneshots (PUT disable verb)
// ---------------------------------------------------------------------------

async function clearOneshots() {
    const url = getHost() + '/api/virtuals_tools';
    setStatus('pending', 'Clearing oneshots...');

    let response;
    try {
        response = await fetchWithTimeout(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tool: 'oneshot' })
        });
    } catch (err) {
        const msg = err.name === 'AbortError' ? 'Request timed out' : err.message;
        setStatus('error', '<strong>Network error</strong> - ' + msg + '<div class="status-meta">' + now() + '</div>');
        return;
    }

    let data;
    try {
        data = await response.json();
    } catch (e) {
        setStatus('error', '<strong>Bad response</strong> - HTTP ' + response.status + ', not JSON<div class="status-meta">' + now() + '</div>');
        return;
    }

    if (data.status === 'success') {
        setStatus('ok', '<strong>Oneshots cleared</strong><div class="status-meta">HTTP ' + response.status + ' &middot; ' + now() + '</div>');
    } else {
        // API returns "failed" if no active oneshot was found to disable.
        const reason = data.payload && data.payload.reason ? data.payload.reason : (data.reason || 'no oneshots to clear');
        setStatus('fail', '<strong>Nothing cleared</strong> - ' + reason + '<div class="status-meta">HTTP ' + response.status + ' &middot; ' + now() + '</div>');
    }
}

// ---------------------------------------------------------------------------
// Build the color grid
// ---------------------------------------------------------------------------

function buildGrid() {
    const grid = document.getElementById('color-grid');
    const frag = document.createDocumentFragment();

    COLORS.forEach((c) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'swatch';
        btn.style.backgroundColor = c.hex;
        btn.dataset.color = c.hex;
        btn.title = c.name + ' (' + c.hex + ')';
        btn.innerHTML = '<span class="swatch-label">' + c.name + '<br><small>' + c.hex + '</small></span>';
        frag.appendChild(btn);
    });

    grid.appendChild(frag);

    // One delegated handler for every swatch.
    grid.addEventListener('click', (e) => {
        const btn = e.target.closest('.swatch');
        if (!btn) return;
        flash(btn.dataset.color);
    });
}

// ---------------------------------------------------------------------------
// Wire up
// ---------------------------------------------------------------------------

buildGrid();

document.getElementById('flash-custom').addEventListener('click', () => {
    flash(document.getElementById('color').value);
});

document.getElementById('clear-oneshots').addEventListener('click', clearOneshots);

// ---------------------------------------------------------------------------
// BPM -> Hold presets
// ---------------------------------------------------------------------------

// Note divisions expressed in beats (a quarter note = 1 beat).
const NOTE_PRESETS = [
    { name: '1',    beats: 4 },     // whole note
    { name: '1/2',  beats: 2 },     // half
    { name: '1/4',  beats: 1 },     // quarter (1 beat)
    { name: '1/8',  beats: 0.5 },   // eighth
    { name: '1/16', beats: 0.25 }   // sixteenth
];

// 60000 ms per minute / bpm = ms per beat (quarter note); scale by note length.
function bpmToMs(bpm, beats) {
    return Math.round((60000 / bpm) * beats);
}

function getBpm() {
    const v = parseFloat(document.getElementById('bpm-num').value);
    return (isFinite(v) && v > 0) ? v : null;
}

// Set the hold field + its slider (no event needed since we write both).
function setHold(ms) {
    const num = document.getElementById('hold-num');
    const range = document.getElementById('hold-range');
    const clamped = clampMs(ms);
    num.value = clamped;
    range.value = Math.min(clamped, parseInt(range.max, 10));
}

function updateBpmTooltips() {
    const bpm = getBpm();
    document.querySelectorAll('.bpm-btn').forEach((btn) => {
        if (bpm === null) { btn.title = 'Enter a BPM'; return; }
        const ms = bpmToMs(bpm, parseFloat(btn.dataset.beats));
        const capped = clampMs(ms);
        btn.title = btn.textContent + ' note = ' + ms + ' ms' +
            (capped !== ms ? ' (capped at ' + MAX_MS + ')' : '');
    });
}

function buildBpmPresets() {
    const wrap = document.getElementById('bpm-presets');
    NOTE_PRESETS.forEach((p) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-outline-info bpm-btn';
        btn.textContent = p.name;
        btn.dataset.beats = p.beats;
        btn.addEventListener('click', () => {
            const bpm = getBpm();
            if (bpm === null) {
                setStatus('fail', '<strong>Enter a valid BPM</strong><div class="status-meta">must be a number greater than 0</div>');
                return;
            }
            setHold(bpmToMs(bpm, p.beats));
        });
        wrap.appendChild(btn);
    });
    updateBpmTooltips();
}

document.getElementById('bpm-num').addEventListener('input', updateBpmTooltips);

buildBpmPresets();

// ---------------------------------------------------------------------------
// Tap tempo (adaptive outlier gate)
// ---------------------------------------------------------------------------

const TAP_RESET_MS     = 2000;  // a gap longer than this starts a fresh count
const TAP_WINDOW       = 8;      // average over at most this many taps
const TAP_SIGMA        = 2.5;    // reject a tap beyond this many std-devs of the spread
const TAP_MIN_TOL      = 0.15;   // floor on the gate, as a fraction of the mean interval
const TAP_FALLBACK_TOL = 0.35;   // fixed relative gate until we have enough taps to measure spread

let taps = [];              // accepted tap timestamps forming the current tempo
let lastTap = null;         // timestamp of the last ACCEPTED tap (grid reference)
let pendingOutlier = null;  // a rejected tap, kept to detect a real tempo change

// Average ms-per-beat across the accepted run: (last - first) / (count - 1).
// Mathematically identical to averaging consecutive gaps, without drift.
function currentInterval() {
    if (taps.length < 2) return null;
    return (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
}

// Consecutive gaps between accepted taps.
function intervals() {
    const d = [];
    for (let i = 1; i < taps.length; i++) d.push(taps[i] - taps[i - 1]);
    return d;
}

// Adaptive gate: judge a tap against how tightly the user is actually tapping.
// With enough history, reject beyond TAP_SIGMA standard deviations (with a floor
// so a near-perfect run doesn't become absurdly strict). Before that, fall back
// to a fixed relative tolerance.
function isOutlier(gap) {
    const d = intervals();
    if (d.length < 3) {
        const exp = currentInterval();
        return exp !== null && Math.abs(gap - exp) / exp > TAP_FALLBACK_TOL;
    }
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const variance = d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length;
    const sd = Math.sqrt(variance);
    const tol = Math.max(sd * TAP_SIGMA, mean * TAP_MIN_TOL);
    return Math.abs(gap - mean) > tol;
}

// Flash the beat indicator (restart the CSS animation each tap).
function pulse() {
    const dot = document.getElementById('tap-beat');
    if (!dot) return;
    dot.classList.remove('pulsing');
    void dot.offsetWidth; // force reflow so the animation replays
    dot.classList.add('pulsing');
}

function commitBpm(msPerBeat, note) {
    let bpm = Math.round(60000 / msPerBeat);
    bpm = Math.min(999, Math.max(1, bpm)); // clamp to the BPM field range
    const field = document.getElementById('bpm-num');
    field.value = bpm;
    field.dispatchEvent(new Event('input')); // refresh preset tooltips
    setStatus('ok', '<strong>Tap tempo</strong> - ' + bpm + ' BPM<div class="status-meta">' + note + '</div>');
}

function tapTempo() {
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Long pause since the last tap: start a brand new count.
    if (lastTap !== null && t - lastTap > TAP_RESET_MS) {
        taps = [];
        pendingOutlier = null;
    }

    // With a running tempo, screen each tap. The gap is measured from the last
    // ACCEPTED tap, so an ignored stray doesn't drag the grid reference and the
    // recovery tap still lands on-beat. A genuine tempo change is caught via
    // pendingOutlier (two off-beat taps in a row).
    if (currentInterval() !== null) {
        const gap = t - lastTap;
        if (isOutlier(gap)) {
            pulse();
            if (pendingOutlier !== null) {
                const newGap = t - pendingOutlier;
                taps = [pendingOutlier, t];
                pendingOutlier = null;
                lastTap = t;
                commitBpm(newGap, 'tempo change');
            } else {
                pendingOutlier = t; // ignore a lone stray; keep lastTap on the grid
                setStatus('pending', '<strong>Tap tempo</strong> - ignored off-beat tap');
            }
            return;
        }
    }

    // Normal tap.
    pendingOutlier = null;
    taps.push(t);
    if (taps.length > TAP_WINDOW) taps.shift();
    lastTap = t;
    pulse();

    const avg = currentInterval();
    if (avg === null) {
        setStatus('pending', '<strong>Tap tempo</strong> - keep tapping...');
        return;
    }
    commitBpm(avg, taps.length + ' taps');
}

document.getElementById('tap-tempo').addEventListener('click', tapTempo);
