import React from "react";

/**
 * Brutalist footer — bold brand, accent bar, raw.
 */
export const Footer = () => {
  return (
    <div className="min-h-0 px-4 pb-0">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between py-4">
          <span className="font-[family-name:var(--font-space-grotesk)] text-2xl font-bold uppercase tracking-wider">
            DENARAI
          </span>
          <span className="font-[family-name:var(--font-ibm-plex-mono)] text-xs uppercase" style={{ color: "#666666" }}>
            SINCE CCXI BC
          </span>
        </div>
        <div className="h-1" style={{ backgroundColor: "#FF4500" }} />
      </div>
    </div>
  );
};
