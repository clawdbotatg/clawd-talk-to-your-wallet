import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "DENARAI — talk to your coins";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          background: "#0a0a0a",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Gold radial glow behind title */}
        <div
          style={{
            position: "absolute",
            width: "600px",
            height: "600px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(201,168,76,0.15) 0%, transparent 70%)",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
          }}
        />

        {/* Subtle horizontal line top */}
        <div
          style={{
            position: "absolute",
            top: "80px",
            left: "120px",
            right: "120px",
            height: "1px",
            background: "rgba(201,168,76,0.2)",
            display: "flex",
          }}
        />

        {/* Subtle horizontal line bottom */}
        <div
          style={{
            position: "absolute",
            bottom: "80px",
            left: "120px",
            right: "120px",
            height: "1px",
            background: "rgba(201,168,76,0.2)",
            display: "flex",
          }}
        />

        {/* Title */}
        <div
          style={{
            fontSize: "120px",
            fontWeight: "700",
            letterSpacing: "0.3em",
            color: "#C9A84C",
            textShadow: "0 0 80px rgba(201,168,76,0.4)",
            marginBottom: "24px",
            display: "flex",
          }}
        >
          DENARAI
        </div>

        {/* Divider */}
        <div
          style={{
            width: "200px",
            height: "1px",
            background: "rgba(201,168,76,0.4)",
            marginBottom: "28px",
            display: "flex",
          }}
        />

        {/* Tagline */}
        <div
          style={{
            fontSize: "28px",
            letterSpacing: "0.25em",
            color: "#E8E4DC",
            opacity: 0.85,
            display: "flex",
          }}
        >
          talk to your coins
        </div>

        {/* Corner decorations — small gold dots */}
        {[
          { top: "48px", left: "48px" },
          { top: "48px", right: "48px" },
          { bottom: "48px", left: "48px" },
          { bottom: "48px", right: "48px" },
        ].map((pos, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "rgba(201,168,76,0.5)",
              display: "flex",
              ...pos,
            }}
          />
        ))}
      </div>
    ),
    { ...size },
  );
}
