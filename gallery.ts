import {
  fourier,
  keyStep,
  speedStep,
  nextTheme,
  offset,
  phaseAtTurns,
  photoIndex,
  sample,
  stripAt,
  turnsAt,
  turnsAtPhase,
  type Series,
} from './strip.ts';

const WGSL = /* wgsl */ `
  struct U { rect: vec4f, fade: f32, t: f32 }
  @group(0) @binding(0) var<uniform> u: U;
  @group(0) @binding(1) var samp: sampler;
  @group(0) @binding(2) var tex: texture_2d<f32>;
  struct V { @builtin(position) p: vec4f, @location(0) uv: vec2f }

  @vertex fn vs(@builtin(vertex_index) i: u32) -> V {
    let q = vec2f(f32(i & 1u), f32(i >> 1u));
    return V(vec4f(u.rect.xy + (q * 2.0 - 1.0) * u.rect.zw, 0.0, 1.0), vec2f(q.x, 1.0 - q.y));
  }
  fn grain(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7)) + u.t) * 43758.5453) - 0.5; }
  @fragment fn fs(v: V) -> @location(0) vec4f {
    let c = textureSample(tex, samp, v.uv).rgb + grain(v.p.xy) * 0.035;
    return vec4f(c * u.fade, u.fade);
  }`;

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
  float grain(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + t) * 43758.5453) - 0.5; }
  void main() {
    vec3 c = texture(tex, uv).rgb + grain(gl_FragCoord.xy) * 0.035;
    o = vec4(c * fade, fade);
  }`;

type Rgb = [number, number, number];
// Clip space: centre x, centre y, half width, half height
type Rect = [number, number, number, number];

interface Item<Handle> {
  handle: Handle;
  rect: Rect;
  fade: number;
}

interface Renderer<Handle> {
  upload(bitmap: ImageBitmap): Handle;
  frame(items: Item<Handle>[], t: number, background: Rgb): void;
}

interface Photo<Handle> {
  name: string;
  aspect: number;
  handle: Handle;
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
  dot: $<SVGCircleElement>('dot'),
  epicycles: $<SVGGElement>('epi'),
};

const say = (message: string) => (ui.hint.textContent = message);
addEventListener('unhandledrejection', (e) => say(e.reason?.message ?? String(e.reason)));
addEventListener('error', (e) => say(e.message));

const pad = (n: number) => String(n).padStart(2, '0');
const title = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

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

const names: string[] = await (await fetch('photos.json')).json();
ui.total.textContent = pad(names.length);
if (!names.length) say('No photos found, add some to the folder and reload');

const renderer = (await webgpu(ui.canvas)) ?? webgl(ui.canvas);
if (renderer) main(renderer);
else fallback();

function fallback() {
  ui.strip.style.display = 'flex';
  ui.strip.append(...names.map((n) => Object.assign(new Image(), { src: 'photos/' + n, alt: title(n) })));
  say('No GPU rendering available, showing a plain strip');
}

interface GpuHandle {
  uniforms: GPUBuffer;
  bind: GPUBindGroup;
}

async function webgpu(canvas: HTMLCanvasElement): Promise<Renderer<GpuHandle> | null> {
  const adapter = await navigator.gpu?.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', (e) => say(e.error.message));
  const ctx = canvas.getContext('webgpu');
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const module = device.createShaderModule({ code: WGSL });
  const blend: GPUBlendComponent = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' };
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: blend, alpha: blend } }] },
    primitive: { topology: 'triangle-strip' },
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const uniform = new Float32Array(8);

  return {
    upload(bitmap) {
      const texture = device.createTexture({
        size: [bitmap.width, bitmap.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      device.queue.copyExternalImageToTexture({ source: bitmap }, { texture }, [bitmap.width, bitmap.height]);
      const uniforms = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      const bind = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniforms } },
          { binding: 1, resource: sampler },
          { binding: 2, resource: texture.createView() },
        ],
      });
      return { uniforms, bind };
    },
    frame(items, t, bg) {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: ctx.getCurrentTexture().createView(), loadOp: 'clear', clearValue: [...bg, 1], storeOp: 'store' },
        ],
      });
      pass.setPipeline(pipeline);
      for (const { handle, rect, fade } of items) {
        uniform.set([...rect, fade, t]);
        device.queue.writeBuffer(handle.uniforms, 0, uniform);
        pass.setBindGroup(0, handle.bind);
        pass.draw(4);
      }
      pass.end();
      device.queue.submit([encoder.finish()]);
    },
  };
}

function webgl(canvas: HTMLCanvasElement): Renderer<WebGLTexture> | null {
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

async function main<Handle>(gpu: Renderer<Handle>) {
  // Textures never exceed the screen
  const maxSide = Math.max(innerWidth, innerHeight) * devicePixelRatio;
  const photos: Photo<Handle>[] = await Promise.all(
    names.map(async (name) => {
      let bitmap = await createImageBitmap(await (await fetch('photos/' + name)).blob());
      const k = maxSide / Math.max(bitmap.width, bitmap.height);
      if (k < 1) {
        const resize = {
          resizeWidth: bitmap.width * k,
          resizeHeight: bitmap.height * k,
          resizeQuality: 'high' as const,
        };
        bitmap = await createImageBitmap(bitmap, resize).catch(() => bitmap);
      }
      return { name, aspect: bitmap.width / bitmap.height, handle: gpu.upload(bitmap) };
    }),
  );
  const count = photos.length;

  const state = {
    x: 0,
    target: 0,
    // Photo units around the loop
    turns: ((+localStorage.turns % count) + count) % count || 0,
    // Photos across the trace, sets drift speed
    periods: count,
    harmonics: 1,
    phi: 0,
    intro: 0,
    pointer: { x: NaN, y: NaN, nx: 0, ny: 0, px: 0, py: 0 },
    clock: performance.now(),
    restUntil: performance.now() + 2500,
  };
  const touch = () => (state.restUntil = performance.now() + 2500);

  let W = 0;
  let H = 0;
  let length = 0;
  let centres: number[] = [];
  let active = 0;

  // Fits height and width, so phones never crop
  const fit = (p: Photo<Handle>) => Math.min(H * 0.72, (W * 0.9) / p.aspect);
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

  let series: Series = fourier(state.harmonics);

  // Oscilloscope: the dot travels the trace once per loop
  const AMP = 12;
  const span = () => innerWidth - 40 - AMP;

  function drawCurve() {
    const steps = Math.ceil(span() / 2);
    const perPhoto = span() / state.periods;
    ui.wave.setAttribute('viewBox', `0 0 ${innerWidth} 64`);
    const points = Array.from({ length: steps + 1 }, (_, i) => {
      const x = (i / steps) * span();
      const y = 32 - AMP * sample(series, (Math.PI * x) / perPhoto);
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(2)}`;
    });
    ui.curve.setAttribute('d', points.join(''));
  }

  function drawDot(phi: number) {
    const beats = phi / Math.PI;
    const cx = ((((beats % state.periods) + state.periods) % state.periods) / state.periods) * span();
    ui.dot.setAttribute('cx', String(cx));
    ui.dot.setAttribute('cy', String(32 - AMP * sample(series, phi)));

    let x = innerWidth - 40;
    let y = 32;
    const circles = series.ks.map((k) => {
      const r = AMP / k;
      const circle = `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}"/>`;
      x += r * Math.cos(k * (phi + Math.PI / 2));
      y -= r * Math.sin(k * (phi + Math.PI / 2));
      return circle;
    });
    const tip = `<circle class="tip" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2"/>`;
    const link = `<line x1="${x.toFixed(2)}" y1="${y.toFixed(2)}" x2="${cx.toFixed(2)}" y2="${y.toFixed(2)}"/>`;
    ui.epicycles.innerHTML = circles.join('') + tip + link;
  }

  // Fingers get roomier targets than a mouse
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

  interface Drag {
    startX: number;
    lastX: number;
    lastTime: number;
    origin: number;
    velocity: number;
    moved: boolean;
  }
  let drag: Drag | null = null;

  addEventListener(
    'wheel',
    (e) => {
      state.target += (e.deltaX + e.deltaY) * devicePixelRatio;
      touch();
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
    state.pointer.x = e.clientX;
    state.pointer.y = e.clientY;
    state.pointer.nx = (e.clientX / innerWidth) * 2 - 1;
    state.pointer.ny = (e.clientY / innerHeight) * 2 - 1;
    if (!drag) return;
    drag.moved ||= Math.abs(e.clientX - drag.startX) > 4;
    drag.velocity = (e.clientX - drag.lastX) / Math.max(1, e.timeStamp - drag.lastTime);
    drag.lastX = e.clientX;
    drag.lastTime = e.timeStamp;
    if (drag.moved) state.target = drag.origin - (e.clientX - drag.startX) * devicePixelRatio;
    touch();
  });
  addEventListener('pointerup', (e) => {
    if (!drag) return;
    if (drag.moved) state.target -= drag.velocity * 150 * devicePixelRatio;
    else {
      const turns = turnsOf(state.x + e.clientX * devicePixelRatio - W / 2);
      if (Math.round(turns) !== Math.round(state.turns)) go(turns);
    }
    drag = null;
  });
  addEventListener('pointerout', (e) => e.relatedTarget === null && (state.pointer.x = NaN));
  addEventListener('keydown', (e) => {
    const step = keyStep(e.key);
    if (step) go(Math.round(state.turns) + step);
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
    nearDot(e)
      ? 'var(--cursor-ring)'
      : onCircle(e)
        ? 'var(--cursor-fourier)'
        : onTrace(e)
          ? 'var(--cursor-stretch)'
          : '';

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
      state.harmonics = Math.min(127, Math.max(1, state.harmonics + (e.button === 2 ? -2 : 2)));
      series = fourier(state.harmonics);
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
    pointer.py = ease(pointer.py, pointer.ny, k(4));
    state.intro = ease(state.intro, 1, k(2.2));

    const turns = (state.turns = turnsOf(state.x));

    // Drift pauses while hovering the centred photo
    const column = (fit(photos[active]) * photos[active].aspect) / 2;
    const aboveBand = pointer.y < innerHeight - 64;
    const hovering = aboveBand && Math.abs(pointer.x * devicePixelRatio - (W / 2 + rel(active))) < column;
    const boost = aboveBand ? 1 + 3 * Math.max(0, pointer.px) : 1;
    if (!drag && !hovering && now > state.restUntil) {
      state.phi += dt * Math.PI * (1 / 9) * (state.periods / count) * boost;
      state.target = at(turnsAtPhase(series, state.phi));
    } else state.phi = phaseAtTurns(turns);
    drawDot(state.phi);
    const nearest = photoIndex(count, turns);
    if (nearest !== active) {
      active = nearest;
      caption();
    }

    const items: Item<Handle>[] = [];
    photos.forEach((p, i) => {
      const distance = Math.min(1, Math.abs(rel(i)) / W);
      const h = fit(p) * (1 - 0.08 * distance);
      const w = h * p.aspect;
      const parallax = pointer.px * H * 0.01 * (i === active ? 1 : 0.5);
      const cx = W / 2 + rel(i) + (1 - state.intro) * W * 0.12 - parallax;
      const cy = H / 2 - pointer.py * H * 0.006;
      if (cx + w / 2 < 0 || cx - w / 2 > W) return;
      items.push({
        handle: p.handle,
        rect: [(cx / W) * 2 - 1, 1 - (cy / H) * 2, w / W, h / H],
        fade: (1 - 0.6 * distance) * state.intro,
      });
    });
    gpu.frame(items, reduceMotion ? 0 : now / 1000, background());
    requestAnimationFrame(frame);
  }

  layout();
  caption();
  drawCurve();
  requestAnimationFrame(frame);
}
