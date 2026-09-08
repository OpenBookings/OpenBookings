'use client';

import { useEffect, useRef } from 'react';

/**
 * Domain-warped fBm rendered on the GPU: two rounds of noise displacement fed
 * into a third, which gives the slow marbled banding. The pointer displaces the
 * sampling domain radially, so the field parts around the cursor like ink pushed
 * with a finger and eases back once it leaves.
 *
 * Readability is enforced in the shader (uCalmEdge damps the ink toward the page
 * background across the text column) rather than only in a CSS overlay, so the
 * contrast floor holds even if the hero layout changes.
 */

const VERT = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform vec2  uPointer;
uniform float uPointerAmt;
uniform vec3  uBg;
uniform vec3  uC1;
uniform vec3  uC2;
uniform vec3  uC3;
uniform float uCalmEdge;
uniform float uDark;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 p = uv * 1.5;

  // The pointer displaces the sampling domain, so the ink flow bends around the
  // cursor and eases back when it leaves. Dividing by (dist + k) rather than
  // normalising keeps the direction field smooth through the origin --
  // normalize() pinches it into a starburst there.
  vec2 m = (uPointer - 0.5 * uRes) / uRes.y;
  vec2 toM = p - m;
  float dist = length(toM);
  float infl = uPointerAmt * exp(-dist * 2.2);
  vec2 disp = toM / (dist + 0.38);
  p += disp * infl * 0.34;

  float t = uTime * 0.05;

  vec2 q = vec2(
    fbm(p + t * 0.30),
    fbm(p + vec2(5.2, 1.3) - t * 0.20)
  );

  vec2 r = vec2(
    fbm(p + 3.2 * q + vec2(1.7, 9.2) + t),
    fbm(p + 3.2 * q + vec2(8.3, 2.8) - t * 0.80)
  );

  float f = fbm(p + 3.0 * r);

  float band = smoothstep(0.26, 0.88, length(r));
  float depth = clamp(f * f * 3.2, 0.0, 1.0);

  vec3 col = mix(uBg, uC1, depth);
  col = mix(col, uC2, band * 0.52);

  // Thin iso-contours of the warp field: the edges that read as ink in water
  // rather than as fog. Free -- reuses f, no extra noise taps.
  float iso = abs(fract(f * 3.0) - 0.5) * 2.0;
  float fil = smoothstep(0.84, 1.0, iso) * smoothstep(0.12, 0.55, band);
  col += (uC2 - uBg) * fil * 0.38;

  // Warm ridge highlight -- deliberately rare, the only warm note in the field.
  float ridge = smoothstep(0.54, 0.80, r.x) * smoothstep(0.66, 0.40, f);
  col = mix(col, uC3, ridge * 0.65);
  col = mix(col, uC3, infl * 0.08);

  // Contrast floor across the text column.
  float x = gl_FragCoord.x / uRes.x;
  // Light mode gets a much harder floor: the muted foreground token only just
  // clears AA on the flat background there, so the text column must stay
  // effectively clean. Dark mode has luminance headroom and can carry more ink.
  float calm = smoothstep(uCalmEdge - 0.36, uCalmEdge + 0.24, x);
  col = mix(uBg, col, mix(mix(0.05, 0.26, uDark), 1.0, calm));

  // Fade into the page below the hero.
  float y = gl_FragCoord.y / uRes.y;
  col = mix(uBg, col, smoothstep(0.0, 0.28, y));

  // Grain, otherwise the smooth ramps band on 8-bit displays.
  float g = hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;
  col += g * mix(0.010, 0.020, uDark);

  gl_FragColor = vec4(col, 1.0);
}
`;

type Palette = { c1: number[]; c2: number[]; c3: number[]; bg: number[] };

const DARK: Palette = {
  bg: [0.0351, 0.0351, 0.0429],
  c1: [0.1598, 0.1582, 0.2142],
  c2: [0.2061, 0.3046, 0.5165],
  c3: [0.687, 0.5418, 0.3977],
};

// Light mode runs a much shallower field than dark: the ink sits only a little
// below the page background, so it never fights the dark text laid over it.
const LIGHT: Palette = {
  bg: [0.9794, 0.9794, 0.9854],
  c1: [0.9251, 0.9252, 0.9545],
  c2: [0.7795, 0.8508, 0.9559],
  c3: [0.9335, 0.8231, 0.717],
};

function srgbFromCss(value: string): number[] | null {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  if (parts.length > 3 && parts[3] === 0) return null; // transparent
  return [parts[0] / 255, parts[1] / 255, parts[2] / 255];
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[ink-field] shader compile failed:', gl.getShaderInfoLog(shader));
    }
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function InkField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const host = canvas.parentElement ?? canvas;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let gl: WebGLRenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let frame = 0;
    let running = false;
    let disposed = false;

    // Eased pointer state, in device pixels with y measured from the bottom.
    const pointer = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };
    let amount = 0;
    let targetAmount = 0.55;
    let hasPointer = false;
    let start = 0;

    // Palette is lerped so the theme toggle cross-fades instead of snapping.
    const current: Palette = { ...DARK, bg: [...DARK.bg], c1: [...DARK.c1], c2: [...DARK.c2], c3: [...DARK.c3] };
    let wanted: Palette = DARK;
    let dark = true;
    let paletteReady = false;

    function readTheme() {
      dark = document.documentElement.classList.contains('dark');
      const base = dark ? DARK : LIGHT;
      // Take the background from the live page so the hero fades into whatever
      // the docs theme actually paints, not a hardcoded guess.
      const css = srgbFromCss(getComputedStyle(document.body).backgroundColor);
      wanted = { ...base, bg: css ?? base.bg };
      if (!paletteReady) {
        paletteReady = true;
        current.bg = [...wanted.bg];
        current.c1 = [...wanted.c1];
        current.c2 = [...wanted.c2];
        current.c3 = [...wanted.c3];
      }
    }

    function init() {
      const ctx =
        (canvas!.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' }) as
          | WebGLRenderingContext
          | null) ??
        (canvas!.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' }) as
          | WebGLRenderingContext
          | null);
      if (!ctx) return false;
      gl = ctx;

      const vs = compile(gl, gl.VERTEX_SHADER, VERT);
      const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
      if (!vs || !fs) return false;

      program = gl.createProgram();
      if (!program) return false;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        if (process.env.NODE_ENV !== 'production') {
          console.error('[ink-field] program link failed:', gl.getProgramInfoLog(program));
        }
        return false;
      }
      gl.useProgram(program);

      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // One oversized triangle covering the clip volume.
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      canvas!.classList.add('is-ready');
      return true;
    }

    const u = (name: string) => (gl && program ? gl.getUniformLocation(program, name) : null);
    let locs: Record<string, WebGLUniformLocation | null> = {};

    function cacheLocs() {
      locs = {
        uRes: u('uRes'),
        uTime: u('uTime'),
        uPointer: u('uPointer'),
        uPointerAmt: u('uPointerAmt'),
        uBg: u('uBg'),
        uC1: u('uC1'),
        uC2: u('uC2'),
        uC3: u('uC3'),
        uCalmEdge: u('uCalmEdge'),
        uDark: u('uDark'),
      };
    }

    function resize() {
      if (!gl || !canvas) return;
      const rect = host.getBoundingClientRect();
      // Cap the pixel ratio: three fBm evaluations per fragment is the budget.
      const dpr = Math.min(window.devicePixelRatio || 1, rect.width > 1200 ? 1.5 : 2);
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      if (!hasPointer) {
        pointer.x = w * 0.62;
        pointer.y = h * 0.62;
        target.x = pointer.x;
        target.y = pointer.y;
      }
    }

    function lerpInto(a: number[], b: number[], k: number) {
      a[0] += (b[0] - a[0]) * k;
      a[1] += (b[1] - a[1]) * k;
      a[2] += (b[2] - a[2]) * k;
    }

    let forceTime: number | null = null;

    function snapPalette() {
      current.bg = [...wanted.bg];
      current.c1 = [...wanted.c1];
      current.c2 = [...wanted.c2];
      current.c3 = [...wanted.c3];
    }

    function draw(timeMs: number) {
      if (!gl || !canvas || disposed) return;
      const w = canvas.width;
      const h = canvas.height;

      if (!hasPointer && !reduceMotion) {
        // Slow Lissajous drift so the field is alive without a mouse (and on touch).
        const t = timeMs * 0.0001;
        target.x = w * (0.5 + 0.26 * Math.sin(t * 1.7));
        target.y = h * (0.5 + 0.20 * Math.sin(t * 2.3 + 1.1));
      }

      pointer.x += (target.x - pointer.x) * 0.17;
      pointer.y += (target.y - pointer.y) * 0.17;
      amount += (targetAmount - amount) * 0.045;

      lerpInto(current.bg, wanted.bg, 0.08);
      lerpInto(current.c1, wanted.c1, 0.08);
      lerpInto(current.c2, wanted.c2, 0.08);
      lerpInto(current.c3, wanted.c3, 0.08);

      // Narrow viewports stack the text over the full width, so pull the calm
      // zone across almost everything; wide ones keep it to the left column.
      const calmEdge = host.getBoundingClientRect().width < 768 ? 0.95 : 0.50;

      gl.uniform2f(locs.uRes!, w, h);
      gl.uniform1f(locs.uTime!, forceTime ?? (reduceMotion ? 6.0 : (timeMs - start) / 1000));
      gl.uniform2f(locs.uPointer!, pointer.x, pointer.y);
      gl.uniform1f(locs.uPointerAmt!, reduceMotion ? 0.35 : amount);
      gl.uniform3fv(locs.uBg!, current.bg);
      gl.uniform3fv(locs.uC1!, current.c1);
      gl.uniform3fv(locs.uC2!, current.c2);
      gl.uniform3fv(locs.uC3!, current.c3);
      gl.uniform1f(locs.uCalmEdge!, calmEdge);
      gl.uniform1f(locs.uDark!, dark ? 1 : 0);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function loop(timeMs: number) {
      if (!running) return;
      draw(timeMs);
      frame = requestAnimationFrame(loop);
    }

    function play() {
      if (running || reduceMotion || disposed) return;
      running = true;
      frame = requestAnimationFrame(loop);
    }

    function pause() {
      running = false;
      cancelAnimationFrame(frame);
    }

    // --- setup -------------------------------------------------------------
    readTheme();
    if (!init()) return;
    cacheLocs();
    resize();
    start = performance.now();

    if (reduceMotion) {
      draw(start);
    } else {
      play();
    }

    if (process.env.NODE_ENV !== 'production') {
      // Dev-only: render one deterministic frame. Lets a screenshot capture a
      // chosen moment even when rAF is throttled in a background tab.
      (window as unknown as Record<string, unknown>).__ink = {
        draw(o: { time?: number; mx?: number; my?: number; amt?: number; theme?: 'dark' | 'light' } = {}) {
          if (o.theme) {
            dark = o.theme === 'dark';
            wanted = { ...(dark ? DARK : LIGHT), bg: dark ? DARK.bg : LIGHT.bg };
            snapPalette();
          }
          if (o.mx != null) {
            hasPointer = true;
            pointer.x = target.x = o.mx * canvas.width;
            pointer.y = target.y = (1 - (o.my ?? 0.5)) * canvas.height;
          }
          if (o.amt != null) amount = targetAmount = o.amt;
          forceTime = o.time ?? 12;
          pause();
          draw(performance.now());
          return { w: canvas.width, h: canvas.height, dark };
        },
        resume() {
          forceTime = null;
          readTheme();
          snapPalette();
          play();
          return 'resumed';
        },
      };
    }

    const onPointerMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      const dpr = canvas.width / Math.max(rect.width, 1);
      hasPointer = true;
      targetAmount = 1;
      target.x = (e.clientX - rect.left) * dpr;
      target.y = (rect.height - (e.clientY - rect.top)) * dpr; // gl_FragCoord.y is bottom-up
    };
    const onPointerLeave = () => {
      hasPointer = false;
      targetAmount = 0.55;
    };

    if (!reduceMotion) {
      host.addEventListener('pointermove', onPointerMove);
      host.addEventListener('pointerleave', onPointerLeave);
    }

    const ro = new ResizeObserver(() => {
      resize();
      if (reduceMotion) draw(start);
    });
    ro.observe(host);

    // Stop burning GPU when the hero is scrolled away or the tab is hidden.
    const io = new IntersectionObserver(
      ([entry]) => (entry.isIntersecting && document.visibilityState === 'visible' ? play() : pause()),
      { threshold: 0 },
    );
    io.observe(host);

    const onVisibility = () => (document.visibilityState === 'visible' ? play() : pause());
    document.addEventListener('visibilitychange', onVisibility);

    const themeObserver = new MutationObserver(() => {
      readTheme();
      if (reduceMotion) draw(start);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    const onLost = (e: Event) => {
      e.preventDefault();
      pause();
    };
    const onRestored = () => {
      if (disposed) return;
      if (init()) {
        cacheLocs();
        resize();
        reduceMotion ? draw(start) : play();
      }
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    return () => {
      disposed = true;
      pause();
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      document.removeEventListener('visibilitychange', onVisibility);
      themeObserver.disconnect();
      ro.disconnect();
      io.disconnect();
      if (gl) {
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
