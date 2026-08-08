"use client";

import { useEffect, useRef, useState } from "react";
import type { AppState, AreaLine, MaterialLine } from "@/lib/types";
import { CUR, NUM, OT_HR_FRAC, countBand, countBandLoc, datesForBand, formatDateList, isSqft, projStats, sumOtHours } from "@/lib/calc";
import {
  createInvoiceUploadUrl,
  createScopeUploadUrl,
  deleteInvoice,
  finalizeInvoiceUpload,
  finalizeScopeUpload,
  getScopeDrawing,
  getScopeReuploadStatus,
  listInvoices,
  requestScopeReupload,
  type InvoiceRow,
  type ReuploadLockStatus,
  type ScopeDrawingRow,
} from "@/app/actions";

const MAX_UPLOAD_BYTES = 7 * 1024 * 1024;

/* Uploads bytes straight from the browser to Supabase Storage using a short-lived
   signed URL, bypassing our own server entirely — Vercel's serverless functions cap
   request bodies at ~4.5MB regardless of app config, well under our 7MB limit. */
async function uploadFileDirect(signedUrl: string, file: File) {
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload to storage failed (${res.status})`);
}

export default function Pnl({
  state,
  isAdmin,
  onSetCurrent,
  onRename,
  onSetRevenue,
  onAddMaterial,
  onUpdateMaterial,
  onDeleteMaterial,
  onEnsureArea,
  onAddArea,
  onUpdateArea,
  onDeleteArea,
}: {
  state: AppState;
  isAdmin: boolean;
  onSetCurrent: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onSetRevenue: (id: string, revenue: number) => void;
  onAddMaterial: () => void;
  onUpdateMaterial: (id: string, patch: Partial<MaterialLine>) => void;
  onDeleteMaterial: (id: string) => void;
  onEnsureArea: (resId: string) => void;
  onAddArea: (resId: string) => void;
  onUpdateArea: (resId: string, id: string, patch: Partial<AreaLine>) => void;
  onDeleteArea: (resId: string, id: string) => void;
}) {
  const { roster, projects, current, bookings } = state;
  const proj = projects.find((p) => p.id === current);

  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!proj) return;
    listInvoices(proj.id)
      .then(setInvoices)
      .catch((err) => console.error(err));
  }, [proj?.id]);

  const scopeFileInputRef = useRef<HTMLInputElement>(null);
  const [scopeDrawing, setScopeDrawing] = useState<ScopeDrawingRow | null>(null);
  const [reuploadStatus, setReuploadStatus] = useState<ReuploadLockStatus>("none");
  const [pendingScopeFile, setPendingScopeFile] = useState<File | null>(null);
  const [scopeUploading, setScopeUploading] = useState(false);
  const [showReuploadModal, setShowReuploadModal] = useState(false);
  const [reuploadJustification, setReuploadJustification] = useState("");
  const [requestingReupload, setRequestingReupload] = useState(false);

  useEffect(() => {
    setPendingScopeFile(null);
    if (!proj) return;
    Promise.all([getScopeDrawing(proj.id), getScopeReuploadStatus(proj.id)])
      .then(([d, s]) => {
        setScopeDrawing(d);
        setReuploadStatus(s);
      })
      .catch((err) => console.error(err));
  }, [proj?.id]);

  function handleScopeFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      if (f.size > MAX_UPLOAD_BYTES) {
        alert("File is too large. The upload limit is 7MB.");
      } else {
        setPendingScopeFile(f);
      }
    }
    e.target.value = "";
  }
  async function confirmScopeUpload() {
    if (!pendingScopeFile || !proj) return;
    setScopeUploading(true);
    try {
      const { signedUrl, path } = await createScopeUploadUrl(proj.id, pendingScopeFile.name, pendingScopeFile.size);
      await uploadFileDirect(signedUrl, pendingScopeFile);
      await finalizeScopeUpload(proj.id, path, pendingScopeFile.name);
      setScopeDrawing(await getScopeDrawing(proj.id));
      setReuploadStatus(await getScopeReuploadStatus(proj.id));
      setPendingScopeFile(null);
    } catch (err) {
      alert("Upload failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setScopeUploading(false);
    }
  }
  async function submitReuploadRequest() {
    if (!proj) return;
    setRequestingReupload(true);
    try {
      await requestScopeReupload(proj.id, reuploadJustification);
      setReuploadStatus(await getScopeReuploadStatus(proj.id));
      setShowReuploadModal(false);
      setReuploadJustification("");
    } catch (err) {
      alert("Could not submit request: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setRequestingReupload(false);
    }
  }

  async function handleInvoiceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f || !proj) return;
    if (f.size > MAX_UPLOAD_BYTES) {
      alert("File is too large. The upload limit is 7MB.");
      e.target.value = "";
      return;
    }
    setUploading(true);
    try {
      const { signedUrl, path } = await createInvoiceUploadUrl(proj.id, f.name, f.size);
      await uploadFileDirect(signedUrl, f);
      await finalizeInvoiceUpload(proj.id, path, f.name);
      setInvoices(await listInvoices(proj.id));
    } catch (err) {
      alert("Upload failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleDeleteInvoice(id: string) {
    if (!proj) return;
    try {
      await deleteInvoice(id);
      setInvoices(await listInvoices(proj.id));
    } catch (err) {
      alert("Could not delete: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  const sqftPeople = proj
    ? roster.filter((p) => isSqft(p) && (countBand(state, p.id, proj.id, "P") || sumOtHours(state, p.id, proj.id)))
    : [];

  useEffect(() => {
    if (!proj) return;
    sqftPeople.forEach((p) => {
      if (!proj.areas[p.id]?.length) onEnsureArea(p.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proj?.id, sqftPeople.map((p) => p.id).join(","), bookings]);

  if (!proj) return null;
  const s = projStats(state, proj);

  const dayRows = roster
    .filter((p) => !isSqft(p))
    .map((p) => ({ p, prim: countBand(state, p.id, proj.id, "P"), oth: sumOtHours(state, p.id, proj.id) }))
    .filter((x) => x.prim || x.oth);

  let tP = 0,
    tO = 0;

  return (
    <>
      <div className="card">
        <div className="row">
          <div>
            <span className="fldlabel">Project</span>
            <select value={current} onChange={(e) => onSetCurrent(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <span className="fldlabel">Rename</span>
            <input type="text" style={{ width: "100%" }} value={proj.name} onChange={(e) => onRename(proj.id, e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Activity/Scope Price quoted</h2>
        <div className="sub">Client-billed / quoted value for this project.</div>
        <div className="rev-grid">
          <label>Activity/Scope Price quoted</label>
          <input
            type="number"
            min={0}
            step={1000}
            placeholder="0"
            value={proj.revenue || ""}
            onChange={(e) => onSetRevenue(proj.id, Number(e.target.value) || 0)}
          />
        </div>

        <h2 style={{ marginTop: 22 }}>Material estimate</h2>
        <div className="sub">Material line items for this project.</div>
        <div className="mat-row mat-head">
          <div>Item</div>
          <div>Estimate cost</div>
          <div />
        </div>
        {proj.materials.map((m) => (
          <div className="mat-row" key={m.id}>
            <input
              type="text"
              placeholder="e.g. Plywood, laminate"
              value={m.item}
              onChange={(e) => onUpdateMaterial(m.id, { item: e.target.value })}
            />
            <input
              type="number"
              placeholder="0"
              min={0}
              value={m.cost || ""}
              onChange={(e) => onUpdateMaterial(m.id, { cost: Number(e.target.value) || 0 })}
            />
            <button className="del-x" onClick={() => onDeleteMaterial(m.id)}>
              ×
            </button>
          </div>
        ))}
        <button className="btn sm" onClick={onAddMaterial}>
          + Add material
        </button>

        <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
          <button className="btn sm" onClick={() => setShowInvoiceModal(true)}>
            Upload invoice
          </button>
          {invoices.length > 0 && (
            <div style={{ marginTop: 10 }}>
              {invoices.map((inv) => (
                <div key={inv.id} className="row" style={{ fontSize: 12.5, padding: "4px 0" }}>
                  <a href={inv.url} target="_blank" rel="noopener noreferrer">
                    {inv.fileName}
                  </a>
                  <span className="muted">{new Date(inv.uploadedAt).toLocaleDateString()}</span>
                  <button className="del-x" style={{ fontSize: 14 }} onClick={() => handleDeleteInvoice(inv.id)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>
          Day-rate labour <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(all months)</span>
        </h2>
        <div className="sub">Primary = mandays × rate. OT = OT-days × 3/8 × rate. Site/Factory split shown per person.</div>

        <div style={{ margin: "12px 0 18px", paddingBottom: 16, borderBottom: "1px solid var(--line)" }}>
          <div className="fldlabel" style={{ marginBottom: 6 }}>
            Scope drawing (for allocation)
          </div>
          {scopeDrawing && (
            <div className="row" style={{ fontSize: 12.5, marginBottom: 8 }}>
              <a href={scopeDrawing.url} target="_blank" rel="noopener noreferrer">
                {scopeDrawing.fileName}
              </a>
              <span className="muted">uploaded {new Date(scopeDrawing.uploadedAt).toLocaleDateString()}</span>
            </div>
          )}
          <input
            ref={scopeFileInputRef}
            type="file"
            style={{ display: "none" }}
            accept=".pdf,.png,.jpg,.jpeg,.dwg,.dxf"
            onChange={handleScopeFilePicked}
          />
          {!scopeDrawing && (
            <button className="btn sm" onClick={() => scopeFileInputRef.current?.click()} disabled={scopeUploading}>
              Upload scope drawing
            </button>
          )}
          {scopeDrawing && isAdmin && (
            <button className="btn sm" onClick={() => scopeFileInputRef.current?.click()} disabled={scopeUploading}>
              Replace scope drawing
            </button>
          )}
          {scopeDrawing && !isAdmin && reuploadStatus === "approved" && (
            <button className="btn sm" onClick={() => scopeFileInputRef.current?.click()} disabled={scopeUploading}>
              Upload approved drawing
            </button>
          )}
          {scopeDrawing && !isAdmin && reuploadStatus === "none" && (
            <button className="btn sm" onClick={() => setShowReuploadModal(true)}>
              Locked — request re-upload
            </button>
          )}
          {scopeDrawing && !isAdmin && reuploadStatus === "pending" && (
            <span className="muted" style={{ fontSize: 12.5 }}>
              Re-upload request pending admin approval.
            </span>
          )}
          {pendingScopeFile && (
            <div className="row" style={{ marginTop: 10, fontSize: 12.5, background: "var(--wknd)", padding: "8px 10px", borderRadius: 6 }}>
              <span>
                Ready to upload <b>{pendingScopeFile.name}</b>
                {scopeDrawing ? " — this replaces the current drawing." : "."}
              </span>
              <button className="btn sm" onClick={() => setPendingScopeFile(null)}>
                Cancel
              </button>
              <button className="btn primary sm" onClick={confirmScopeUpload} disabled={scopeUploading}>
                {scopeUploading ? "Uploading…" : "Confirm upload"}
              </button>
            </div>
          )}
        </div>

        {!dayRows.length ? (
          <div className="empty">No day-rate resources booked. Book days on the planner.</div>
        ) : (
          <table className="rtable">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ textAlign: "right" }}>Rate/day</th>
                <th style={{ textAlign: "right" }}>Primary days</th>
                <th style={{ textAlign: "right" }}>Site/Fac</th>
                <th style={{ textAlign: "right" }}>OT hrs</th>
                <th style={{ textAlign: "right" }}>Primary ₹</th>
                <th style={{ textAlign: "right" }}>OT ₹</th>
                <th style={{ textAlign: "right" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {dayRows.map(({ p, prim, oth }) => {
                const pc = prim * p.rate;
                const oc = oth * p.rate * OT_HR_FRAC;
                tP += pc;
                tO += oc;
                const site = countBandLoc(state, p.id, proj.id, "P", "site");
                const fac = countBandLoc(state, p.id, proj.id, "P", "factory");
                const primDates = datesForBand(state, p.id, proj.id, "P");
                const otDates = datesForBand(state, p.id, proj.id, "O");
                return (
                  <tr key={p.id}>
                    <td>
                      {p.name}
                      <div className="muted" style={{ fontSize: 11 }}>
                        {p.trade}
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>{CUR.format(p.rate)}</td>
                    <td style={{ textAlign: "right" }}>
                      {prim}
                      {primDates.length > 0 && (
                        <div
                          className="muted"
                          style={{ fontSize: 9.5, lineHeight: 1.3, marginTop: 2, maxWidth: 150, marginLeft: "auto" }}
                        >
                          {formatDateList(primDates)}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right", fontSize: 12 }}>
                      {site}/{fac}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {oth || ""}
                      {otDates.length > 0 && (
                        <div
                          className="muted"
                          style={{ fontSize: 9.5, lineHeight: 1.3, marginTop: 2, maxWidth: 150, marginLeft: "auto" }}
                        >
                          {formatDateList(otDates)}
                        </div>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>{CUR.format(pc)}</td>
                    <td style={{ textAlign: "right" }}>{CUR.format(oc)}</td>
                    <td style={{ textAlign: "right", fontWeight: 560 }}>{CUR.format(pc + oc)}</td>
                  </tr>
                );
              })}
              <tr>
                <td colSpan={5} style={{ textAlign: "right", fontWeight: 700, borderTop: "2px solid var(--ink)" }}>
                  Day labour total
                </td>
                <td style={{ textAlign: "right", fontWeight: 700, borderTop: "2px solid var(--ink)" }}>{CUR.format(tP)}</td>
                <td style={{ textAlign: "right", fontWeight: 700, borderTop: "2px solid var(--ink)" }}>{CUR.format(tO)}</td>
                <td style={{ textAlign: "right", fontWeight: 700, borderTop: "2px solid var(--ink)" }}>{CUR.format(tP + tO)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>
          Sqft labour <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>(area-wise)</span>
        </h2>
        <div className="sub">Contract trades are cost-driven by area sqft. Their calendar days still block their time.</div>
        {!sqftPeople.length ? (
          <div className="empty">No sqft resources booked to this project. Book their days on the planner to enable area entry.</div>
        ) : (
          sqftPeople.map((p) => {
            const list = proj.areas[p.id] || [];
            let sub = 0;
            const days = countBand(state, p.id, proj.id, "P");
            const oth = sumOtHours(state, p.id, proj.id);
            return (
              <div className="area-block" key={p.id}>
                <h3>{p.name}</h3>
                <div className="who">
                  {p.trade} · {CUR.format(p.rate)}/sqft · {days} day(s){oth ? ` + ${oth}h OT` : ""} booked
                </div>
                {list.map((a) => {
                  const c = (Number(a.sqft) || 0) * p.rate;
                  sub += c;
                  return (
                    <div className="area-row" key={a.id}>
                      <input
                        type="text"
                        className="a-name"
                        placeholder="Area (e.g. Kitchen)"
                        value={a.area}
                        onChange={(e) => onUpdateArea(p.id, a.id, { area: e.target.value })}
                      />
                      <input
                        type="number"
                        className="a-sqft"
                        placeholder="sqft"
                        min={0}
                        value={a.sqft || ""}
                        onChange={(e) => onUpdateArea(p.id, a.id, { sqft: Number(e.target.value) || 0 })}
                      />
                      <div className="area-cost">
                        {CUR.format(c)}
                        <div className="ai">{p.rate}/sqft</div>
                      </div>
                      <button className="del-x" onClick={() => onDeleteArea(p.id, a.id)}>
                        ×
                      </button>
                    </div>
                  );
                })}
                <button className="btn sm" onClick={() => onAddArea(p.id)}>
                  + Add area
                </button>
                <span style={{ float: "right", fontWeight: 600 }}>Subtotal {CUR.format(sub)}</span>
              </div>
            );
          })
        )}
      </div>

      <div className="card">
        <h2>Activity/Scope P&amp;L</h2>
        <div className="sub">{proj.name} · all-months total</div>
        <div className="sumstrip">
          <div className="cell2">
            <div className="k">Primary labour</div>
            <div className="v">{CUR.format(s.prim)}</div>
          </div>
          <div className="cell2">
            <div className="k">OT labour</div>
            <div className="v">{CUR.format(s.ot)}</div>
          </div>
          <div className="cell2">
            <div className="k">Sqft labour</div>
            <div className="v">{CUR.format(s.sq)}</div>
          </div>
          <div className="cell2">
            <div className="k">Material</div>
            <div className="v">{CUR.format(s.mat)}</div>
          </div>
          <div className="cell2">
            <div className="k">Total cost</div>
            <div className="v">{CUR.format(s.cost)}</div>
          </div>
          <div className="cell2">
            <div className="k">Revenue</div>
            <div className="v">{CUR.format(s.rev)}</div>
          </div>
          <div className="cell2">
            <div className="k">Profit</div>
            <div className={"v " + (s.profit >= 0 ? "pos" : "neg")}>{CUR.format(s.profit)}</div>
          </div>
          <div className="cell2">
            <div className="k">Margin</div>
            <div className={"v " + (s.profit >= 0 ? "pos" : "neg")}>{s.rev > 0 ? NUM.format(s.margin) + "%" : "—"}</div>
          </div>
        </div>
      </div>

      <div className={"modal-bg" + (showInvoiceModal ? " show" : "")}>
        <div className="modal">
          <h3>Upload invoice</h3>
          <p>Attach the invoice file corresponding to the material cost for &quot;{proj.name}&quot;.</p>
          <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={handleInvoiceFile} disabled={uploading} />
          {uploading && <p className="muted">Uploading…</p>}
          <div className="row">
            <button className="btn" onClick={() => setShowInvoiceModal(false)}>
              Close
            </button>
          </div>
        </div>
      </div>

      <div className={"modal-bg" + (showReuploadModal ? " show" : "")}>
        <div className="modal">
          <h3>Request scope drawing re-upload</h3>
          <p>
            Explain why &quot;{proj.name}&quot;&apos;s scope drawing needs to be replaced. An admin must approve
            before the upload unlocks.
          </p>
          <textarea
            rows={4}
            style={{ width: "100%" }}
            value={reuploadJustification}
            onChange={(e) => setReuploadJustification(e.target.value)}
            placeholder="e.g. Wrong revision uploaded, client sent an updated drawing on 12 Aug"
          />
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                setShowReuploadModal(false);
                setReuploadJustification("");
              }}
            >
              Cancel
            </button>
            <button className="btn primary" onClick={submitReuploadRequest} disabled={requestingReupload}>
              {requestingReupload ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
