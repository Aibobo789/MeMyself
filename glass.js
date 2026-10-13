/*
 * Liquid glass: per-element refraction maps applied through an SVG backdrop filter.
 * Technique: https://kube.io/blog/liquid-glass-css-svg/
 *
 * Usage: <div class="glass" data-glass='{"surface":"circle","bezel":60,"thickness":80}'></div>
 * The instance is exposed as element.liquidGlass.
 */
(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // SVG filters in backdrop-filter only work in Chromium; others get frosted blur
  const supportsRefraction = !!(navigator.userAgentData &&
    navigator.userAgentData.brands.some(b => b.brand === 'Chromium'));

  // Bezel height profiles, x: 0 = outer edge → 1 = flat interior
  const squircle = x => Math.pow(1 - Math.pow(1 - x, 4), 0.25);
  const smootherstep = x => x * x * x * (x * (6 * x - 15) + 10);
  const SURFACES = {
    circle: x => Math.sqrt(1 - (1 - x) ** 2),
    squircle,
    lip: x => {
      const convex = squircle(x);
      const s = smootherstep(x);
      return convex * (1 - s) + (1 - convex) * s;
    }
  };

  const DEFAULTS = {
    surface: 'squircle',
    bezel: 24,        // px, width of the curved rim
    thickness: 50,    // px, glass height: drives refraction strength
    // Optional: bezelRatio / thicknessRatio size these relative to the element's
    // shorter side instead, so the glass looks the same at any size
    bezelRatio: 0,
    thicknessRatio: 0,
    frost: 0,         // px, blur before refraction
    saturation: 1.4,
    ior: 1.5,         // index of refraction
    lightAngle: -125, // deg, specular light direction
    strength: 1       // multiplier, animate with animateStrength()
  };

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  let defs = null;
  function getDefs() {
    if (!defs) {
      const svgEl = document.createElementNS(SVG_NS, 'svg');
      svgEl.setAttribute('width', 0);
      svgEl.setAttribute('height', 0);
      svgEl.setAttribute('aria-hidden', 'true');
      svgEl.style.position = 'absolute';
      defs = document.createElementNS(SVG_NS, 'defs');
      svgEl.append(defs);
      document.body.append(svgEl);
    }
    return defs;
  }

  function svg(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  // Refraction along one bezel radius (Snell's law): signed px shift, positive = inward
  function bezelProfile(o, bezel) {
    const f = SURFACES[o.surface] || SURFACES.squircle;
    const N = 128, d = 0.001;
    const profile = new Float32Array(N);
    let max = 0;
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N;
      const slope = (f(Math.min(x + d, 1)) - f(Math.max(x - d, 0))) / (2 * d) * o.thickness / bezel;
      const incident = Math.atan(Math.abs(slope));
      const refracted = Math.asin(Math.sin(incident) / o.ior);
      const shift = f(x) * o.thickness * Math.tan(incident - refracted) * Math.sign(slope);
      profile[i] = shift;
      max = Math.max(max, Math.abs(shift));
    }
    return { profile, max };
  }

  // Displacement map (R = x, G = y, 128 = no shift) and specular rim, at device resolution
  function renderMaps(w, h, radius, bezel, o) {
    const { profile, max } = bezelProfile(o, bezel);
    const N = profile.length;
    const k = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(w * k), H = Math.round(h * k);
    const disp = ctx.createImageData(W, H);
    const spec = ctx.createImageData(W, H);
    const lx = Math.cos(o.lightAngle * Math.PI / 180);
    const ly = Math.sin(o.lightAngle * Math.PI / 180);
    const hx = w / 2 - radius, hy = h / 2 - radius;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const px = (x + 0.5) / k - w / 2, py = (y + 0.5) / k - h / 2;
        const qx = Math.abs(px) - hx, qy = Math.abs(py) - hy;
        let dist, nx, ny; // signed distance to rounded-rect edge + outward normal
        if (qx > 0 && qy > 0) {
          const l = Math.hypot(qx, qy);
          dist = l - radius; nx = qx / l * Math.sign(px); ny = qy / l * Math.sign(py);
        } else if (qx > qy) {
          dist = qx - radius; nx = Math.sign(px); ny = 0;
        } else {
          dist = qy - radius; nx = 0; ny = Math.sign(py);
        }

        const i = (y * W + x) * 4;
        const inset = -dist;
        let vx = 0, vy = 0, a = 0;
        if (inset >= 0 && inset < bezel) {
          const t = inset / bezel;
          const fi = Math.min(N - 1, Math.max(0, t * N - 0.5));
          const i0 = Math.floor(fi), i1 = Math.min(N - 1, i0 + 1);
          const s = max ? (profile[i0] + (profile[i1] - profile[i0]) * (fi - i0)) / max : 0;
          vx = -nx * s; vy = -ny * s;
          const facing = nx * lx + ny * ly;
          const lit = facing > 0 ? facing : -facing * 0.5;
          const rim = Math.exp(-inset / 2.2) * 0.9 + Math.exp(-inset / (bezel * 0.35)) * 0.25;
          a = Math.min(1, (0.15 + 0.85 * Math.pow(lit, 1.3)) * rim);
        }
        disp.data[i] = 128 + vx * 127;
        disp.data[i + 1] = 128 + vy * 127;
        disp.data[i + 2] = 128;
        disp.data[i + 3] = 255;
        spec.data[i] = spec.data[i + 1] = spec.data[i + 2] = 255;
        spec.data[i + 3] = a * 255;
      }
    }

    canvas.width = W; canvas.height = H;
    ctx.putImageData(disp, 0, 0);
    const dispUrl = canvas.toDataURL();
    ctx.putImageData(spec, 0, 0);
    const specUrl = canvas.toDataURL();
    return { dispUrl, specUrl, max };
  }

  let count = 0;

  class LiquidGlass {
    constructor(el, opts = {}) {
      this.el = el;
      this.opts = { ...DEFAULTS, ...opts };
      this.strength = this.opts.strength;
      this.max = 0;
      this.id = 'liquid-glass-' + (++count);

      const filter = svg('filter', { id: this.id, 'color-interpolation-filters': 'sRGB' });
      this.blur = svg('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: 0, result: 'blurred' });
      this.map = svg('feImage', { x: 0, y: 0, preserveAspectRatio: 'none', result: 'map' });
      this.disp = svg('feDisplacementMap', { in: 'blurred', in2: 'map', scale: 0, xChannelSelector: 'R', yChannelSelector: 'G', result: 'refracted' });
      this.sat = svg('feColorMatrix', { in: 'refracted', type: 'saturate', values: 1 });
      filter.append(this.blur, this.map, this.disp, this.sat);
      getDefs().append(filter);

      el.liquidGlass = this;
      new ResizeObserver(() => this.schedule()).observe(el);
    }

    set(opts) {
      Object.assign(this.opts, opts);
      this.schedule();
    }

    schedule() {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.build());
    }

    build() {
      const w = this.el.offsetWidth, h = this.el.offsetHeight;
      if (!w || !h) return;
      const cssRadius = getComputedStyle(this.el).borderTopLeftRadius;
      const radiusPx = cssRadius.endsWith('%')
        ? parseFloat(cssRadius) / 100 * Math.min(w, h)
        : parseFloat(cssRadius) || 0;
      const radius = Math.min(radiusPx, w / 2, h / 2);
      const size = Math.min(w, h);
      const o = this.opts;
      const bezel = Math.max(1, Math.min(o.bezelRatio ? o.bezelRatio * size : o.bezel, size / 2));
      const thickness = o.thicknessRatio ? o.thicknessRatio * size : o.thickness;
      const { dispUrl, specUrl, max } = renderMaps(w, h, radius, bezel, { ...o, thickness });
      this.max = max;
      this.map.setAttribute('width', w);
      this.map.setAttribute('height', h);
      this.map.setAttribute('href', dispUrl);
      this.blur.setAttribute('stdDeviation', this.opts.frost);
      this.sat.setAttribute('values', this.opts.saturation);
      this.el.style.setProperty('--spec', `url("${specUrl}")`);
      this.applyScale();
      this.applyFilter();
    }

    applyScale() {
      this.disp.setAttribute('scale', (2 * this.max * this.strength).toFixed(2));
    }

    applyFilter() {
      const value = supportsRefraction
        ? `url(#${this.id})`
        : `blur(${4 + this.opts.frost * 2}px) saturate(${this.opts.saturation})`;
      this.el.style.backdropFilter = value;
      this.el.style.webkitBackdropFilter = value;
    }

    animateStrength(target, ms = 400) {
      const from = this.strength, t0 = performance.now();
      cancelAnimationFrame(this.anim);
      const step = now => {
        const p = Math.min(1, (now - t0) / ms);
        this.strength = from + (target - from) * (1 - Math.pow(1 - p, 3));
        this.applyScale();
        if (p < 1) this.anim = requestAnimationFrame(step);
      };
      this.anim = requestAnimationFrame(step);
    }
  }

  LiquidGlass.supportsRefraction = supportsRefraction;
  window.LiquidGlass = LiquidGlass;

  document.querySelectorAll('[data-glass]').forEach(el => {
    new LiquidGlass(el, JSON.parse(el.dataset.glass || '{}'));
  });
})();
