const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();

const stage = document.getElementById('hero');
const lens = document.getElementById('lens');
const lensGlass = lens.liquidGlass;

// Floating lens: drifts over the name, can be grabbed and dragged
(() => {
  const pos = { x: 0, y: 0 };
  let drag = null, idleUntil = 0;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const place = () => { lens.style.translate = `${pos.x}px ${pos.y}px`; };

  lens.addEventListener('pointerdown', e => {
    lens.setPointerCapture(e.pointerId);
    drag = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    lens.classList.add('is-grabbed');
    lensGlass.animateStrength(1.35);
  });
  lens.addEventListener('pointermove', e => {
    if (!drag) return;
    const w = lens.offsetWidth, h = lens.offsetHeight;
    pos.x = clamp(e.clientX - drag.dx, -w / 2, stage.clientWidth - w / 2);
    pos.y = clamp(e.clientY - drag.dy, -h / 2, stage.clientHeight - h / 2);
    place();
  });
  const release = () => {
    if (!drag) return;
    drag = null;
    lens.classList.remove('is-grabbed');
    lensGlass.animateStrength(1);
    idleUntil = performance.now() + 2500;
  };
  lens.addEventListener('pointerup', release);
  lens.addEventListener('pointercancel', release);

  // Drift path follows the name: wide sweep across it, gentle bob over the letters
  const name = stage.querySelector('.name');
  const target = now => {
    const w = lens.offsetWidth, h = lens.offsetHeight;
    const cx = name.offsetLeft + name.offsetWidth / 2 - w / 2;
    const cy = name.offsetTop + name.offsetHeight * 0.66 - h / 2;
    return {
      x: cx + name.offsetWidth * 0.42 * Math.sin(now / 2600),
      y: cy + name.offsetHeight * 0.25 * Math.sin(now / 1700)
    };
  };

  // Start over the name; reduced motion keeps it still but draggable
  Object.assign(pos, target(0));
  place();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  (function float(now) {
    if (!drag && now > idleUntil) {
      const t = target(now);
      pos.x += (t.x - pos.x) * 0.06;
      pos.y += (t.y - pos.y) * 0.06;
      place();
    }
    requestAnimationFrame(float);
  })(0);
})();

// Customisation panel: every control maps onto the lens, choices persist per visitor
(() => {
  const form = document.getElementById('glass-panel');
  const STORAGE_KEY = 'boru-glass-settings';

  const PRESETS = {
    clear:   { frost: 0,  refraction: 0.4,  bezel: 0.28, highlight: 0.9,  vibrancy: 1.6, tint: 'none' },
    frosted: { frost: 10, refraction: 0.25, bezel: 0.32, highlight: 0.75, vibrancy: 1.3, tint: 'frost' },
    crystal: { frost: 0,  refraction: 0.75, bezel: 0.45, highlight: 1,    vibrancy: 1.8, tint: 'none' },
    candy:   { frost: 4,  refraction: 0.45, bezel: 0.3,  highlight: 0.85, vibrancy: 2,   tint: 'violet' }
  };
  const DEFAULTS = { preset: 'clear', shape: 'circle', size: 1, shadow: 'soft', ...PRESETS.clear };

  const TINTS = {
    none:   { fill: 'rgba(255, 255, 255, 0.02)', glow: 'rgba(148, 163, 184, 0.45)' },
    frost:  { fill: 'rgba(255, 255, 255, 0.16)', glow: 'rgba(226, 232, 240, 0.45)' },
    aqua:   { fill: 'rgba(34, 211, 238, 0.2)',   glow: 'rgba(34, 211, 238, 0.6)' },
    violet: { fill: 'rgba(139, 92, 246, 0.22)',  glow: 'rgba(139, 92, 246, 0.65)' },
    peach:  { fill: 'rgba(251, 146, 60, 0.22)',  glow: 'rgba(251, 146, 60, 0.6)' },
    mint:   { fill: 'rgba(52, 211, 153, 0.2)',   glow: 'rgba(52, 211, 153, 0.6)' }
  };

  const SHADOWS = {
    none: '0 0 0 transparent',
    soft: '0 18px 50px -12px var(--shadow)',
    glow: '0 18px 60px -8px var(--lens-glow), 0 6px 18px -6px var(--shadow)'
  };

  const FORMAT = {
    size: v => Math.round(v * 100) + '%',
    frost: v => v + 'px',
    refraction: v => Math.round(v * 100) + '%',
    bezel: v => Math.round(v * 100) + '%',
    highlight: v => Math.round(v * 100) + '%',
    vibrancy: v => Number(v).toFixed(1) + '×'
  };
  const PRESET_KEYS = Object.keys(PRESETS.clear);

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === 'object') {
        const merged = { ...DEFAULTS };
        for (const k in DEFAULTS) if (k in saved) merged[k] = saved[k];
        return merged;
      }
    } catch (e) { /* storage unavailable: fall back to defaults */ }
    return { ...DEFAULTS };
  }

  function save(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  function apply(s) {
    const tint = TINTS[s.tint] || TINTS.none;
    lens.dataset.shape = s.shape;
    lens.style.setProperty('--lens-scale', s.size);
    lens.style.setProperty('--tint', tint.fill);
    lens.style.setProperty('--lens-glow', tint.glow);
    lens.style.setProperty('--lens-shadow', SHADOWS[s.shadow] || SHADOWS.soft);
    lens.style.setProperty('--spec-opacity', s.highlight);
    lensGlass.set({
      surface: s.shape === 'circle' ? 'circle' : 'squircle',
      frost: Number(s.frost),
      thicknessRatio: Number(s.refraction),
      bezelRatio: Number(s.bezel),
      saturation: Number(s.vibrancy)
    });
  }

  function paintSlider(input) {
    const pct = (input.value - input.min) / (input.max - input.min) * 100;
    input.style.setProperty('--fill', pct + '%');
    form.elements[input.name + '-out'].value = FORMAT[input.name](input.value);
  }

  function writeForm(s) {
    for (const el of form.elements) {
      if (!el.name || el.tagName === 'OUTPUT') continue;
      if (el.type === 'radio') el.checked = s[el.name] === el.value;
      else if (el.type === 'range') { el.value = s[el.name]; paintSlider(el); }
    }
  }

  let settings = load();
  writeForm(settings);
  apply(settings);

  form.addEventListener('input', e => {
    const el = e.target;
    if (el.name === 'preset') {
      settings = { ...settings, ...PRESETS[el.value], preset: el.value };
      writeForm(settings);
    } else {
      settings[el.name] = el.type === 'range' ? Number(el.value) : el.value;
      if (el.type === 'range') paintSlider(el);
      // Hand-tuning a recipe value turns the recipe into a custom mix
      if (PRESET_KEYS.includes(el.name) && settings.preset) {
        settings.preset = '';
        form.querySelectorAll('input[name="preset"]').forEach(r => { r.checked = false; });
      }
    }
    apply(settings);
    save(settings);
  });

  form.addEventListener('reset', e => {
    e.preventDefault();
    settings = { ...DEFAULTS };
    writeForm(settings);
    apply(settings);
    save(settings);
  });

  form.addEventListener('submit', e => e.preventDefault());
})();
