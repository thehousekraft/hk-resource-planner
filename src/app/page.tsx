import Link from "next/link";
import { auth } from "@clerk/nextjs/server";

export default async function LandingPage() {
  const { userId } = await auth();

  return (
    <div className="wrap" style={{ maxWidth: 640, textAlign: "center", paddingTop: "12vh" }}>
      <div className="brand">
        <h1 style={{ fontSize: 34 }}>Resource Planner &amp; Project P&amp;L</h1>
        <p style={{ fontSize: 15, marginTop: 10 }}>
          Calendar bookings with OT and site/factory, double-booking guards, bench &amp; multi-month P&amp;L.
        </p>
      </div>
      <div className="card" style={{ marginTop: 32, display: "flex", justifyContent: "center", gap: 12, padding: 28 }}>
        {userId ? (
          <Link className="btn primary" href="/app">
            Go to planner →
          </Link>
        ) : (
          <>
            <Link className="btn primary" href="/sign-in">
              Sign in
            </Link>
            <Link className="btn" href="/sign-up">
              Sign up
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
