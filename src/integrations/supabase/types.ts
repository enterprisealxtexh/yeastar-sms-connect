export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      activity_logs: {
        Row: {
          created_at: string
          event_type: string
          id: string
          message: string
          metadata: Json | null
          severity: Database["public"]["Enums"]["log_severity"]
          sim_port: number | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          message: string
          metadata?: Json | null
          severity?: Database["public"]["Enums"]["log_severity"]
          sim_port?: number | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          message?: string
          metadata?: Json | null
          severity?: Database["public"]["Enums"]["log_severity"]
          sim_port?: number | null
        }
        Relationships: []
      }
      agent_config: {
        Row: {
          ai_tuned: boolean | null
          config_key: string
          config_value: Json
          created_at: string
          id: string
          last_tuned_at: string | null
          updated_at: string
        }
        Insert: {
          ai_tuned?: boolean | null
          config_key: string
          config_value: Json
          created_at?: string
          id?: string
          last_tuned_at?: string | null
          updated_at?: string
        }
        Update: {
          ai_tuned?: boolean | null
          config_key?: string
          config_value?: Json
          created_at?: string
          id?: string
          last_tuned_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      agent_heartbeat: {
        Row: {
          agent_id: string
          created_at: string
          errors_count: number | null
          hostname: string | null
          id: string
          last_seen_at: string
          messages_synced: number | null
          metadata: Json | null
          status: string
          version: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          errors_count?: number | null
          hostname?: string | null
          id?: string
          last_seen_at?: string
          messages_synced?: number | null
          metadata?: Json | null
          status?: string
          version?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          errors_count?: number | null
          hostname?: string | null
          id?: string
          last_seen_at?: string
          messages_synced?: number | null
          metadata?: Json | null
          status?: string
          version?: string | null
        }
        Relationships: []
      }
      agent_updates: {
        Row: {
          created_at: string
          download_url: string | null
          id: string
          is_critical: boolean | null
          release_notes: string | null
          released_at: string
          version: string
        }
        Insert: {
          created_at?: string
          download_url?: string | null
          id?: string
          is_critical?: boolean | null
          release_notes?: string | null
          released_at?: string
          version: string
        }
        Update: {
          created_at?: string
          download_url?: string | null
          id?: string
          is_critical?: boolean | null
          release_notes?: string | null
          released_at?: string
          version?: string
        }
        Relationships: []
      }
      ai_recommendations: {
        Row: {
          applied_at: string | null
          auto_applied: boolean | null
          category: string
          created_at: string
          description: string
          details: Json | null
          id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          applied_at?: string | null
          auto_applied?: boolean | null
          category: string
          created_at?: string
          description: string
          details?: Json | null
          id?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          applied_at?: string | null
          auto_applied?: boolean | null
          category?: string
          created_at?: string
          description?: string
          details?: Json | null
          id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      call_queue: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          from_extension: string
          id: string
          metadata: Json | null
          picked_up_at: string | null
          priority: number
          requested_at: string
          requested_by: string | null
          result: string | null
          status: string
          to_number: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          from_extension: string
          id?: string
          metadata?: Json | null
          picked_up_at?: string | null
          priority?: number
          requested_at?: string
          requested_by?: string | null
          result?: string | null
          status?: string
          to_number: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          from_extension?: string
          id?: string
          metadata?: Json | null
          picked_up_at?: string | null
          priority?: number
          requested_at?: string
          requested_by?: string | null
          result?: string | null
          status?: string
          to_number?: string
          updated_at?: string
        }
        Relationships: []
      }
      call_records: {
        Row: {
          answer_time: string | null
          callee_name: string | null
          callee_number: string
          caller_name: string | null
          caller_number: string
          created_at: string
          direction: Database["public"]["Enums"]["call_direction"]
          end_time: string | null
          extension: string | null
          external_id: string | null
          hold_duration: number | null
          id: string
          metadata: Json | null
          notes: string | null
          recording_url: string | null
          ring_duration: number | null
          sim_port: number | null
          start_time: string
          status: Database["public"]["Enums"]["call_status"]
          talk_duration: number | null
          total_duration: number | null
          transfer_to: string | null
          updated_at: string
        }
        Insert: {
          answer_time?: string | null
          callee_name?: string | null
          callee_number: string
          caller_name?: string | null
          caller_number: string
          created_at?: string
          direction?: Database["public"]["Enums"]["call_direction"]
          end_time?: string | null
          extension?: string | null
          external_id?: string | null
          hold_duration?: number | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          recording_url?: string | null
          ring_duration?: number | null
          sim_port?: number | null
          start_time?: string
          status?: Database["public"]["Enums"]["call_status"]
          talk_duration?: number | null
          total_duration?: number | null
          transfer_to?: string | null
          updated_at?: string
        }
        Update: {
          answer_time?: string | null
          callee_name?: string | null
          callee_number?: string
          caller_name?: string | null
          caller_number?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["call_direction"]
          end_time?: string | null
          extension?: string | null
          external_id?: string | null
          hold_duration?: number | null
          id?: string
          metadata?: Json | null
          notes?: string | null
          recording_url?: string | null
          ring_duration?: number | null
          sim_port?: number | null
          start_time?: string
          status?: Database["public"]["Enums"]["call_status"]
          talk_duration?: number | null
          total_duration?: number | null
          transfer_to?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          call_count: number
          created_at: string
          first_seen_at: string
          id: string
          last_seen_at: string
          name: string | null
          notes: string | null
          phone_number: string
          sms_count: number
          source: string
          updated_at: string
        }
        Insert: {
          call_count?: number
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          name?: string | null
          notes?: string | null
          phone_number: string
          sms_count?: number
          source?: string
          updated_at?: string
        }
        Update: {
          call_count?: number
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          name?: string | null
          notes?: string | null
          phone_number?: string
          sms_count?: number
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      error_logs: {
        Row: {
          agent_id: string | null
          ai_diagnosis: string | null
          ai_suggested_fix: string | null
          auto_fix_attempted: boolean | null
          auto_fix_result: string | null
          created_at: string
          error_context: Json | null
          error_message: string
          error_type: string
          id: string
          resolved: boolean | null
        }
        Insert: {
          agent_id?: string | null
          ai_diagnosis?: string | null
          ai_suggested_fix?: string | null
          auto_fix_attempted?: boolean | null
          auto_fix_result?: string | null
          created_at?: string
          error_context?: Json | null
          error_message: string
          error_type: string
          id?: string
          resolved?: boolean | null
        }
        Update: {
          agent_id?: string | null
          ai_diagnosis?: string | null
          ai_suggested_fix?: string | null
          auto_fix_attempted?: boolean | null
          auto_fix_result?: string | null
          created_at?: string
          error_context?: Json | null
          error_message?: string
          error_type?: string
          id?: string
          resolved?: boolean | null
        }
        Relationships: []
      }
      gateway_config: {
        Row: {
          api_password: string
          api_username: string
          created_at: string
          gateway_ip: string
          id: string
          updated_at: string
        }
        Insert: {
          api_password?: string
          api_username?: string
          created_at?: string
          gateway_ip?: string
          id?: string
          updated_at?: string
        }
        Update: {
          api_password?: string
          api_username?: string
          created_at?: string
          gateway_ip?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      pbx_config: {
        Row: {
          api_password: string
          api_username: string
          created_at: string
          id: string
          pbx_ip: string
          pbx_port: number
          updated_at: string
          web_port: number
        }
        Insert: {
          api_password?: string
          api_username?: string
          created_at?: string
          id?: string
          pbx_ip?: string
          pbx_port?: number
          updated_at?: string
          web_port?: number
        }
        Update: {
          api_password?: string
          api_username?: string
          created_at?: string
          id?: string
          pbx_ip?: string
          pbx_port?: number
          updated_at?: string
          web_port?: number
        }
        Relationships: []
      }
      sim_port_config: {
        Row: {
          carrier: string | null
          created_at: string
          enabled: boolean
          extension: string | null
          id: string
          label: string | null
          last_seen_at: string | null
          phone_number: string | null
          port_number: number
          signal_strength: number | null
          updated_at: string
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          enabled?: boolean
          extension?: string | null
          id?: string
          label?: string | null
          last_seen_at?: string | null
          phone_number?: string | null
          port_number: number
          signal_strength?: number | null
          updated_at?: string
        }
        Update: {
          carrier?: string | null
          created_at?: string
          enabled?: boolean
          extension?: string | null
          id?: string
          label?: string | null
          last_seen_at?: string | null
          phone_number?: string | null
          port_number?: number
          signal_strength?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      sms_category_feedback: {
        Row: {
          corrected_by: string | null
          corrected_category: string
          created_at: string
          id: string
          original_category: string
          sms_id: string
        }
        Insert: {
          corrected_by?: string | null
          corrected_category: string
          created_at?: string
          id?: string
          original_category: string
          sms_id: string
        }
        Update: {
          corrected_by?: string | null
          corrected_category?: string
          created_at?: string
          id?: string
          original_category?: string
          sms_id?: string
        }
        Relationships: []
      }
      sms_messages: {
        Row: {
          category: Database["public"]["Enums"]["sms_category"] | null
          category_confidence: number | null
          created_at: string
          external_id: string | null
          id: string
          message_content: string
          received_at: string
          sender_number: string
          sim_port: number
          status: Database["public"]["Enums"]["sms_status"]
          updated_at: string
        }
        Insert: {
          category?: Database["public"]["Enums"]["sms_category"] | null
          category_confidence?: number | null
          created_at?: string
          external_id?: string | null
          id?: string
          message_content: string
          received_at?: string
          sender_number: string
          sim_port: number
          status?: Database["public"]["Enums"]["sms_status"]
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["sms_category"] | null
          category_confidence?: number | null
          created_at?: string
          external_id?: string | null
          id?: string
          message_content?: string
          received_at?: string
          sender_number?: string
          sim_port?: number
          status?: Database["public"]["Enums"]["sms_status"]
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_authorized: { Args: { _user_id: string }; Returns: boolean }
      merge_duplicate_contacts: { Args: never; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "operator" | "viewer"
      call_direction: "inbound" | "outbound" | "internal"
      call_status: "answered" | "missed" | "busy" | "failed" | "voicemail"
      log_severity: "info" | "warning" | "error" | "success"
      sms_category:
        | "otp"
        | "marketing"
        | "personal"
        | "transactional"
        | "notification"
        | "spam"
        | "unknown"
      sms_status: "unread" | "read" | "processed" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "operator", "viewer"],
      call_direction: ["inbound", "outbound", "internal"],
      call_status: ["answered", "missed", "busy", "failed", "voicemail"],
      log_severity: ["info", "warning", "error", "success"],
      sms_category: [
        "otp",
        "marketing",
        "personal",
        "transactional",
        "notification",
        "spam",
        "unknown",
      ],
      sms_status: ["unread", "read", "processed", "failed"],
    },
  },
} as const
