import Link from "next/link";

import { supabaseServer } from "@/lib/supabase-server";

import { ClaimInviteForm } from "./claim-form";

export default async function InviteLandingPage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: invite } = await supabase
    .from("workspace_invites")
    .select("id, workspace_id, role, expires_at, used_at, invited_email")
    .eq("token", decodeURIComponent(params.token))
    .maybeSingle();

  if (!invite) {
    return (
      <Centered>
        <h1 className="mb-2 text-xl font-semibold">Invite not found</h1>
        <p className="text-sm text-neutral-500">
          The link may have been mistyped or revoked. Ask whoever sent it to generate a new one.
        </p>
      </Centered>
    );
  }

  if (invite.used_at) {
    return (
      <Centered>
        <h1 className="mb-2 text-xl font-semibold">Invite already used</h1>
        <p className="text-sm text-neutral-500">This link has already been claimed.</p>
        <Link href="/login" className="mt-4 inline-block text-sm text-emerald-700 hover:underline">
          Go to sign in →
        </Link>
      </Centered>
    );
  }

  if (new Date(invite.expires_at) < new Date()) {
    return (
      <Centered>
        <h1 className="mb-2 text-xl font-semibold">Invite expired</h1>
        <p className="text-sm text-neutral-500">
          This invite link is older than 14 days. Ask the workspace founder for a fresh one.
        </p>
      </Centered>
    );
  }

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("name")
    .eq("id", invite.workspace_id)
    .maybeSingle();

  if (!user) {
    // Not signed in — bounce to login with a `next` back to here.
    const next = `/invite/${encodeURIComponent(params.token)}`;
    return (
      <Centered>
        <h1 className="mb-2 text-xl font-semibold">
          Join workspace {workspace?.name ?? ""}? · 加入工作区？
        </h1>
        <p className="mb-4 text-sm text-neutral-500">
          Sign in or create an account first, then come back here to confirm joining.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="inline-block rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Sign in / create account →
        </Link>
      </Centered>
    );
  }

  return (
    <Centered>
      <p className="mb-1 text-xs uppercase tracking-wider text-neutral-500">Invitation</p>
      <h1 className="mb-2 text-xl font-semibold">
        Join workspace <span className="text-emerald-700">{workspace?.name ?? "—"}</span>
      </h1>
      <p className="mb-6 text-sm text-neutral-500">
        Signed in as <strong>{user.email}</strong>. Click below to accept and join.
      </p>
      <ClaimInviteForm token={decodeURIComponent(params.token)} />
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        {children}
      </div>
    </main>
  );
}
