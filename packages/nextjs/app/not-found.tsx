import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex items-center h-full flex-1 justify-center" style={{ backgroundColor: "#FFF8EE" }}>
      <div className="text-center">
        <h1
          className="font-[family-name:var(--font-victor-mono)] m-0 mb-1"
          style={{ fontSize: "4rem", fontWeight: "bold", color: "#2C2C2C" }}
        >
          404
        </h1>
        <h2
          className="font-[family-name:var(--font-newsreader)] italic m-0"
          style={{ fontSize: "1.5rem", color: "#2C2C2C" }}
        >
          Page Not Found
        </h2>
        <p style={{ color: "#8B8680", fontSize: "14px", marginTop: "0.5rem", marginBottom: "1.5rem" }}>
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <Link
          href="/"
          style={{
            backgroundColor: "#2C2C2C",
            color: "#FFF8EE",
            padding: "0.5rem 1.5rem",
            textDecoration: "none",
            fontSize: "13px",
            fontWeight: 600,
          }}
        >
          Return Home
        </Link>
      </div>
    </div>
  );
}
