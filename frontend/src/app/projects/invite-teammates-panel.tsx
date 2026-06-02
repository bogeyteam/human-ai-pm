"use client";

import { useEffect, useState } from "react";

import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Invite = {
  id: string;
  token: string;
  invited_email: string | null;
  role: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  created_at: string;
};

export function InviteTeammatesPanel({ workspaceId }: { workspaceId: string }) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = supabaseBrowser();
      const { data, error } = await supabase
        .from("workspace_invites")
        .select("id, token, invited_email, role, expires_at, used_at, used_by, created_at")
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setInvites([]);
      } else {
        setInvites((data ?? []) as Invite[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onCreate() {
    setCreating(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("workspace_invites")
        .insert({
          workspace_id: workspaceId,
          invited_by: user?.id,
          invited_email: email.trim() || null,
          role: "member",
        })
        .select("id, token, invited_email, role, expires_at, used_at, used_by, created_at")
        .single();
      if (error) throw error;
      setInvites((prev) => [data as Invite, ...(prev ?? [])]);
      setEmail("");
    } catch (err) {
      setError(extractError(err));
    } finally {
      setCreating(false);
    }
  }

  function copyLink(inv: Invite) {
    const url = `${window.location.origin}/invite/${encodeURIComponent(inv.token)}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopiedId(inv.id);
        setTimeout(() => setCopiedId((cur) => (cur === inv.id ? null : cur)), 2000);
      })
      .catch(() => setError("Couldn't access clipboard"));
  }

  function status(inv: Invite): string {
    if (inv.used_at) return "used";
    if (new Date(inv.expires_at) < new Date()) return "expired";
    return "open";
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          type="email"
          placeholder="Teammate email (optional, just for tracking)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
        />
        <button
          onClick={onCreate}
          disabled={creating}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          {creating ? "Generating…" : "Generate invite link"}
        </button>
      </div>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <p className="mb-3 text-xs text-neutral-500">
        Send the generated link to a teammate. They sign up (or sign in) and click <strong>Join</strong> to be added to this workspace. Links expire in 14 days.
      </p>

      {invites === null ? (
        <p className="text-xs text-neutral-400">Loading…</p>
      ) : invites.length === 0 ? (
        <p className="text-xs text-neutral-500">No invites yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {invites.map((inv) => {
            const s = status(inv);
            return (
              <li key={inv.id} className="flex items-center justify-between py-2 text-sm">
                <div className="flex-1">
                  <p className="font-medium">
                    {inv.invited_email || "(no email)"}{" "}
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                        s === "open"
                          ? "bg-emerald-50 text-emerald-700"
                          : s === "used"
                            ? "bg-neutral-100 text-neutral-600"
                            : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {s}
                    </span>
                  </p>
                  <p className="text-xs text-neutral-500">
                    Created {new Date(inv.created_at).toLocaleDateString()} · expires{" "}
                    {new Date(inv.expires_at).toLocaleDateString()}
                  </p>
                </div>
                {s === "open" && (
                  <button
                    onClick={() => copyLink(inv)}
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-50"
                  >
                    {copiedId === inv.id ? "Copied ✓" : "Copy link"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

