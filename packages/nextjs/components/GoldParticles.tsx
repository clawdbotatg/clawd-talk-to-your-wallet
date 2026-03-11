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
}

const GOLD_COLORS = ["#C9A84C", "#B8963E", "#E8C96A", "#D4B85A", "#A8893A"];
const PARTICLE_COUNT = 160;

/** Mouse-proximity blur constants */
const BLUR_SHARP_RADIUS = 80; // within this distance: fully sharp
const BLUR_MAX_RADIUS = 300; // beyond this distance: max blur
const BLUR_MAX_PX = 7; // maximum blur in pixels

const GoldParticles = ({ foreground }: GoldParticlesProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number>(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const mousePosRef = useRef({ x: -9999, y: -9999 });

  const createParticle = useCallback(
    (canvasW: number, canvasH: number, startRandom = true): Particle => {
      const maxOpacity = foreground ? 0.3 + Math.random() * 0.3 : 0.15 + Math.random() * 0.25;

      return {
        x: Math.random() * canvasW,
        y: startRandom ? Math.random() * canvasH : canvasH + Math.random() * 20,
        size: 1 + Math.random() * 2,
        speedY: -(0.08 + Math.random() * 0.17), // gentle upward drift
        speedX: (Math.random() - 0.5) * 0.14, // subtle horizontal drift
        opacity: 0,
        maxOpacity,
        color: GOLD_COLORS[Math.floor(Math.random() * GOLD_COLORS.length)],
        phase: Math.random() * Math.PI * 2,
        phaseSpeed: 0.005 + Math.random() * 0.01,
      };
    },
    [foreground],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Track mouse position for proximity-based focus
    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });

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
      const mouseX = mousePosRef.current.x;
      const mouseY = mousePosRef.current.y;

      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i];

        // Update position
        p.x += p.speedX;
        p.y += p.speedY;
        p.phase += p.phaseSpeed;

        // Fade in from bottom, fade out at top
        const edgeFade = Math.min(
          Math.min(p.y, h - p.y) / (h * 0.15), // vertical edges
          Math.min(p.x, w - p.x) / (w * 0.1), // horizontal edges
          1,
        );
        const pulse = 0.7 + 0.3 * Math.sin(p.phase);
        p.opacity = p.maxOpacity * Math.max(0, edgeFade) * pulse;

        // Mouse-proximity blur: near the cursor = sharp, far = bokeh
        const dx = p.x - mouseX;
        const dy = p.y - mouseY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // Smooth falloff: 0 within SHARP_RADIUS, ramp to 1 at MAX_RADIUS, clamp beyond
        const t = Math.max(0, Math.min((dist - BLUR_SHARP_RADIUS) / (BLUR_MAX_RADIUS - BLUR_SHARP_RADIUS), 1));
        // Ease-in-out for smoother transition (smoothstep)
        const eased = t * t * (3 - 2 * t);
        const blur = eased * BLUR_MAX_PX;

        // Draw with bokeh blur (skip filter when nearly sharp for performance)
        if (blur > 0.2) {
          ctx.filter = `blur(${blur.toFixed(1)}px)`;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.opacity;
        ctx.fill();
        if (blur > 0.2) {
          ctx.filter = "none";
        }

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
      window.removeEventListener("mousemove", handleMouseMove);
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
