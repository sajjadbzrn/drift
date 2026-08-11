import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * A cinematic "cosmic drift" background rendered behind the whole app.
 *
 * Layered, theme-aware elements give the backdrop depth and life:
 *   1. Nebula      — organic, flowing FBM clouds (animated fullscreen shader).
 *   2. Dust        — soft glowing star sprites with a real bloom-like falloff.
 *   3. Constellation — a web of connected nodes with energy pulses streaming
 *      along the links (evokes data flowing through a download).
 *
 * A slow cinematic tumble + mouse parallax make it feel alive. It pauses when
 * the window is hidden, falls back to nothing when WebGL is unavailable, and
 * honors prefers-reduced-motion with a single static frame.
 */

/* ---------- soft round glow sprite (generated once) ---------- */
function makeGlowTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0.0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, "rgba(255,255,255,0.85)");
  g.addColorStop(0.5, "rgba(255,255,255,0.22)");
  g.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

/* ---------- dust (glowing star sprites) ---------- */
const DUST_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  uniform float uPixelRatio;
  uniform float uScale;
  uniform float uTime;
  varying float vSeed;
  void main() {
    vSeed = aSeed;
    vec3 pos = position;
    pos.x += sin(uTime * 0.22 + aSeed * 12.9) * 0.6;
    pos.y += cos(uTime * 0.19 + aSeed * 9.7) * 0.6;
    pos.z += sin(uTime * 0.16 + aSeed * 7.3) * 0.55;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * uPixelRatio * (uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const DUST_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uOpacity;
  uniform float uTime;
  varying float vSeed;
  void main() {
    vec4 tex = texture2D(uTex, gl_PointCoord);
    if (tex.a < 0.02) discard;
    float tw = 0.55 + 0.45 * sin(uTime * (0.45 + fract(vSeed * 11.7) * 1.3) + vSeed * 43.0);
    float m = fract(vSeed * 3.7);
    vec3 color = m < 0.5
      ? mix(uColorA, uColorB, m * 2.0)
      : mix(uColorB, uColorC, (m - 0.5) * 2.0);
    gl_FragColor = vec4(color, tex.a * uOpacity * tw);
  }
`;

/* ---------- constellation links ---------- */
const LINE_VERT = /* glsl */ `
  attribute float aPhase;
  varying float vPhase;
  void main() {
    vPhase = aPhase;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LINE_FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  uniform float uTime;
  varying float vPhase;
  void main() {
    float tw = 0.30 + 0.70 * (0.5 + 0.5 * sin(uTime * 0.55 + vPhase * 6.2831));
    vec3 color = mix(uColorA, uColorB, fract(vPhase * 1.7));
    gl_FragColor = vec4(color, uOpacity * tw);
  }
`;

/* ---------- energy pulses travelling along the links ---------- */
const PULSE_VERT = /* glsl */ `
  attribute vec3 aStart;
  attribute vec3 aEnd;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aSize;
  uniform float uPixelRatio;
  uniform float uScale;
  uniform float uTime;
  varying float vT;
  void main() {
    float t = fract(uTime * aSpeed + aPhase);
    vT = t;
    vec3 pos = mix(aStart, aEnd, t);
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * uPixelRatio * (uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const PULSE_FRAG = /* glsl */ `
  uniform sampler2D uTex;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  varying float vT;
  void main() {
    vec4 tex = texture2D(uTex, gl_PointCoord);
    if (tex.a < 0.02) discard;
    float ends = smoothstep(0.0, 0.14, vT) * smoothstep(1.0, 0.86, vT);
    vec3 col = mix(uColorB, uColorA, vT);
    gl_FragColor = vec4(col, tex.a * uOpacity * ends);
  }
`;

/* ---------- nebula (organic flowing FBM clouds) ---------- */
const NEB_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NEB_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAspect;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec3 uColor4;
  uniform float uOpacity;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.56);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p = p * 2.02 + vec2(11.3, 7.7);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    vec2 p = (uv - 0.5) * vec2(uAspect, 1.0) * 3.0;
    float t = uTime * 0.04;

    float w = fbm(p * 1.1 + vec2(t, -t * 0.6));
    float w2 = fbm(p * 1.1 + vec2(-t * 0.7, t) + w * 1.6);
    float clouds = fbm(p * 1.5 + w * 2.0 + w2);
    clouds = pow(clamp(clouds, 0.0, 1.0), 1.5);

    vec3 col = mix(uColor1, uColor2, smoothstep(0.15, 0.65, clouds));
    col = mix(col, uColor3, smoothstep(0.5, 0.9, clouds));
    float core = smoothstep(0.72, 1.0, clouds);
    col += core * uColor4 * 0.7;

    float vig = smoothstep(1.15, 0.25, length(uv - 0.5));
    float alpha = clouds * uOpacity * vig;
    gl_FragColor = vec4(col, alpha);
  }
`;

/** Deterministic PRNG so the field looks identical across theme switches. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ParticleField({ theme }: { theme: "dark" | "light" }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
    camera.position.z = 26;

    const dark = theme === "dark";

    const uTime = { value: 0 };
    const uPixelRatio = { value: Math.min(window.devicePixelRatio || 1, 2) };
    const uScale = { value: 150 };
    const uAspect = { value: 1 };
    const blend = dark ? THREE.AdditiveBlending : THREE.NormalBlending;

    const glowTex = makeGlowTexture();

    // ---- dust ------------------------------------------------------------
    const uColorA = dark ? new THREE.Color("#6366f1") : new THREE.Color("#5a5df0");
    const uColorB = dark ? new THREE.Color("#22d3ee") : new THREE.Color("#0e7490");
    const uColorC = dark ? new THREE.Color("#a855f7") : new THREE.Color("#7c3aed");
    const dustOpacity = dark ? 0.55 : 0.3;
    const count = reduced ? 0 : 1400;
    const rnd = mulberry32(20260810);
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = Math.pow(rnd(), 0.6) * 32;
      const a = rnd() * Math.PI * 2;
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = Math.sin(a) * r * 0.62;
      positions[i * 3 + 2] = (rnd() - 0.5) * 14;
      const orb = rnd() < 0.16;
      sizes[i] = orb ? 2.2 + rnd() * 3.4 : 0.6 + rnd() * 1.4;
      seeds[i] = rnd();
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    dustGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    dustGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    const dustMat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: {
        uTex: { value: glowTex },
        uPixelRatio,
        uScale,
        uTime,
        uColorA: { value: uColorA },
        uColorB: { value: uColorB },
        uColorC: { value: uColorC },
        uOpacity: { value: dustOpacity },
      },
      transparent: true,
      depthWrite: false,
      blending: blend,
    });

    // ---- constellation + flowing energy pulses --------------------------
    const CN = 90;
    const nodes: THREE.Vector3[] = [];
    const crnd = mulberry32(73219);
    for (let i = 0; i < CN; i++) {
      const r = Math.pow(crnd(), 0.7) * 30;
      const a = crnd() * Math.PI * 2;
      nodes.push(
        new THREE.Vector3(
          Math.cos(a) * r,
          Math.sin(a) * r * 0.6,
          (crnd() - 0.5) * 12,
        ),
      );
    }
    const segments: [number, number][] = [];
    const seen = new Set<string>();
    const lrnd = mulberry32(555);
    for (let i = 0; i < CN; i++) {
      const dists: { j: number; d: number }[] = [];
      for (let j = 0; j < CN; j++) {
        if (i === j) continue;
        dists.push({ j, d: nodes[i].distanceToSquared(nodes[j]) });
      }
      dists.sort((a, b) => a.d - b.d);
      for (let k = 0; k < 2; k++) {
        const j = dists[k].j;
        const key = i < j ? `${i}_${j}` : `${j}_${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        segments.push([i, j]);
      }
    }

    const linePos: number[] = [];
    const linePhase: number[] = [];
    for (const [i, j] of segments) {
      linePos.push(nodes[i].x, nodes[i].y, nodes[i].z);
      linePos.push(nodes[j].x, nodes[j].y, nodes[j].z);
      linePhase.push(lrnd(), lrnd());
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(linePos), 3),
    );
    lineGeo.setAttribute(
      "aPhase",
      new THREE.BufferAttribute(new Float32Array(linePhase), 1),
    );
    const lineMat = new THREE.ShaderMaterial({
      vertexShader: LINE_VERT,
      fragmentShader: LINE_FRAG,
      uniforms: {
        uTime,
        uColorA: { value: uColorA },
        uColorB: { value: uColorB },
        uOpacity: { value: dark ? 0.18 : 0.12 },
      },
      transparent: true,
      depthWrite: false,
      blending: blend,
    });

    const pStart: number[] = [];
    const pEnd: number[] = [];
    const pPhase: number[] = [];
    const pSpeed: number[] = [];
    const pSize: number[] = [];
    const prnd = mulberry32(991);
    for (const [i, j] of segments) {
      for (let p = 0; p < 2; p++) {
        pStart.push(nodes[i].x, nodes[i].y, nodes[i].z);
        pEnd.push(nodes[j].x, nodes[j].y, nodes[j].z);
        pPhase.push(prnd() + p * 0.5);
        pSpeed.push(0.12 + prnd() * 0.22);
        pSize.push(4.0 + prnd() * 4.0);
      }
    }
    const pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute(
      "aStart",
      new THREE.BufferAttribute(new Float32Array(pStart), 3),
    );
    pulseGeo.setAttribute(
      "aEnd",
      new THREE.BufferAttribute(new Float32Array(pEnd), 3),
    );
    pulseGeo.setAttribute(
      "aPhase",
      new THREE.BufferAttribute(new Float32Array(pPhase), 1),
    );
    pulseGeo.setAttribute(
      "aSpeed",
      new THREE.BufferAttribute(new Float32Array(pSpeed), 1),
    );
    pulseGeo.setAttribute(
      "aSize",
      new THREE.BufferAttribute(new Float32Array(pSize), 1),
    );
    const pulseMat = new THREE.ShaderMaterial({
      vertexShader: PULSE_VERT,
      fragmentShader: PULSE_FRAG,
      uniforms: {
        uTex: { value: glowTex },
        uPixelRatio,
        uScale,
        uTime,
        uColorA: { value: uColorA },
        uColorB: { value: uColorB },
        uOpacity: { value: dark ? 1.0 : 0.85 },
      },
      transparent: true,
      depthWrite: false,
      blending: blend,
    });

    // ---- nebula ----------------------------------------------------------
    const nebGeo = new THREE.PlaneGeometry(2, 2);
    const nebMat = new THREE.ShaderMaterial({
      vertexShader: NEB_VERT,
      fragmentShader: NEB_FRAG,
      uniforms: {
        uTime,
        uAspect,
        uColor1: { value: uColorA },
        uColor2: { value: uColorB },
        uColor3: { value: uColorC },
        uColor4: { value: dark ? new THREE.Color("#e879f9") : new THREE.Color("#c084fc") },
        uOpacity: { value: dark ? 0.5 : 0.32 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: blend,
    });

    const group = new THREE.Group();
    group.rotation.set(0.32, 0, 0.12);
    group.add(new THREE.Points(dustGeo, dustMat));
    group.add(new THREE.LineSegments(lineGeo, lineMat));
    group.add(new THREE.Points(pulseGeo, pulseMat));
    scene.add(group);

    const nebCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const neb = new THREE.Mesh(nebGeo, nebMat);
    neb.position.z = -1;
    const nebScene = new THREE.Scene();
    nebScene.add(neb);

    const renderFrame = () => {
      renderer.autoClear = false;
      renderer.clear();
      renderer.render(nebScene, nebCam);
      renderer.render(scene, camera);
    };

    // ---- resize ----------------------------------------------------------
    // ResizeObserver fires synchronously during a window drag, while rAF is
    // throttled by the OS — so we re-apply the size AND repaint immediately
    // here. Otherwise setSize() clears the GL buffer but nothing redraws until
    // the drag stops, which shows as black flashes / jumps.
    let lastW = 0;
    let lastH = 0;
    const doResize = () => {
      const w = Math.max(1, Math.round(host.clientWidth || window.innerWidth));
      const h = Math.max(1, Math.round(host.clientHeight || window.innerHeight));
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      uAspect.value = w / h;
      renderer.setPixelRatio(dpr);
      // updateStyle=false: let the CSS (width/height:100%) drive display size
      // and only resize the drawing buffer, avoiding inline-style churn.
      renderer.setSize(w, h, false);
      uPixelRatio.value = dpr;
      renderFrame();
    };
    doResize();
    const ro = new ResizeObserver(doResize);
    ro.observe(host);

    // ---- mouse parallax --------------------------------------------------
    let tx = 0;
    let ty = 0;
    const onPointerMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    if (!reduced) {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
    }

    // ---- render loop -----------------------------------------------------
    let raf = 0;
    let running = false;
    let elapsed = 0;
    let lastNow = performance.now() / 1000;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now() / 1000;
      elapsed += Math.min(now - lastNow, 0.05);
      lastNow = now;
      uTime.value = elapsed;
      group.rotation.y = elapsed * 0.04;
      group.rotation.x = 0.32 + Math.sin(elapsed * 0.1) * 0.05 + ty * 0.12;
      group.rotation.z = 0.12 - tx * 0.1;
      camera.position.x += (tx * 2.6 - camera.position.x) * 0.035;
      camera.position.y += (ty * 1.8 - camera.position.y) * 0.035;
      camera.position.z = 26 + Math.sin(elapsed * 0.12) * 1.6;
      camera.lookAt(0, 0, 0);
      renderFrame();
    };

    const resume = () => {
      if (running || document.hidden) return;
      running = true;
      lastNow = performance.now() / 1000;
      tick();
    };

    const onVisibility = () => {
      if (reduced) return;
      if (document.hidden && running) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!document.hidden) {
        resume();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onWinBlur = () => {
      if (reduced || !running) return;
      running = false;
      cancelAnimationFrame(raf);
    };
    const onWinFocus = () => {
      if (reduced) return;
      resume();
    };
    window.addEventListener("blur", onWinBlur);
    window.addEventListener("focus", onWinFocus);

    if (reduced) {
      uTime.value = 3.1;
      renderFrame();
    } else {
      running = true;
      tick();
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("blur", onWinBlur);
      window.removeEventListener("focus", onWinFocus);
      ro.disconnect();
      cancelAnimationFrame(raf);
      dustGeo.dispose();
      dustMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
      pulseGeo.dispose();
      pulseMat.dispose();
      nebGeo.dispose();
      nebMat.dispose();
      glowTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
    };
  }, [theme]);

  return <div className="particle-field" ref={hostRef} aria-hidden />;
}
