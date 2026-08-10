import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * A cinematic "cosmic drift" background rendered behind the whole app.
 *
 * Three layered, theme-aware elements give the backdrop depth and life:
 *   1. Nebula  — soft drifting color clouds (animated shader plane).
 *   2. Dust    — glowing sprite particles that twinkle and wander.
 *   3. Constellation — a faint web of connected nodes that pulses and flows.
 *
 * Slow tumble + mouse parallax make it feel alive. It pauses when the window
 * is hidden, falls back to nothing when WebGL is unavailable (the CSS aurora
 * behind us is enough), and honors prefers-reduced-motion with a static frame.
 */

/* ---------- dust (glowing sprite points) ---------- */
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
    pos.y += cos(uTime * 0.19 + aSeed * 9.7)  * 0.6;
    pos.z += sin(uTime * 0.16 + aSeed * 7.3)  * 0.55;
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * uPixelRatio * (uScale / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const DUST_FRAG = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform float uOpacity;
  uniform float uTime;
  varying float vSeed;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float alpha = smoothstep(0.5, 0.04, d);
    float tw = 0.55 + 0.45 * sin(uTime * (0.45 + fract(vSeed * 11.7) * 1.3) + vSeed * 43.0);
    float m = fract(vSeed * 3.7);
    vec3 color = m < 0.5
      ? mix(uColorA, uColorB, m * 2.0)
      : mix(uColorB, uColorC, (m - 0.5) * 2.0);
    gl_FragColor = vec4(color, alpha * uOpacity * tw);
  }
`;

/* ---------- constellation (connected node web) ---------- */
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

/* ---------- nebula (drifting color clouds) ---------- */
const NEB_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const NEB_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform float uOpacity;
  varying vec2 vUv;

  float blob(vec2 uv, vec2 c, float r) {
    float d = length(uv - c);
    return exp(-(d * d) / (r * r));
  }

  void main() {
    vec2 uv = vUv;
    vec2 c1 = vec2(0.32 + 0.12 * sin(uTime * 0.10), 0.38 + 0.10 * cos(uTime * 0.13));
    vec2 c2 = vec2(0.70 + 0.11 * cos(uTime * 0.11), 0.62 + 0.12 * sin(uTime * 0.09));
    vec2 c3 = vec2(0.50 + 0.16 * sin(uTime * 0.07), 0.52 + 0.13 * cos(uTime * 0.08));

    float w1 = blob(uv, c1, 0.30);
    float w2 = blob(uv, c2, 0.26);
    float w3 = blob(uv, c3, 0.32);
    float sum = w1 + w2 + w3 + 0.0001;

    vec3 col = (uColor1 * w1 + uColor2 * w2 + uColor3 * w3) / sum;
    float intensity = clamp(sum * 0.85, 0.0, 1.0);
    float vig = smoothstep(0.95, 0.18, length(uv - 0.5));
    gl_FragColor = vec4(col, uOpacity * vig * intensity);
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
      return; // no WebGL — the CSS aurora behind us is enough
    }
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 200);
    camera.position.z = 26;

    const dark = theme === "dark";

    // Shared uniforms -------------------------------------------------------
    const uTime = { value: 0 };

    // ---- dust ------------------------------------------------------------
    const uColorA = dark ? new THREE.Color("#6366f1") : new THREE.Color("#5a5df0");
    const uColorB = dark ? new THREE.Color("#22d3ee") : new THREE.Color("#0e7490");
    const uColorC = dark ? new THREE.Color("#a855f7") : new THREE.Color("#7c3aed");
    const dustOpacity = dark ? 0.5 : 0.28;
    const count = reduced ? 0 : 900;
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
      sizes[i] = orb ? 1.8 + rnd() * 3.0 : 0.5 + rnd() * 1.3;
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
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uScale: { value: 150 },
        uTime,
        uColorA: { value: uColorA },
        uColorB: { value: uColorB },
        uColorC: { value: uColorC },
        uOpacity: { value: dustOpacity },
      },
      transparent: true,
      depthWrite: false,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    // ---- constellation ---------------------------------------------------
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
    // connect each node to its 2 nearest neighbours (dedup)
    const seen = new Set<string>();
    const linePos: number[] = [];
    const linePhase: number[] = [];
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
        const pa = lrnd();
        const pb = lrnd();
        linePos.push(nodes[i].x, nodes[i].y, nodes[i].z);
        linePos.push(nodes[j].x, nodes[j].y, nodes[j].z);
        linePhase.push(pa, pb);
      }
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
        uOpacity: { value: dark ? 0.16 : 0.1 },
      },
      transparent: true,
      depthWrite: false,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    // ---- nebula ----------------------------------------------------------
    const nebGeo = new THREE.PlaneGeometry(2, 2);
    const nebMat = new THREE.ShaderMaterial({
      vertexShader: NEB_VERT,
      fragmentShader: NEB_FRAG,
      uniforms: {
        uTime,
        uColor1: { value: uColorA },
        uColor2: { value: uColorB },
        uColor3: { value: uColorC },
        uOpacity: { value: dark ? 0.32 : 0.22 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    // Group the dust + constellation so they tumble together; nebula stays put.
    const group = new THREE.Group();
    group.rotation.set(0.32, 0, 0.12);
    group.add(new THREE.Points(dustGeo, dustMat));
    group.add(new THREE.LineSegments(lineGeo, lineMat));
    scene.add(group);

    const nebCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const neb = new THREE.Mesh(nebGeo, nebMat);
    neb.position.z = -1;
    const nebScene = new THREE.Scene();
    nebScene.add(neb);

    // ---- resize ----------------------------------------------------------
    const resize = () => {
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h);
      dustMat.uniforms.uPixelRatio.value = dpr;
    };
    resize();
    const ro = new ResizeObserver(resize);
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

    // ---- render loop (pauses when the window is hidden) ------------------
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
      group.rotation.y = elapsed * 0.045;
      camera.position.x += (tx * 2.4 - camera.position.x) * 0.035;
      camera.position.y += (ty * 1.6 - camera.position.y) * 0.035;
      camera.position.z = 26 + Math.sin(elapsed * 0.12) * 1.4;
      camera.lookAt(0, 0, 0);

      renderer.autoClear = false;
      renderer.clear();
      renderer.render(nebScene, nebCam);
      renderer.render(scene, camera);
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
      renderer.autoClear = false;
      renderer.clear();
      renderer.render(nebScene, nebCam);
      renderer.render(scene, camera);
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
      nebGeo.dispose();
      nebMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
    };
  }, [theme]);

  return <div className="particle-field" ref={hostRef} aria-hidden />;
}
