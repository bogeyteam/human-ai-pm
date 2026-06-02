import { supabaseServer } from "@/lib/supabase-server";

import { DecisionsPanel } from "./decisions-panel";

export default async function DecisionsPage({ params }: { params: { id: string } }) {
  const supabase = supabaseServer();
  const { data: decisions } = await supabase
    .from("decisions")
    .select(
      "id, question, decision, reasoning, alternatives_considered, decided_at, review_at, users:decided_by(name, email)",
    )
    .eq("project_id", params.id)
    .order("decided_at", { ascending: false });

  return <DecisionsPanel projectId={params.id} initialDecisions={decisions ?? []} />;
}
