// Auto-generated from Supabase. Regenerate after each migration:
//   mcp__claude_ai_Supabase__generate_typescript_types
//   or: pnpm dlx supabase gen types typescript --project-id ryvrpwraoccjofpsgclz > src/lib/db-types.ts
// Source of truth: backend/alembic/versions/

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alembic_version: {
        Row: { version_num: string }
        Insert: { version_num: string }
        Update: { version_num?: string }
        Relationships: []
      }
      artifact_tags: {
        Row: { artifact_id: string; created_at: string; tag_id: string }
        Insert: { artifact_id: string; created_at?: string; tag_id: string }
        Update: { artifact_id?: string; created_at?: string; tag_id?: string }
        Relationships: [
          { foreignKeyName: "artifact_tags_artifact_id_fkey"; columns: ["artifact_id"]; isOneToOne: false; referencedRelation: "artifacts"; referencedColumns: ["id"] },
          { foreignKeyName: "artifact_tags_tag_id_fkey"; columns: ["tag_id"]; isOneToOne: false; referencedRelation: "tags"; referencedColumns: ["id"] },
        ]
      }
      artifacts: {
        Row: { content: string | null; created_at: string; embeddings: string | null; id: string; project_id: string; storage_url: string | null; task_id: string | null; title: string; type: string }
        Insert: { content?: string | null; created_at?: string; embeddings?: string | null; id?: string; project_id: string; storage_url?: string | null; task_id?: string | null; title: string; type: string }
        Update: { content?: string | null; created_at?: string; embeddings?: string | null; id?: string; project_id?: string; storage_url?: string | null; task_id?: string | null; title?: string; type?: string }
        Relationships: [
          { foreignKeyName: "artifacts_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] },
          { foreignKeyName: "artifacts_task_id_fkey"; columns: ["task_id"]; isOneToOne: false; referencedRelation: "tasks"; referencedColumns: ["id"] },
        ]
      }
      coaching_sessions: {
        Row: { created_at: string; id: string; insights: Json; project_context_snapshot: Json; transcript: string | null; user_id: string }
        Insert: { created_at?: string; id?: string; insights?: Json; project_context_snapshot?: Json; transcript?: string | null; user_id: string }
        Update: { created_at?: string; id?: string; insights?: Json; project_context_snapshot?: Json; transcript?: string | null; user_id?: string }
        Relationships: [
          { foreignKeyName: "coaching_sessions_user_id_fkey"; columns: ["user_id"]; isOneToOne: false; referencedRelation: "users"; referencedColumns: ["id"] },
        ]
      }
      decisions: {
        Row: { alternatives_considered: string | null; decided_at: string; decided_by: string | null; decision: string; id: string; project_id: string; question: string; reasoning: string | null; review_at: string | null; source_manager_action_id: string | null }
        Insert: { alternatives_considered?: string | null; decided_at?: string; decided_by?: string | null; decision: string; id?: string; project_id: string; question: string; reasoning?: string | null; review_at?: string | null; source_manager_action_id?: string | null }
        Update: { alternatives_considered?: string | null; decided_at?: string; decided_by?: string | null; decision?: string; id?: string; project_id?: string; question?: string; reasoning?: string | null; review_at?: string | null; source_manager_action_id?: string | null }
        Relationships: [
          { foreignKeyName: "decisions_decided_by_fkey"; columns: ["decided_by"]; isOneToOne: false; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "decisions_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] },
          { foreignKeyName: "decisions_source_manager_action_id_fkey"; columns: ["source_manager_action_id"]; isOneToOne: false; referencedRelation: "manager_actions"; referencedColumns: ["id"] },
        ]
      }
      findings: {
        Row: { created_at: string; dismiss_reason: string | null; feedback_note: string | null; how_to_use: string; id: string; manager_action_id: string | null; project_id: string; resolved_at: string | null; source_artifact_id: string | null; source_task_id: string | null; status: string; target_owner_id: string | null; target_task_id: string }
        Insert: { created_at?: string; dismiss_reason?: string | null; feedback_note?: string | null; how_to_use: string; id?: string; manager_action_id?: string | null; project_id: string; resolved_at?: string | null; source_artifact_id?: string | null; source_task_id?: string | null; status?: string; target_owner_id?: string | null; target_task_id: string }
        Update: { created_at?: string; dismiss_reason?: string | null; feedback_note?: string | null; how_to_use?: string; id?: string; manager_action_id?: string | null; project_id?: string; resolved_at?: string | null; source_artifact_id?: string | null; source_task_id?: string | null; status?: string; target_owner_id?: string | null; target_task_id?: string }
        Relationships: [
          { foreignKeyName: "findings_manager_action_id_fkey"; columns: ["manager_action_id"]; isOneToOne: false; referencedRelation: "manager_actions"; referencedColumns: ["id"] },
          { foreignKeyName: "findings_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] },
          { foreignKeyName: "findings_source_artifact_id_fkey"; columns: ["source_artifact_id"]; isOneToOne: false; referencedRelation: "artifacts"; referencedColumns: ["id"] },
          { foreignKeyName: "findings_source_task_id_fkey"; columns: ["source_task_id"]; isOneToOne: false; referencedRelation: "tasks"; referencedColumns: ["id"] },
          { foreignKeyName: "findings_target_owner_id_fkey"; columns: ["target_owner_id"]; isOneToOne: false; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "findings_target_task_id_fkey"; columns: ["target_task_id"]; isOneToOne: false; referencedRelation: "tasks"; referencedColumns: ["id"] },
        ]
      }
      manager_actions: {
        Row: { accepted_by_human: boolean | null; action_type: string; created_at: string; human_feedback: string | null; id: string; input_context: Json; output: Json; project_id: string }
        Insert: { accepted_by_human?: boolean | null; action_type: string; created_at?: string; human_feedback?: string | null; id?: string; input_context?: Json; output?: Json; project_id: string }
        Update: { accepted_by_human?: boolean | null; action_type?: string; created_at?: string; human_feedback?: string | null; id?: string; input_context?: Json; output?: Json; project_id?: string }
        Relationships: [
          { foreignKeyName: "manager_actions_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] },
        ]
      }
      meeting_templates: {
        Row: { active: boolean; cadence: string; created_at: string; created_by: string | null; day_of_week: number | null; default_attendees: string[]; id: string; last_spawned_at: string | null; name: string; project_id: string; time_of_day: string; timezone: string; type: string }
        Insert: { active?: boolean; cadence: string; created_at?: string; created_by?: string | null; day_of_week?: number | null; default_attendees?: string[]; id?: string; last_spawned_at?: string | null; name: string; project_id: string; time_of_day?: string; timezone?: string; type: string }
        Update: { active?: boolean; cadence?: string; created_at?: string; created_by?: string | null; day_of_week?: number | null; default_attendees?: string[]; id?: string; last_spawned_at?: string | null; name?: string; project_id?: string; time_of_day?: string; timezone?: string; type?: string }
        Relationships: [
          { foreignKeyName: "meeting_templates_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "meeting_templates_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] },
        ]
      }
      meetings: {
        Row: { agenda: Json; ai_post_summary: string | null; ai_pre_brief: string | null; attendees: string[]; id: string; notes: string | null; project_id: string; scheduled_at: string | null; template_id: string | null; type: string }
        Insert: { agenda?: Json; ai_post_summary?: string | null; ai_pre_brief?: string | null; attendees?: string[]; id?: string; notes?: string | null; project_id: string; scheduled_at?: string | null; template_id?: string | null; type: string }
        Update: { agenda?: Json; ai_post_summary?: string | null; ai_pre_brief?: string | null; attendees?: string[]; id?: string; notes?: string | null; project_id?: string; scheduled_at?: string | null; template_id?: string | null; type?: string }
        Relationships: [
          { foreignKeyName: "meetings_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] },
          { foreignKeyName: "meetings_template_id_fkey"; columns: ["template_id"]; isOneToOne: false; referencedRelation: "meeting_templates"; referencedColumns: ["id"] },
        ]
      }
      messages: {
        Row: { channel: string; content: string; created_at: string; id: string; project_id: string; sender_id: string | null; sender_type: string; task_id: string | null }
        Insert: { channel?: string; content: string; created_at?: string; id?: string; project_id: string; sender_id?: string | null; sender_type: string; task_id?: string | null }
        Update: { channel?: string; content?: string; created_at?: string; id?: string; project_id?: string; sender_id?: string | null; sender_type?: string; task_id?: string | null }
        Relationships: [
          { foreignKeyName: "messages_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] },
          { foreignKeyName: "messages_task_id_fkey"; columns: ["task_id"]; isOneToOne: false; referencedRelation: "tasks"; referencedColumns: ["id"] },
        ]
      }
      open_questions: {
        Row: { blast_radius: Json; created_at: string; dismiss_reason: string | null; drafted_message_en: string | null; drafted_message_zh: string | null; embedding: string | null; feedback_note: string | null; id: string; manager_action_id: string | null; project_id: string; question: string; question_en: string | null; question_zh: string | null; resolution_artifact_id: string | null; resolution_decision_id: string | null; resolved_at: string | null; source_decision_id: string | null; source_task_id: string | null; status: string; target_owner_id: string | null }
        Insert: { blast_radius?: Json; created_at?: string; dismiss_reason?: string | null; drafted_message_en?: string | null; drafted_message_zh?: string | null; embedding?: string | null; feedback_note?: string | null; id?: string; manager_action_id?: string | null; project_id: string; question: string; question_en?: string | null; question_zh?: string | null; resolution_artifact_id?: string | null; resolution_decision_id?: string | null; resolved_at?: string | null; source_decision_id?: string | null; source_task_id?: string | null; status?: string; target_owner_id?: string | null }
        Update: { blast_radius?: Json; created_at?: string; dismiss_reason?: string | null; drafted_message_en?: string | null; drafted_message_zh?: string | null; embedding?: string | null; feedback_note?: string | null; id?: string; manager_action_id?: string | null; project_id?: string; question?: string; question_en?: string | null; question_zh?: string | null; resolution_artifact_id?: string | null; resolution_decision_id?: string | null; resolved_at?: string | null; source_decision_id?: string | null; source_task_id?: string | null; status?: string; target_owner_id?: string | null }
        Relationships: [
          { foreignKeyName: "open_questions_manager_action_id_fkey"; columns: ["manager_action_id"]; isOneToOne: false; referencedRelation: "manager_actions"; referencedColumns: ["id"] },
          { foreignKeyName: "open_questions_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] },
          { foreignKeyName: "open_questions_resolution_artifact_id_fkey"; columns: ["resolution_artifact_id"]; isOneToOne: false; referencedRelation: "artifacts"; referencedColumns: ["id"] },
          { foreignKeyName: "open_questions_resolution_decision_id_fkey"; columns: ["resolution_decision_id"]; isOneToOne: false; referencedRelation: "decisions"; referencedColumns: ["id"] },
          { foreignKeyName: "open_questions_source_decision_id_fkey"; columns: ["source_decision_id"]; isOneToOne: false; referencedRelation: "decisions"; referencedColumns: ["id"] },
          { foreignKeyName: "open_questions_source_task_id_fkey"; columns: ["source_task_id"]; isOneToOne: false; referencedRelation: "tasks"; referencedColumns: ["id"] },
          { foreignKeyName: "open_questions_target_owner_id_fkey"; columns: ["target_owner_id"]; isOneToOne: false; referencedRelation: "users"; referencedColumns: ["id"] },
        ]
      }
      projects: {
        Row: { created_at: string; current_stage: string; id: string; name: string; preferences: Json; vision: string | null; workspace_id: string }
        Insert: { created_at?: string; current_stage?: string; id?: string; name: string; preferences?: Json; vision?: string | null; workspace_id: string }
        Update: { created_at?: string; current_stage?: string; id?: string; name?: string; preferences?: Json; vision?: string | null; workspace_id?: string }
        Relationships: [
          { foreignKeyName: "projects_workspace_id_fkey"; columns: ["workspace_id"]; isOneToOne: false; referencedRelation: "workspaces"; referencedColumns: ["id"] },
        ]
      }
      saved_views: {
        Row: { created_at: string; created_by: string | null; filters: Json; id: string; name: string; project_id: string }
        Insert: { created_at?: string; created_by?: string | null; filters?: Json; id?: string; name: string; project_id: string }
        Update: { created_at?: string; created_by?: string | null; filters?: Json; id?: string; name?: string; project_id?: string }
        Relationships: [
          { foreignKeyName: "saved_views_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "saved_views_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] },
        ]
      }
      tags: {
        Row: { created_at: string; created_by: string | null; id: string; kind: string; name: string; project_id: string }
        Insert: { created_at?: string; created_by?: string | null; id?: string; kind?: string; name: string; project_id: string }
        Update: { created_at?: string; created_by?: string | null; id?: string; kind?: string; name?: string; project_id?: string }
        Relationships: [
          { foreignKeyName: "tags_created_by_fkey"; columns: ["created_by"]; isOneToOne: false; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "tags_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] },
        ]
      }
      task_dependencies: {
        Row: { dependent_task_id: string; prereq_task_id: string }
        Insert: { dependent_task_id: string; prereq_task_id: string }
        Update: { dependent_task_id?: string; prereq_task_id?: string }
        Relationships: [
          { foreignKeyName: "task_dependencies_dependent_task_id_fkey"; columns: ["dependent_task_id"]; isOneToOne: false; referencedRelation: "tasks"; referencedColumns: ["id"] },
          { foreignKeyName: "task_dependencies_prereq_task_id_fkey"; columns: ["prereq_task_id"]; isOneToOne: false; referencedRelation: "tasks"; referencedColumns: ["id"] },
        ]
      }
      tasks: {
        Row: { actual_hours: number | null; completed_at: string | null; created_at: string; created_by: string; description: string | null; estimated_hours: number | null; id: string; metadata: Json; owner_id: string | null; priority: number; project_id: string; status: string; title: string }
        Insert: { actual_hours?: number | null; completed_at?: string | null; created_at?: string; created_by?: string; description?: string | null; estimated_hours?: number | null; id?: string; metadata?: Json; owner_id?: string | null; priority?: number; project_id: string; status?: string; title: string }
        Update: { actual_hours?: number | null; completed_at?: string | null; created_at?: string; created_by?: string; description?: string | null; estimated_hours?: number | null; id?: string; metadata?: Json; owner_id?: string | null; priority?: number; project_id?: string; status?: string; title?: string }
        Relationships: [
          { foreignKeyName: "tasks_owner_id_fkey"; columns: ["owner_id"]; isOneToOne: false; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "tasks_project_id_fkey"; columns: ["project_id"]; isOneToOne: false; referencedRelation: "projects"; referencedColumns: ["id"] },
        ]
      }
      users: {
        Row: { email: string; id: string; name: string | null; role: string; skills: Json; timezone: string; work_style: Json; workspace_id: string | null }
        Insert: { email: string; id: string; name?: string | null; role?: string; skills?: Json; timezone?: string; work_style?: Json; workspace_id?: string | null }
        Update: { email?: string; id?: string; name?: string | null; role?: string; skills?: Json; timezone?: string; work_style?: Json; workspace_id?: string | null }
        Relationships: [
          { foreignKeyName: "users_workspace_id_fkey"; columns: ["workspace_id"]; isOneToOne: false; referencedRelation: "workspaces"; referencedColumns: ["id"] },
        ]
      }
      workspace_invites: {
        Row: { created_at: string; expires_at: string; id: string; invited_by: string | null; invited_email: string | null; role: string; token: string; used_at: string | null; used_by: string | null; workspace_id: string }
        Insert: { created_at?: string; expires_at?: string; id?: string; invited_by?: string | null; invited_email?: string | null; role?: string; token?: string; used_at?: string | null; used_by?: string | null; workspace_id: string }
        Update: { created_at?: string; expires_at?: string; id?: string; invited_by?: string | null; invited_email?: string | null; role?: string; token?: string; used_at?: string | null; used_by?: string | null; workspace_id?: string }
        Relationships: [
          { foreignKeyName: "workspace_invites_invited_by_fkey"; columns: ["invited_by"]; isOneToOne: false; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "workspace_invites_used_by_fkey"; columns: ["used_by"]; isOneToOne: false; referencedRelation: "users"; referencedColumns: ["id"] },
          { foreignKeyName: "workspace_invites_workspace_id_fkey"; columns: ["workspace_id"]; isOneToOne: false; referencedRelation: "workspaces"; referencedColumns: ["id"] },
        ]
      }
      workspaces: {
        Row: { created_at: string; id: string; llm_budget_daily_usd: number; name: string }
        Insert: { created_at?: string; id?: string; llm_budget_daily_usd?: number; name: string }
        Update: { created_at?: string; id?: string; llm_budget_daily_usd?: number; name?: string }
        Relationships: []
      }
    }
    Views: {
      activity_feed: {
        Row: { actor_id: string | null; detail: string | null; entity_id: string | null; event_at: string | null; event_type: string | null; label: string | null; project_id: string | null }
        Relationships: []
      }
    }
    Functions: {
      accept_workspace_invite: { Args: { invite_token: string }; Returns: string }
      bootstrap_workspace: { Args: { display_name?: string; workspace_name: string }; Returns: string }
      current_workspace_id: { Args: never; Returns: string }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends { Row: infer R } ? R : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends { Row: infer R } ? R : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends { Insert: infer I } ? I : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends { Insert: infer I } ? I : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends { Update: infer U } ? U : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends { Update: infer U } ? U : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: { Enums: {} },
} as const
