import {
  clipped,
  keyStep,
  speedStep,
  nextTheme,
  offset,
  partial,
  loadOrder,
  phaseAtTurns,
  photoIndex,
  sample,
  stripAt,
  turnsAt,
  turnsAtPhase,
  type Series,
} from './strip.ts';

const GLSL_VS = /* glsl */ `#version 300 es
  uniform vec4 rect; out vec2 uv;
  void main() {
    vec2 q = vec2(gl_VertexID & 1, gl_VertexID >> 1);
    uv = vec2(q.x, 1.0 - q.y);
    gl_Position = vec4(rect.xy + (q * 2.0 - 1.0) * rect.zw, 0.0, 1.0);
  }`;

const GLSL_FS = /* glsl */ `#version 300 es
  precision highp float;
  uniform sampler2D tex; uniform float fade, t; in vec2 uv; out vec4 o;
  float grain(vec2 p) {
    uint h = uint(p.x) * 1597334677u ^ uint(p.y) * 3812015801u ^ uint(t * 1000.0) * 2798796415u;
    h ^= h >> 16; h *= 0x7feb352du; h ^= h >> 15; h *= 0x846ca68bu; h ^= h >> 16;
    return float(h) / 4294967296.0 - 0.5;
  }
  void main() {
    vec3 c = texture(tex, uv).rgb + grain(gl_FragCoord.xy) * 0.035;
    o = vec4(c * fade, fade);
  }`;

type Rgb = [number, number, number];
// Clip space: centre x, centre y, half width, half height
type Rect = [number, number, number, number];

interface Item {
  handle: WebGLTexture;
  rect: Rect;
  fade: number;
}

interface Renderer {
  upload(bitmap: ImageBitmap): WebGLTexture;
  frame(items: Item[], t: number, background: Rgb): void;
}

interface Photo {
  name: string;
  aspect: number;
  handle: WebGLTexture | null;
}

const $ = <T extends Element = HTMLElement>(id: string): T => document.getElementById(id) as unknown as T;

const ui = {
  canvas: $<HTMLCanvasElement>('gl'),
  strip: $('strip'),
  hint: $('hint'),
  counter: $('n'),
  total: $('total'),
  theme: $<HTMLButtonElement>('theme'),
  wave: $<SVGSVGElement>('wave'),
  curve: $<SVGPathElement>('curve'),
  approx: $<SVGPathElement>('approx'),
  dot: $<SVGCircleElement>('dot'),
  epicycles: $<SVGGElement>('epi'),
};

const say = (message: string) => (ui.hint.textContent = message);
addEventListener('unhandledrejection', (e) => say(e.reason?.message ?? String(e.reason)));
addEventListener('error', (e) => say(e.message));

const pad = (n: number) => String(n).padStart(2, '0');
const title = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Seconds per photo, and of quiet after any touch
const GLIDE = 9;
const QUIET = 2.5;
// How hard the sine is clipped
const LADDER = [1, 1.25, 2, 3.5, 8];

const background = (): Rgb => {
  const hex = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
};

const toggleTheme = () => {
  const theme = nextTheme(document.documentElement.dataset.theme);
  document.documentElement.dataset.theme = theme;
  localStorage.theme = theme;
};
ui.theme.onclick = toggleTheme;
addEventListener('keydown', (e) => e.key === 't' && toggleTheme());

const meta: { name: string; aspect: number }[] = await (await fetch('photos.json')).json();
const names = meta.map((m) => m.name);
ui.total.textContent = pad(names.length);
if (!names.length) say('No photos found, add some to the folder and reload');

const renderer = webgl(ui.canvas);
if (renderer) main(renderer);
else fallback();

function fallback() {
  ui.strip.style.display = 'flex';
  ui.strip.append(...names.map((n) => Object.assign(new Image(), { src: 'photos/' + n, alt: title(n) })));
  say('No GPU rendering available, showing a plain strip');
}

function webgl(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) return null;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, GLSL_VS));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, GLSL_FS));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) say(gl.getProgramInfoLog(program) ?? 'shader link failed');
  gl.useProgram(program);
  const uRect = gl.getUniformLocation(program, 'rect');
  const uFade = gl.getUniformLocation(program, 'fade');
  const uT = gl.getUniformLocation(program, 't');
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  return {
    upload(bitmap) {
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    },
    frame(items, t, bg) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(...bg, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(uT, t);
      for (const { handle, rect, fade } of items) {
        gl.bindTexture(gl.TEXTURE_2D, handle);
        gl.uniform4fv(uRect, rect);
        gl.uniform1f(uFade, fade);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    },
  };
}

