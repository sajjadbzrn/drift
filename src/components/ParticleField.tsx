import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * A calm, cinematic "cosmic drift" nebula backdrop rendered behind the whole
 * app. Organic, flowing FBM clouds animate slowly in a fullscreen shader,
 * giving the background depth and life. It pauses when the window is hidden,
 * falls back to nothing when WebGL is unavailable, and honors
 * prefers-reduced-motion with a single static frame.
 */

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
     for (int i = 0; i < 4; i++) {
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
     float clouds = fbm(p * 1.5 + w * 2.0);
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

export function ParticleField({
  theme,
}: {
  theme: "dark" | "light";
}) {
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

    const dark = theme === "dark";

    const uTime = { value: 0 };
    const uAspect = { value: 1 };
    const blend = dark ? THREE.AdditiveBlending : THREE.NormalBlending;

    // ---- nebula ----------------------------------------------------------
    const nebGeo = new THREE.PlaneGeometry(2, 2);
    const nebMat = new THREE.ShaderMaterial({
      vertexShader: NEB_VERT,
      fragmentShader: NEB_FRAG,
      uniforms: {
        uTime,
        uAspect,
        uColor1: { value: dark ? new THREE.Color("#6366f1") : new THREE.Color("#5a5df0") },
        uColor2: { value: dark ? new THREE.Color("#22d3ee") : new THREE.Color("#0e7490") },
        uColor3: { value: dark ? new THREE.Color("#a855f7") : new THREE.Color("#7c3aed") },
        uColor4: { value: dark ? new THREE.Color("#e879f9") : new THREE.Color("#c084fc") },
        uOpacity: { value: dark ? 0.5 : 0.32 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: blend,
    });

    const nebCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const neb = new THREE.Mesh(nebGeo, nebMat);
    neb.position.z = -1;
    const nebScene = new THREE.Scene();
    nebScene.add(neb);

    const renderFrame = () => {
      renderer.render(nebScene, nebCam);
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
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      uAspect.value = w / h;
      renderer.setPixelRatio(dpr);
      // updateStyle=false: let the CSS (width/height:100%) drive display size
      // and only resize the drawing buffer, avoiding inline-style churn.
      renderer.setSize(w, h, false);
      renderFrame();
    };
    doResize();
    const ro = new ResizeObserver(doResize);
    ro.observe(host);

    // ---- render loop -----------------------------------------------------
    let raf = 0;
    let running = false;
    let elapsed = 0;
    let lastNow = performance.now() / 1000;
    let acc = 0;
    // Cap to ~30fps. The backdrop is a slow cosmic drift, so 60fps just wastes
    // GPU/CPU/battery for no visible benefit.
    const frameDt = 1 / 30;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now() / 1000;
      acc += Math.min(now - lastNow, 0.1);
      lastNow = now;
      if (acc < frameDt) return;
      elapsed += acc;
      acc = 0;
      uTime.value = elapsed;
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

    if (reduced) {
      uTime.value = 3.1;
      renderFrame();
    } else {
      running = true;
      tick();
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      ro.disconnect();
      cancelAnimationFrame(raf);
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
