"use client";

import { useState } from "react";
import type { AppState } from "@/lib/types";
import { bkey } from "@/lib/types";
import { TRADE_GROUPS, groupFor } from "@/lib/calc";

function shiftDate(ds: string, delta: number) {
  const d = new Date(ds + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function copyText(txt: string) {
  navigator.clipboard?.writeText(txt).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  });
}

export default function Daily({ state }: { state: AppState }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const { roster, projects, bookings } = state;

  function projName(id: string) {
    return projects.find((p) => p.id === id)?.name || "?";
  }

  function buildBlocks() {
    if (!date) return [] as { group: string; count: number; text: string }[];
    const d = new Date(date + "T00:00:00");
    const dateNice = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
    const groups: Record<string, Record<string, string[]>> = {};
    roster.forEach((p) => {
      const pb = bookings[bkey(date, p.id, "P")];
      const ob = bookings[bkey(date, p.id, "O")];
      if (!pb && !ob) return;
      const g = groupFor(p.trade);
      if (!groups[g]) groups[g] = {};
      if (!groups[g][p.trade]) groups[g][p.trade] = [];
      const parts: string[] = [];
      if (pb) parts.push(projName(pb.proj) + (pb.loc === "factory" ? " (Factory)" : ""));
      if (ob && ob.hrs) parts.push(`OT ${ob.hrs}h: ` + projName(ob.proj) + (ob.loc === "factory" ? " (Factory)" : ""));
      groups[g][p.trade].push(`• ${p.name} — ${parts.join(" | ")}`);
    });
    const order = TRADE_GROUPS.map((g) => g.label).concat(["Other"]);
    const out: { group: string; count: number; text: string }[] = [];
    order.forEach((gname) => {
      const trades = groups[gname];
      if (!trades) return;
      let count = 0;
      let body = "";
      Object.keys(trades)
        .sort()
        .forEach((tr) => {
          body += `\n*${tr}*\n` + trades[tr].join("\n") + "\n";
          count += trades[tr].length;
        });
      out.push({ group: gname, count, text: `*Resource Allocation for ${gname}*  ${dateNice}\n${body}`.trimEnd() });
    });
    return out;
  }

  const blocks = buildBlocks();

  return (
    <div className="card">
      <h2>Daily allocation — trade-wise</h2>
      <div className="sub">
        Pick a date, then copy a clean text summary to paste into your site WhatsApp group. Grouped by trade, showing who is
        where (site/factory) and OT.
      </div>
      <div className="row" style={{ marginBottom: 14 }}>
        <div>
          <span className="fldlabel">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <button className="btn sm" onClick={() => setDate((d) => shiftDate(d, -1))}>
          ← Prev day
        </button>
        <button className="btn sm" onClick={() => setDate((d) => shiftDate(d, 1))}>
          Next day →
        </button>
        <button
          className="btn primary sm spacer"
          onClick={() => {
            if (!blocks.length) return;
            copyText(blocks.map((b) => b.text).join("\n\n———\n\n"));
            setCopiedAll(true);
            setTimeout(() => setCopiedAll(false), 1200);
          }}
        >
          Copy all blocks
        </button>
        <span className="save-dot" style={{ color: "var(--accent)", opacity: copiedAll ? 1 : 0 }}>
          Copied ✓
        </span>
      </div>
      {!blocks.length ? (
        <div className="empty">No resources allocated for this day.</div>
      ) : (
        blocks.map((b, i) => (
          <div className="dblock" key={b.group}>
            <div className="dblock-head">
              <span className="gname">{b.group}</span>
              <span className="gcount">{b.count} allocated</span>
              <span className="copied-mini" style={{ opacity: copiedIdx === i ? 1 : 0 }}>
                Copied ✓
              </span>
              <button
                className="btn sm"
                style={{ marginLeft: "auto" }}
                onClick={() => {
                  copyText(b.text);
                  setCopiedIdx(i);
                  setTimeout(() => setCopiedIdx(null), 1200);
                }}
              >
                Copy this block
              </button>
            </div>
            <pre>{b.text}</pre>
          </div>
        ))
      )}
    </div>
  );
}
