"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

export function ClaimInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onAccept() {
    setSubmitting(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { error } = await supabase.rpc("accept_workspace_invite", {
        invite_token: token,
      });
      if (error) throw error;
      router.replace("/projects");
      router.refresh();
    } catch (err) {
      console.error("Invite accept failed:", err);
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}
      <button
        onClick={onAccept}
        disabled={submitting}
        className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {submitting ? "Joining…" : "Join workspace"}
      </button>
      <p className="text-xs text-neutral-500">
        You can only be in one workspace at a time. If you already belong to a different workspace, this will fail.
      </p>
    </div>
  );
}
