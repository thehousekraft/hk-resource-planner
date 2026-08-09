"use client";

import { useEffect, useState } from "react";
import type { Role } from "@/lib/roleTypes";
import { COMPANY_DOMAIN } from "@/lib/roleTypes";
import { CONFIGURABLE_TABS, type ConfigurableRole, type TabKey } from "@/lib/tabs";
import type { ParentProject, Project } from "@/lib/types";
import {
  approveReuploadRequest,
  getRolePermissionsMatrix,
  inviteUser,
  listPendingInvitations,
  listPendingReuploadRequests,
  listUsers,
  rejectReuploadRequest,
  revokeInvitation,
  updateRolePermissions,
  updateUserRole,
  type PendingInviteRow,
  type ReuploadRequestRow,
  type UserRow,
} from "@/app/userActions";

const ROLES: Role[] = ["admin", "editor", "viewer"];
const CONFIGURABLE_ROLES: ConfigurableRole[] = ["editor", "viewer"];

export default function Users({
  currentUserId,
  parentProjects,
  projects,
  onDeleteProject,
  onDeleteParentProject,
  onReassignProjectParent,
}: {
  currentUserId: string;
  parentProjects: ParentProject[];
  projects: Project[];
  onDeleteProject: (id: string) => void;
  onDeleteParentProject: (id: string) => void;
  onReassignProjectParent: (id: string, parentProjectId: string) => void;
}) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invites, setInvites] = useState<PendingInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [sending, setSending] = useState(false);

  const [permissions, setPermissions] = useState<Record<ConfigurableRole, TabKey[]>>({ editor: [], viewer: [] });
  const [permsLoading, setPermsLoading] = useState(true);
  const [savingPerms, setSavingPerms] = useState(false);

  const [deleteProjId, setDeleteProjId] = useState(projects[0]?.id || "");
  const [deleteParentId, setDeleteParentId] = useState(parentProjects[0]?.id || "");
  const [reassignSubId, setReassignSubId] = useState(projects[0]?.id || "");
  const [reassignParentId, setReassignParentId] = useState(parentProjects[0]?.id || "");

  const [reuploadRequests, setReuploadRequests] = useState<ReuploadRequestRow[]>([]);
  const [reqLoading, setReqLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const [u, i] = await Promise.all([listUsers(), listPendingInvitations()]);
      setUsers(u);
      setInvites(i);
    } catch (e) {
      alert("Could not load users: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }

  async function refreshPermissions() {
    setPermsLoading(true);
    try {
      setPermissions(await getRolePermissionsMatrix());
    } catch (e) {
      alert("Could not load role permissions: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPermsLoading(false);
    }
  }

  async function refreshReuploadRequests() {
    setReqLoading(true);
    try {
      setReuploadRequests(await listPendingReuploadRequests());
    } catch (e) {
      alert("Could not load re-upload requests: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setReqLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    refreshPermissions();
    refreshReuploadRequests();
  }, []);

  async function handleReviewReupload(id: string, approve: boolean) {
    setReviewingId(id);
    try {
      if (approve) await approveReuploadRequest(id);
      else await rejectReuploadRequest(id);
      setReuploadRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      alert("Could not update request: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setReviewingId(null);
    }
  }

  async function handleInvite() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      alert("Enter an email address.");
      return;
    }
    if (!trimmed.endsWith(COMPANY_DOMAIN)) {
      alert(`Only ${COMPANY_DOMAIN} email addresses can be invited.`);
      return;
    }
    setSending(true);
    try {
      await inviteUser(trimmed, role);
      setEmail("");
      setRole("viewer");
      await refresh();
    } catch (e) {
      alert("Could not send invite: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSending(false);
    }
  }

  async function handleRoleChange(clerkUserId: string, newRole: Role) {
    try {
      await updateUserRole(clerkUserId, newRole);
      setUsers((prev) => prev.map((u) => (u.clerkUserId === clerkUserId ? { ...u, role: newRole } : u)));
    } catch (e) {
      alert("Could not update role: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this invitation?")) return;
    try {
      await revokeInvitation(id);
      setInvites((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      alert("Could not revoke: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  function handleDeleteProject() {
    if (!deleteProjId) return;
    onDeleteProject(deleteProjId);
  }

  function handleReassignParent() {
    if (!reassignSubId || !reassignParentId) return;
    onReassignProjectParent(reassignSubId, reassignParentId);
  }

  function handleDeleteParentProject() {
    if (!deleteParentId) return;
    if (!confirm("Delete this project and all its sub-projects? This cannot be undone.")) return;
    onDeleteParentProject(deleteParentId);
  }

  function toggleTab(r: ConfigurableRole, tab: TabKey) {
    setPermissions((prev) => {
      const has = prev[r].includes(tab);
      return { ...prev, [r]: has ? prev[r].filter((t) => t !== tab) : [...prev[r], tab] };
    });
  }

  async function handleSavePermissions() {
    setSavingPerms(true);
    try {
      await Promise.all(CONFIGURABLE_ROLES.map((r) => updateRolePermissions(r, permissions[r])));
    } catch (e) {
      alert("Could not save permissions: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSavingPerms(false);
    }
  }

  return (
    <>
      <div className="card">
        <h2>Manage users</h2>
        <div className="sub">
          Only {COMPANY_DOMAIN} email addresses can be invited. There is no public sign-up — access is invite-only.
        </div>

        <div className="addrow" style={{ gridTemplateColumns: "1.6fr 1fr auto", marginTop: 4 }}>
          <div className="fld">
            <label>Email</label>
            <input
              type="email"
              placeholder={`name${COMPANY_DOMAIN}`}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="fld">
            <label>Role</label>
            <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <button className="btn primary" onClick={handleInvite} disabled={sending}>
            {sending ? "Sending…" : "Send invite"}
          </button>
        </div>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            <h3 style={{ marginTop: 24, fontSize: 13.5 }}>Active users</h3>
            {!users.length ? (
              <div className="empty">No users yet.</div>
            ) : (
              <table className="rtable">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th className="narrow">Role</th>
                    <th className="narrow">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.clerkUserId}>
                      <td>{u.name || "—"}</td>
                      <td>{u.email}</td>
                      <td className="narrow">
                        {u.clerkUserId === currentUserId ? (
                          <span className="badge b-day" style={{ textTransform: "capitalize" }}>
                            {u.role} (you)
                          </span>
                        ) : (
                          <select value={u.role} onChange={(e) => handleRoleChange(u.clerkUserId, e.target.value as Role)}>
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="narrow muted" style={{ fontSize: 12 }}>
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h3 style={{ marginTop: 24, fontSize: 13.5 }}>Pending invitations</h3>
            {!invites.length ? (
              <div className="empty">No pending invitations.</div>
            ) : (
              <table className="rtable">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th className="narrow">Role</th>
                    <th className="narrow">Invited</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {invites.map((i) => (
                    <tr key={i.id}>
                      <td>{i.email}</td>
                      <td className="narrow" style={{ textTransform: "capitalize" }}>
                        {i.role}
                      </td>
                      <td className="narrow muted" style={{ fontSize: 12 }}>
                        {new Date(i.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <button className="del-x" onClick={() => handleRevoke(i.id)}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      <div className="card">
        <h2>Role permissions</h2>
        <div className="sub">
          Choose which pages each role can see. Admin always has full access to every page, including this one, and
          isn&apos;t editable here.
        </div>
        {permsLoading ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="rtable">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th className="narrow" style={{ textAlign: "center" }}>
                      Admin
                    </th>
                    <th className="narrow" style={{ textAlign: "center" }}>
                      Editor
                    </th>
                    <th className="narrow" style={{ textAlign: "center" }}>
                      Viewer
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {CONFIGURABLE_TABS.map((t) => (
                    <tr key={t.key}>
                      <td>{t.label}</td>
                      <td style={{ textAlign: "center" }}>
                        <input type="checkbox" checked disabled />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={permissions.editor.includes(t.key)}
                          onChange={() => toggleTab("editor", t.key)}
                        />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="checkbox"
                          checked={permissions.viewer.includes(t.key)}
                          onChange={() => toggleTab("viewer", t.key)}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td>Manage users</td>
                    <td style={{ textAlign: "center" }}>
                      <input type="checkbox" checked disabled />
                    </td>
                    <td style={{ textAlign: "center" }} className="muted">
                      admin only
                    </td>
                    <td style={{ textAlign: "center" }} className="muted">
                      admin only
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button className="btn primary sm" style={{ marginTop: 14 }} onClick={handleSavePermissions} disabled={savingPerms}>
              {savingPerms ? "Saving…" : "Save changes"}
            </button>

            <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
              <h3 style={{ fontSize: 13.5, marginBottom: 4 }}>Assign a sub-project to a project</h3>
              <div className="sub">
                Older sub-projects created before projects existed aren&apos;t grouped under one yet. Create the
                project on the Calendar planner tab first, then group each sub-project here.
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <select value={reassignSubId} onChange={(e) => setReassignSubId(e.target.value)}>
                  {projects.map((p) => {
                    const parentName = parentProjects.find((pp) => pp.id === p.parentProjectId)?.name;
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name} {parentName ? `(currently: ${parentName})` : "(ungrouped)"}
                      </option>
                    );
                  })}
                </select>
                <span className="muted">→</span>
                <select value={reassignParentId} onChange={(e) => setReassignParentId(e.target.value)}>
                  {parentProjects.map((pp) => (
                    <option key={pp.id} value={pp.id}>
                      {pp.name}
                    </option>
                  ))}
                </select>
                <button className="btn primary sm" onClick={handleReassignParent} disabled={!reassignSubId || !reassignParentId}>
                  Assign
                </button>
              </div>
            </div>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
              <h3 style={{ fontSize: 13.5, marginBottom: 4 }}>Delete a sub-project</h3>
              <div className="sub">Admin only. This permanently removes the sub-project and frees its bookings.</div>
              <div className="row" style={{ marginTop: 8 }}>
                <select value={deleteProjId} onChange={(e) => setDeleteProjId(e.target.value)}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button className="btn warn sm" onClick={handleDeleteProject} disabled={!deleteProjId}>
                  Delete sub-project
                </button>
              </div>
            </div>

            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
              <h3 style={{ fontSize: 13.5, marginBottom: 4 }}>Delete a project</h3>
              <div className="sub">Admin only. This permanently removes the project and every sub-project under it.</div>
              <div className="row" style={{ marginTop: 8 }}>
                <select value={deleteParentId} onChange={(e) => setDeleteParentId(e.target.value)}>
                  {parentProjects.map((pp) => (
                    <option key={pp.id} value={pp.id}>
                      {pp.name}
                    </option>
                  ))}
                </select>
                <button className="btn warn sm" onClick={handleDeleteParentProject} disabled={!deleteParentId}>
                  Delete project
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <h2>Scope drawing re-upload requests</h2>
        <div className="sub">
          Non-admins get one scope-drawing upload per project. Approve a request here to unlock exactly one more
          upload for that project.
        </div>
        {reqLoading ? (
          <div className="empty">Loading…</div>
        ) : !reuploadRequests.length ? (
          <div className="empty">No pending requests.</div>
        ) : (
          <table className="rtable">
            <thead>
              <tr>
                <th>Project</th>
                <th>Requested by</th>
                <th>Justification</th>
                <th className="narrow">Requested</th>
                <th style={{ width: 140 }} />
              </tr>
            </thead>
            <tbody>
              {reuploadRequests.map((r) => (
                <tr key={r.id}>
                  <td>{r.projectName}</td>
                  <td>{r.requestedByEmail}</td>
                  <td style={{ fontSize: 12.5 }}>{r.justification}</td>
                  <td className="narrow muted" style={{ fontSize: 12 }}>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button
                        className="btn primary sm"
                        onClick={() => handleReviewReupload(r.id, true)}
                        disabled={reviewingId === r.id}
                      >
                        Approve
                      </button>
                      <button className="btn sm" onClick={() => handleReviewReupload(r.id, false)} disabled={reviewingId === r.id}>
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
