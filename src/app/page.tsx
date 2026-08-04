import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Newsreader, Libre_Franklin } from "next/font/google";

const newsreader = Newsreader({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-newsreader" });
const libreFranklin = Libre_Franklin({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-libre" });

export default async function LandingPage() {
  const { userId } = await auth();
  const resourcesHref = userId ? "/app" : "/sign-in";

  const comingSoonBadge = (color: string, border: string) => (
    <span
      style={{
        position: "absolute",
        top: 14,
        right: 14,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: ".4px",
        textTransform: "uppercase",
        color,
        border: `1px solid ${border}`,
        borderRadius: 20,
        padding: "2px 8px",
      }}
    >
      Coming soon
    </span>
  );

  return (
    <div
      className={`${newsreader.variable} ${libreFranklin.variable}`}
      style={{ minHeight: "100vh", background: "#e9e7e1", fontFamily: "var(--font-libre), system-ui, sans-serif" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "20px 40px", borderBottom: "1px solid rgba(0,0,0,.09)" }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            background: "#1a1a1a",
            color: "#f2f1ee",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-newsreader), serif",
            fontWeight: 600,
            fontSize: 18,
          }}
        >
          S
        </div>
        <div style={{ fontFamily: "var(--font-newsreader), serif", fontSize: 17, fontWeight: 600, color: "#1a1a1a" }}>
          Studio North <span style={{ color: "rgba(0,0,0,.35)", fontWeight: 400 }}>/ Operations</span>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "64px 24px 80px", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-newsreader), serif", fontSize: 34, fontWeight: 500, color: "#1a1a1a", lineHeight: 1.1 }}>
          Where are you headed?
        </div>
        <div style={{ fontSize: 14, color: "rgba(0,0,0,.5)", marginTop: 10 }}>
          Pick a module below, then sign in to continue with your access level.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginTop: 44 }}>
          <div
            style={{
              position: "relative",
              textAlign: "left",
              background: "#201d18",
              borderRadius: 10,
              padding: "24px 22px",
              opacity: 0.55,
              cursor: "not-allowed",
            }}
          >
            {comingSoonBadge("rgba(242,241,238,.55)", "rgba(242,241,238,.25)")}
            <div style={{ fontFamily: "var(--font-newsreader), serif", fontSize: 20, fontWeight: 600, color: "#f2f1ee" }}>Scheduler</div>
            <div style={{ fontSize: 12.5, color: "rgba(242,241,238,.6)", marginTop: 6 }}>Phase timelines, install dates, hand-offs</div>
          </div>

          <Link
            href={resourcesHref}
            style={{
              textAlign: "left",
              textDecoration: "none",
              background: "#6b7040",
              borderRadius: 10,
              padding: "24px 22px",
              display: "block",
            }}
          >
            <div style={{ fontFamily: "var(--font-newsreader), serif", fontSize: 20, fontWeight: 600, color: "#f7f6f1" }}>Resources</div>
            <div style={{ fontSize: 12.5, color: "rgba(247,246,241,.75)", marginTop: 6 }}>Resource Planner &amp; Project P&amp;L</div>
          </Link>

          <div
            style={{
              position: "relative",
              textAlign: "left",
              background: "#b8552f",
              borderRadius: 10,
              padding: "24px 22px",
              opacity: 0.55,
              cursor: "not-allowed",
            }}
          >
            {comingSoonBadge("rgba(251,243,238,.7)", "rgba(251,243,238,.3)")}
            <div style={{ fontFamily: "var(--font-newsreader), serif", fontSize: 20, fontWeight: 600, color: "#fbf3ee" }}>Finance</div>
            <div style={{ fontSize: 12.5, color: "rgba(251,243,238,.8)", marginTop: 6 }}>Budget, margin, forecast, labor cost</div>
          </div>
        </div>
      </div>
    </div>
  );
}
