import { redirect } from "next/navigation";

import { supabaseServer } from "@/lib/supabase-server";

export default async function RootPage() {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  redirect("/projects");
}
