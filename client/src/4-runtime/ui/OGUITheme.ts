/**
 * OGUITheme — OGUI (Original Gangster UI) Design System
 *
 * Neutral grey / system-debug aesthetic.
 * Single source of truth for all color tokens, font settings, and z-index layers.
 * Import this wherever inline styles reference color or spacing.
 *
 * Palette:
 *   Background family  →  near-black to dark-grey
 *   Border family      →  medium-grey, low opacity
 *   Text family        →  light grey hierarchy
 *   State colors       →  desaturated green / amber / red
 *   Feedback           →  muted hit/kill/death overlays
 */

// ─── Token map ────────────────────────────────────────────────────────────────

export const OGUI = {
  // ── Backgrounds ────────────────────────────────────────────────────────────
  /** Base overlay / widget panel */
  bgBase:      'rgba(11, 11, 11, 0.93)',
  /** Slightly lighter panels (rows, details) */
  bgPanel:     'rgba(18, 18, 18, 0.90)',
  /** Faint alternating row tint */
  bgRow:       'rgba(255, 255, 255, 0.025)',
  /** Selected / hovered background */
  bgSelected:  'rgba(180, 180, 180, 0.09)',
  /** Solid dark background for full-screen menus */
  bgMenu:      '#0c0c0c',
  /** Full-screen death overlay */
  bgOverlay:   'rgba(0, 0, 0, 0.86)',

  // ── Borders ────────────────────────────────────────────────────────────────
  /** Default widget border */
  border:      'rgba(80, 80, 80, 0.65)',
  /** Active / selected element border */
  borderSel:   'rgba(160, 160, 160, 0.75)',
  /** Dim separator lines (table rows, dividers) */
  borderDim:   'rgba(50, 50, 50, 0.55)',
  /** Alert / warning border */
  borderWarn:  'rgba(140, 90, 60, 0.60)',

  // ── Text ───────────────────────────────────────────────────────────────────
  /** Primary readable text */
  textPri:  '#c0c0c0',
  /** Secondary / label text */
  textSec:  '#727272',
  /** Active / selected text (slightly brighter) */
  textAct:  '#b8b8b8',
  /** Very dim — inactive, footnotes */
  textDim:  '#444444',
  /** Header / uppercase labels */
  textHead: '#888888',
  /** Version string / smallest copy */
  textVer:  '#3c3c3c',
  /** Full-white for maximum contrast (rare) */
  textWhite:'#d8d8d8',

  // ── Player-state colors (desaturated) ──────────────────────────────────────
  /** HP ≥ 50 % */
  hpFull: '#6aaa6c',
  /** HP 25–50 % */
  hpMid:  '#b89040',
  /** HP < 25 % */
  hpLow:  '#a84848',
  /** Ready / confirm */
  ok:     '#70a870',
  /** Not-ready / reject */
  warn:   '#a86060',

  // ── Combat feedback ────────────────────────────────────────────────────────
  /** Hit-marker (neutral shot confirmation) */
  hitFlash:   '#d0d0d0',
  /** Kill-confirm flash (brighter) */
  killFlash:  '#e8e8e8',
  /** Damage vignette overlay */
  dmgFlash:   'rgba(110, 18, 18, 0.55)',
  /** Death overlay background */
  deathBg:    'rgba(0, 0, 0, 0.88)',
  /** Death text */
  deathText:  '#b05050',

  // ── Toggle pill ────────────────────────────────────────────────────────────
  /** Feature ON */
  toggleOn:  '#70a870',
  /** Feature OFF */
  toggleOff: '#a87070',

  // ── Typography ─────────────────────────────────────────────────────────────
  font: '"Courier New", Courier, monospace',

  // ── Z-index layers ─────────────────────────────────────────────────────────
  zHUD:        1000,
  zFeedback:   8000,
  zMenu:       9000,
  zNetGraph:   9050,
  zDebug:      9100,
  zScoreboard: 9200,
  zDialog:     9500,
} as const;

// ─── Stylesheet injection ─────────────────────────────────────────────────────

/**
 * Inject the OGUI global stylesheet once into <head>.
 * Call this during engine init (OGUIManager.init() handles it).
 */
export function injectOGUIStylesheet(): void {
  if (document.getElementById('ogui-stylesheet')) return;

  const style = document.createElement('style');
  style.id = 'ogui-stylesheet';
  style.textContent = `
    /* ─── OGUI — design system ──────────────────────────────── */

    /* Scrollbar overrides */
    .ogui-scroll::-webkit-scrollbar              { width: 4px; height: 4px; }
    .ogui-scroll::-webkit-scrollbar-track        { background: transparent; }
    .ogui-scroll::-webkit-scrollbar-thumb        { background: rgba(80,80,80,0.5); border-radius: 2px; }
    .ogui-scroll::-webkit-scrollbar-thumb:hover  { background: rgba(120,120,120,0.6); }

    /* Range input reset */
    .ogui-range                                  { -webkit-appearance:none; appearance:none; height:3px; background:rgba(80,80,80,0.4); outline:none; cursor:pointer; }
    .ogui-range::-webkit-slider-thumb            { -webkit-appearance:none; width:9px; height:9px; background:#888; border-radius:50%; cursor:pointer; }

    /* Fade transition */
    .ogui-fade                                   { transition: opacity 0.08s ease; }

    /* Monospace utility */
    .ogui-mono                                   { font-family: "Courier New", Courier, monospace; }

    /* ─── Keyframe animations ────────────────────────────────── */
    @keyframes ogui-fadeout {
      from { opacity: 1; }
      to   { opacity: 0; }
    }
    @keyframes ogui-slidein {
      from { opacity: 0; transform: translateX(-50%) translateY(-6px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes ogui-flash {
      0%   { opacity: 1; }
      100% { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}
