import React from "react";

/**
 * Classical-style footer — thin gold rule, Cinzel brand, "Since CCXI BC"
 */
export const Footer = () => {
  return (
    <div className="min-h-0 py-4 px-4" style={{ borderTop: "1px solid rgba(201, 168, 76, 0.15)" }}>
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <span className="font-[family-name:var(--font-cinzel)] text-xs tracking-[0.3em]" style={{ color: "#8A8578" }}>
          DENARAI
        </span>
        <span className="text-xs italic" style={{ color: "rgba(138, 133, 120, 0.6)" }}>
          Since CCXI BC
        </span>
      </div>
    </div>
  );
};
