"use client";

import { useCallback, useEffect, useRef } from "react";

interface GoldParticlesProps {
  /** true = foreground (z-20, logged out), false = background (z-0, logged in) */
  foreground: boolean;
}

interface Particle {
  x: number;
  y: number;
  size: number;
  speedY: number;
  speedX: number;
  opacity: number;
  maxOpacity: number;
  color: string;
  phase: number; // for gentle pulsing
  phaseSpeed: number;
  blurBase: number; // center of blur oscillation (0 = mostly sharp, higher = mostly soft)
  blurAmplitude: number; // how much blur varies around the base
  blurPhase: number; // independent phase offset for blur cycle
  blurPhaseSpeed: number; // speed of blur oscillation
}

const GOLD_COLORS = ["#C9A84C", "#B8963E", "#E8C96A", "#D4B85A", "#A8893A"];
const PARTICLE_COUNT = 100;

const GoldParticles = ({ foreground }: GoldParticlesProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number>(0);
  const sizeRef = useRef({ w: 0, h: 0 });

  const createParticle = useCallback(
    (canvasW: number, canvasH: number, startRandom = true): Particle => {
      const maxOpacity = foreground ? 0.3 + Math.random() * 0.3 : 0.15 + Math.random() * 0.25;
      // Depth-of-field: heavily blurred by default (soft bokeh), rare brief moments of focus
      const depthLayer = Math.random(); // 0 = rare foreground/occasionally sharp, 1 = deep background/always blurry
      // Most particles sit at 4–10px blur; only the lowest depthLayer ones can dip toward sharp
      const blurBase = depthLayer < 0.15
        ? 1.5 + Math.random() * 2.5    // rare ~15%: base 1.5–4px (occasionally near-sharp)
        : 4 + Math.random() * 6;        // majority: base 4–10px (soft bokeh)
      // Amplitude: blurry particles stay blurry; near-sharp ones oscillate gently
      const blurAmplitude = depthLayer < 0.15
        ? 1.0 + Math.random() * 1.5     // near-sharp: oscillates ±1.0–2.5px (brief focus windows)
        : 0.5 + Math.random() * 1.5;    // blurry: oscillates ±0.5–2.0px (stays soft)

      return {
        x: Math.random() * canvasW,
        y: startRandom ? Math.random() * canvasH : canvasH + Math.random() * 20,
        size: 1 + Math.random() * 2,
        speedY: -(0.03 + Math.random() * 0.09), // barely drifting upward, like dust in ancient air
        speedX: (Math.random() - 0.5) * 0.08, // very subtle horizontal drift
        opacity: 0,
        maxOpacity,
        color: GOLD_COLORS[Math.floor(Math.random() * GOLD_COLORS.length)],
        phase: Math.random() * Math.PI * 2,
        phaseSpeed: 0.005 + Math.random() * 0.01,
        blurBase,
        blurAmplitude,
        blurPhase: Math.random() * Math.PI * 2,
        blurPhaseSpeed: 0.001 + Math.random() * 0.003, // very slow blur oscillation — dreamy, unhurried
      };
    },
    [foreground],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { w, h };
    };

    resize();
    window.addEventListener("resize", resize);

    // Initialize particles
    const { w, h } = sizeRef.current;
    particlesRef.current = Array.from({ length: PARTICLE_COUNT }, () => createParticle(w, h, true));

    const animate = () => {
      const { w, h } = sizeRef.current;
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i];

        // Update position
        p.x += p.speedX;
        p.y += p.speedY;
        p.phase += p.phaseSpeed;
        p.blurPhase += p.blurPhaseSpeed;

        // Fade in from bottom, fade out at top
        const edgeFade = Math.min(
          Math.min(p.y, h - p.y) / (h * 0.15), // vertical edges
          Math.min(p.x, w - p.x) / (w * 0.1), // horizontal edges
          1,
        );
        const pulse = 0.7 + 0.3 * Math.sin(p.phase);
        p.opacity = p.maxOpacity * Math.max(0, edgeFade) * pulse;

        // Depth-of-field blur — sine wave oscillation per particle
        const blur = Math.max(0, p.blurBase + p.blurAmplitude * Math.sin(p.blurPhase));

        // Draw with bokeh blur
        ctx.filter = blur > 0.1 ? `blur(${blur.toFixed(1)}px)` : "none";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity;
        ctx.fill();
        ctx.filter = "none";

        // Reset if off-screen
        if (p.y < -10 || p.x < -10 || p.x > w + 10) {
          particlesRef.current[i] = createParticle(w, h, false);
        }
      }

      ctx.globalAlpha = 1;
      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [createParticle]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: foreground ? 20 : 0,
      }}
      aria-hidden="true"
    />
  );
};

export default GoldParticles;