async function main(gpu: Renderer) {
  const photos: Photo[] = meta.map(({ name, aspect }) => ({ name, aspect, handle: null }));
  const count = photos.length;

  // Textures never exceed the screen
  const maxSide = Math.max(innerWidth, innerHeight) * devicePixelRatio;
  const load = async (p: Photo) => {
    let bitmap = await createImageBitmap(await (await fetch('photos/' + p.name)).blob());
    const k = maxSide / Math.max(bitmap.width, bitmap.height);
    if (k < 1) {
      const resize = {
        resizeWidth: bitmap.width * k,
        resizeHeight: bitmap.height * k,
        resizeQuality: 'high' as const,
      };
      bitmap = await createImageBitmap(bitmap, resize).catch(() => bitmap);
    }
    pending.push([p, bitmap]);
  };

  const pending: [Photo, ImageBitmap][] = [];
  const attach = ([p, bitmap]: [Photo, ImageBitmap]) => {
    p.handle = gpu.upload(bitmap);
    const ratio = bitmap.width / bitmap.height;
    // Fix wrong aspect metadata, but never mid-drag
    if (Math.abs(ratio - p.aspect) > 0.01 && !drag) {
      p.aspect = ratio;
      layout();
    }
  };

  const queue = loadOrder(count, photoIndex(count, +localStorage.turns || 0));
  let failed = 0;
  const worker = async () => {
    for (let i = queue.shift(); i !== undefined; i = queue.shift()) await load(photos[i]).catch(() => failed++);
  };

  const state = {
    x: 0,
    target: 0,
    // Photo units around the loop
    turns: ((+localStorage.turns % count) + count) % count || 0,
    // Photos across the trace, sets drift speed
    periods: count,
    rung: 2,
    phi: 0,
    zoom: 0,
    zoomTarget: 0,
    zoomed: 0,
    intro: 0,
    pointer: { nx: 0, ny: 0, px: 0, py: 0 },
    clock: performance.now(),
    restUntil: performance.now() + QUIET * 1000,
  };
  const touch = () => (state.restUntil = performance.now() + QUIET * 1000);

  let W = 0;
  let H = 0;
  let length = 0;
  let centres: number[] = [];
  let active = 0;

  // Fits height and width, so phones never crop
  const fit = (p: Photo) => Math.min(H * 0.72, (W * 0.9) / p.aspect);
  const at = (turns: number) => stripAt(centres, length, turns);
  const turnsOf = (x: number) => turnsAt(centres, length, x);
  const rel = (i: number) => offset(centres, length, state.x, i);

  function layout() {
    W = ui.canvas.width = Math.round(innerWidth * devicePixelRatio);
    H = ui.canvas.height = Math.round(innerHeight * devicePixelRatio);
    let x = 0;
    centres = photos.map((p) => {
      const w = fit(p) * p.aspect;
      const centre = x + w / 2;
      x += w + H * 0.08;
      return centre;
    });
    length = x;
    state.x = state.target = at(state.turns);
  }

  const caption = () => (ui.counter.textContent = pad(active + 1));

  let series: Series = clipped(LADDER[state.rung]);

  // Oscilloscope: the dot travels the trace once per loop
  const AMP = 12;
  const span = () => innerWidth - 40 - AMP;

  function drawCurve() {
    const steps = Math.ceil(span() / 2);
    const perPhoto = span() / state.periods;
    ui.wave.setAttribute('viewBox', `0 0 ${innerWidth} 64`);
    const trace = (value: (phi: number) => number) =>
      Array.from({ length: steps + 1 }, (_, i) => {
        const x = (i / steps) * span();
        const y = 32 - AMP * value((Math.PI * x) / perPhoto);
        return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(2)}`;
      }).join('');
    ui.curve.setAttribute(
      'd',
      trace((phi) => sample(series, phi)),
    );
    ui.approx.setAttribute(
      'd',
      trace((phi) => partial(series, phi)),
    );
  }

  // Phase as drawn, so the dot stays on the trace
  function drawDot(unwrapped: number) {
    const beats = unwrapped / Math.PI;
    const sweep = (((beats % state.periods) + state.periods) % state.periods) / state.periods;
    const phi = sweep * state.periods * Math.PI;
    const cx = sweep * span();
    ui.dot.setAttribute('cx', String(cx));
    ui.dot.setAttribute('cy', String(32 - AMP * sample(series, phi)));

    let x = innerWidth - 40;
    let y = 32;
    const circles = series.terms.map(({ k, a }) => {
      const r = AMP * a;
      const circle = `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${Math.abs(r).toFixed(2)}"/>`;
      x += r * Math.cos(k * (phi + Math.PI / 2));
      y -= r * Math.sin(k * (phi + Math.PI / 2));
      return circle;
    });
    const tip = `<circle class="tip" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2"/>`;
    const link = `<line x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${cx.toFixed(2)}" y2="${y.toFixed(2)}"/>`;
    ui.epicycles.innerHTML = circles.join('') + tip + link;
  }

  // Roomier targets for fingers
  const slack = matchMedia('(pointer: coarse)').matches ? 14 : 0;
  const nearDot = (e: MouseEvent) =>
    Math.hypot(e.clientX - ui.dot.cx.baseVal.value, e.clientY - (innerHeight - 64) - ui.dot.cy.baseVal.value) <
    12 + slack;
  const onCircle = (e: MouseEvent) =>
    Math.hypot(e.clientX - (innerWidth - 40), e.clientY - (innerHeight - 64) - 32) < AMP + 3 + slack;

  const setPeriods = (periods: number) => {
    state.periods = Math.round(Math.min(64, Math.max(2, periods)));
    drawCurve();
  };
  const go = (turns: number) => {
    state.target = at(Math.round(turns));
    touch();
  };
  const unzoom = () => (state.zoomTarget = 0);

  interface Drag {
    startX: number;
    lastX: number;
    lastTime: number;
    origin: number;
    velocity: number;
    moved: boolean;
  }
  let drag: Drag | null = null;
  let settle: ReturnType<typeof setTimeout>;

  // Wheel notch: one photo. Trackpad: free scroll, snap to nearest
  let scrolling = false;
  addEventListener(
    'wheel',
    (e) => {
      const delta = e.deltaX + e.deltaY;
      unzoom();
      touch();
      if (!scrolling && Math.abs(delta) >= 50) {
        state.target = at(Math.round(turnsOf(state.target)) + Math.sign(delta));
        return;
      }
      scrolling = true;
      state.target += delta * devicePixelRatio;
      clearTimeout(settle);
      settle = setTimeout(() => {
        state.target = at(Math.round(turnsOf(state.target)));
        scrolling = false;
      }, 150);
    },
    { passive: true },
  );
  ui.canvas.addEventListener('pointerdown', (e) => {
    drag = {
      startX: e.clientX,
      lastX: e.clientX,
      lastTime: e.timeStamp,
      origin: state.target,
      velocity: 0,
      moved: false,
    };
    ui.canvas.setPointerCapture(e.pointerId);
    touch();
  });
  addEventListener('pointermove', (e) => {
    state.pointer.nx = (e.clientX / innerWidth) * 2 - 1;
    state.pointer.ny = (e.clientY / innerHeight) * 2 - 1;
    if (!drag) return;
    drag.moved ||= Math.abs(e.clientX - drag.startX) > 4;
    drag.velocity = (e.clientX - drag.lastX) / Math.max(1, e.timeStamp - drag.lastTime);
    drag.lastX = e.clientX;
    drag.lastTime = e.timeStamp;
    if (drag.moved) {
      state.target = drag.origin - (e.clientX - drag.startX) * devicePixelRatio;
      unzoom();
    }
    touch();
  });
  addEventListener('pointerup', (e) => {
    if (!drag) return;
    if (drag.moved) state.target = at(Math.round(turnsOf(state.target - drag.velocity * 150 * devicePixelRatio)));
    else if (e.button === 0) {
      // Tap the centred photo to fill the screen, a neighbour to scroll to it
      const turns = turnsOf(state.x + e.clientX * devicePixelRatio - W / 2);
      const i = photoIndex(count, turns);
      const h = fit(photos[i]);
      const dx = e.clientX * devicePixelRatio - (W / 2 + rel(i) - state.pointer.px * H * 0.01);
      const dy = e.clientY * devicePixelRatio - H / 2;
      const onPhoto = photos[i].handle && Math.abs(dx) < (h * photos[i].aspect) / 2 && Math.abs(dy) < h / 2;
      if (state.zoomTarget) unzoom();
      else if (onPhoto && i === active) {
        state.zoomed = i;
        state.zoomTarget = 1;
      } else go(turns);
    }
    drag = null;
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') unzoom();
    const step = keyStep(e.key);
    if (step) {
      go(Math.round(state.turns) + step);
      unzoom();
    }
    const speed = speedStep(e.key);
    if (speed) setPeriods(state.periods + speed);
  });
  addEventListener('resize', () => {
    layout();
    drawCurve();
  });
  addEventListener('pagehide', () => (localStorage.turns = state.turns));

  // Dot scrubs, elsewhere stretches, circles add harmonics
  const traceY = (x: number) => 32 - AMP * sample(series, (Math.PI * x) / (span() / state.periods));
  const onTrace = (e: MouseEvent) =>
    e.clientX < span() && Math.abs(e.clientY - (innerHeight - 64) - traceY(e.clientX)) < 9 + slack;
  const bandCursor = (e: MouseEvent) =>
    nearDot(e) ? 'grab' : onCircle(e) ? 'var(--cursor-fourier)' : onTrace(e) ? 'ew-resize' : '';

  type Tune = { startX: number; periods: number; turns: number; mode: 'scrub' | 'stretch' | 'click' };
  let tune: Tune | null = null;

  ui.wave.addEventListener('pointerdown', (e) => {
    const mode = nearDot(e) ? 'scrub' : onTrace(e) ? 'stretch' : onCircle(e) ? 'click' : null;
    if (!mode) return;
    tune = { startX: e.clientX, periods: state.periods, turns: state.turns, mode };
    ui.wave.setPointerCapture(e.pointerId);
  });
  ui.wave.addEventListener('pointermove', (e) => {
    if (!tune) {
      ui.wave.style.cursor = bandCursor(e);
      return;
    }
    const dx = e.clientX - tune.startX;
    if (tune.mode === 'scrub') {
      state.target = at(tune.turns + (dx / span()) * state.periods);
      touch();
    } else if (tune.mode === 'stretch') setPeriods(tune.periods * Math.exp(dx / 120));
  });
  ui.wave.addEventListener('pointerup', (e) => {
    if (tune?.mode === 'click' && Math.abs(e.clientX - tune.startX) < 4) {
      state.rung = Math.min(LADDER.length - 1, Math.max(0, state.rung + (e.button === 2 ? -1 : 1)));
      series = clipped(LADDER[state.rung]);
      drawCurve();
    }
    tune = null;
  });
  ui.wave.addEventListener('contextmenu', (e) => onCircle(e) && e.preventDefault());

  const ease = (from: number, to: number, k: number) => (reduceMotion ? to : from + (to - from) * k);

  function frame(now: number) {
    const dt = Math.min(0.05, (now - state.clock) / 1000);
    state.clock = now;
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    const { pointer } = state;
    state.x = ease(state.x, state.target, k(9));
    pointer.px = ease(pointer.px, pointer.nx, k(4));
    state.zoom = ease(state.zoom, state.zoomTarget, k(6));
    document.body.classList.toggle('zoomed', state.zoomTarget === 1);
    pointer.py = ease(pointer.py, pointer.ny, k(4));
    state.intro = ease(state.intro, 1, k(2.2));

    const turns = (state.turns = turnsOf(state.x));

    // One upload a frame, entry photo first, nothing else during the intro
    const entry = pending.findIndex(([p]) => p === photos[active]);
    if (entry >= 0) attach(pending.splice(entry, 1)[0]);
    else if (pending.length && state.intro > 0.9) attach(pending.shift()!);

    if (!drag && state.zoom < 0.01 && now > state.restUntil) {
      state.phi += ((dt * Math.PI) / GLIDE) * (state.periods / count);
      state.target = at(turnsAtPhase(series, state.phi));
    } else state.phi = phaseAtTurns(turns);
    drawDot(state.phi);
    const nearest = photoIndex(count, turns);
    if (nearest !== active) {
      active = nearest;
      caption();
    }

    const items: Item[] = [];
    photos.forEach((p, i) => {
      if (!p.handle) return;
      const distance = Math.min(1, Math.abs(rel(i)) / W);
      const fill = Math.min(H * 0.94, (W * 0.94) / p.aspect);
      const grow = i === state.zoomed ? state.zoom : 0;
      const h = fit(p) * (1 - 0.08 * distance) * (1 - grow) + fill * grow;
      const w = h * p.aspect;
      const parallax = pointer.px * H * 0.01 * (i === active ? 1 : 0.5) * (1 - state.zoom);
      const cx = W / 2 + rel(i) + (1 - state.intro) * W * 0.12 - parallax;
      const cy = H / 2 - pointer.py * H * 0.006;
      if (cx + w / 2 < 0 || cx - w / 2 > W) return;
      items.push({
        handle: p.handle,
        rect: [(cx / W) * 2 - 1, 1 - (cy / H) * 2, w / W, h / H],
        fade: (1 - 0.6 * distance) * state.intro * (i === state.zoomed ? 1 : 1 - state.zoom),
      });
    });
    gpu.frame(items, reduceMotion ? 0 : now / 1000, background());
    requestAnimationFrame(frame);
  }

  layout();
  caption();
  drawCurve();
  requestAnimationFrame(frame);
  // Loaders start last, once state exists
  void Promise.all([worker(), worker(), worker()]).then(() => failed && say(`${failed} photos failed to load`));
}
