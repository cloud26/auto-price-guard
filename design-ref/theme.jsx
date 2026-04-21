// Shared theme tokens + Tweaks wiring.
// Light and dark palettes. Accent defaults to JD red; swappable.

const ACCENT_CHOICES = {
  'JD 红':    { hex: '#E03B3B', name: 'JD 红' },
  '珊瑚':     { hex: '#F06A4E', name: '珊瑚' },
  '琥珀':     { hex: '#D68A2A', name: '琥珀' },
  '森林':     { hex: '#2F8F63', name: '森林' },
  '石青':     { hex: '#3A7BD5', name: '石青' },
  '紫墨':     { hex: '#7A5CC9', name: '紫墨' },
};

// Given a hex accent, build a palette keyed for light/dark.
function buildTheme(accentHex, mode) {
  const isDark = mode === 'dark';
  return {
    mode,
    accent: accentHex,
    accentSoft: isDark ? accentHex + '22' : accentHex + '14',
    accentText: accentHex,
    // Window chrome
    chromeBg: isDark ? '#1F1F22' : '#ECECEE',
    chromeText: isDark ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.65)',
    // Surface
    bg:        isDark ? '#1A1A1D' : '#F5F5F7',
    surface:   isDark ? '#26262A' : '#FFFFFF',
    surface2:  isDark ? '#2D2D32' : '#F9F9FB',
    surfaceInset: isDark ? '#141416' : '#F0F0F2',
    // Text
    text:      isDark ? '#F4F4F6' : '#1D1D1F',
    textMuted: isDark ? 'rgba(244,244,246,.62)' : 'rgba(29,29,31,.56)',
    textSubtle:isDark ? 'rgba(244,244,246,.38)' : 'rgba(29,29,31,.38)',
    // Lines
    line:      isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)',
    lineStrong:isDark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.1)',
    // Semantic
    success:   isDark ? '#3FD07A' : '#2FA85C',
    danger:    isDark ? '#FF6961' : '#E0433B',
    warning:   isDark ? '#FFB84A' : '#DB8A15',
    // Log
    logBg:     isDark ? '#141416' : '#1C1C1E',
    logText:   isDark ? '#B5B5BA' : '#B5B5BA',
    logMuted:  isDark ? 'rgba(181,181,186,.5)' : 'rgba(181,181,186,.55)',
    logSuccess: '#9BE39B',
    logAccent: '#FFB45E',
  };
}

// System font stack used everywhere. SF for Latin, PingFang for CJK.
const SYSTEM_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Helvetica Neue", sans-serif';
const DISPLAY_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Helvetica Neue", sans-serif';
const MONO_FONT = '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace';

// Traffic lights — shared between variations
function TrafficLights({ active = true }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {['#FF5F57', '#FEBC2E', '#28C840'].map((c, i) => (
        <div key={i} style={{
          width: 12, height: 12, borderRadius: 6,
          background: active ? c : '#C8C8CC',
          boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,.08)',
        }}/>
      ))}
    </div>
  );
}

// Status pip
function StatusDot({ color, pulse }) {
  return (
    <span style={{ position: 'relative', width: 8, height: 8, display: 'inline-block' }}>
      {pulse && (
        <span style={{
          position: 'absolute', inset: -3, borderRadius: '50%',
          background: color, opacity: .25,
          animation: 'jd-pulse 1.6s ease-out infinite',
        }}/>
      )}
      <span style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: color,
      }}/>
    </span>
  );
}

// Inject one-time keyframes + base style
if (typeof document !== 'undefined' && !document.getElementById('jd-theme-styles')) {
  const s = document.createElement('style');
  s.id = 'jd-theme-styles';
  s.textContent = `
    @keyframes jd-pulse {
      0% { transform: scale(1); opacity: .4; }
      100% { transform: scale(2.4); opacity: 0; }
    }
    @keyframes jd-breathe {
      0%, 100% { opacity: .5; }
      50% { opacity: 1; }
    }
    @keyframes jd-spin { to { transform: rotate(360deg); } }
    @keyframes jd-sweep {
      0%   { transform: translateX(-100%); }
      100% { transform: translateX(300%); }
    }
    @keyframes jd-countup {
      0% { transform: translateY(8px); opacity: 0; }
      100% { transform: translateY(0); opacity: 1; }
    }
    @keyframes jd-notif-in {
      0% { transform: translateX(40px); opacity: 0; }
      100% { transform: translateX(0); opacity: 1; }
    }
    .jd-num { font-variant-numeric: tabular-nums; }
  `;
  document.head.appendChild(s);
}

Object.assign(window, {
  ACCENT_CHOICES, buildTheme, SYSTEM_FONT, DISPLAY_FONT, MONO_FONT,
  TrafficLights, StatusDot,
});
