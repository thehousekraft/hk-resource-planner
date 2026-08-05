"use client";

import { useEffect, useState } from "react";
import type { Role } from "@/lib/roleTypes";
import { COMPANY_DOMAIN } from "@/lib/roleTypes";
import {
  inviteUser,
  listPendingInvitations,
  listUsers,
  revokeInvitation,
  updateUserRole,
  type PendingInviteRow,
  type UserRow,
} from "@/app/userActions";

const ROLES: Role[] = ["admin", "editor", "viewer"];

export default function Users({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [invites, setInvites] = useState<PendingInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [sending, setSending] = useState(false);

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

  useEffect(() => {
    refresh();
  }, []);

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

  return (
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
  );
}
