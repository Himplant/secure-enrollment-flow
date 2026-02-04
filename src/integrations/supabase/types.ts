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
      enrollment_events: {
        Row: {
          created_at: string | null
          enrollment_id: string
          event_data: Json | null
          event_type: string
          id: string
        }
        Insert: {
          created_at?: string | null
          enrollment_id: string
          event_data?: Json | null
          event_type: string
          id?: string
        }
        Update: {
          created_at?: string | null
          enrollment_id?: string
          event_data?: Json | null
          event_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_events_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_events_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments_public"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          amount_cents: number
          created_at: string | null
          currency: string | null
          expired_at: string | null
          expires_at: string
          failed_at: string | null
          id: string
          opened_at: string | null
          paid_at: string | null
          patient_email: string | null
          patient_name: string | null
          patient_phone: string | null
          payment_method_type:
            | Database["public"]["Enums"]["payment_method_type"]
            | null
          privacy_url: string
          processing_at: string | null
          status: Database["public"]["Enums"]["enrollment_status"]
          stripe_customer_id: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          terms_accept_ip: string | null
          terms_accept_user_agent: string | null
          terms_accepted_at: string | null
          terms_sha256: string
          terms_url: string
          terms_version: string
          token_hash: string
          token_last4: string
          updated_at: string | null
          zoho_module: string
          zoho_record_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string | null
          currency?: string | null
          expired_at?: string | null
          expires_at: string
          failed_at?: string | null
          id?: string
          opened_at?: string | null
          paid_at?: string | null
          patient_email?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          payment_method_type?:
            | Database["public"]["Enums"]["payment_method_type"]
            | null
          privacy_url: string
          processing_at?: string | null
          status?: Database["public"]["Enums"]["enrollment_status"]
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          terms_accept_ip?: string | null
          terms_accept_user_agent?: string | null
          terms_accepted_at?: string | null
          terms_sha256: string
          terms_url: string
          terms_version: string
          token_hash: string
          token_last4: string
          updated_at?: string | null
          zoho_module: string
          zoho_record_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string | null
          currency?: string | null
          expired_at?: string | null
          expires_at?: string
          failed_at?: string | null
          id?: string
          opened_at?: string | null
          paid_at?: string | null
          patient_email?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          payment_method_type?:
            | Database["public"]["Enums"]["payment_method_type"]
            | null
          privacy_url?: string
          processing_at?: string | null
          status?: Database["public"]["Enums"]["enrollment_status"]
          stripe_customer_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          terms_accept_ip?: string | null
          terms_accept_user_agent?: string | null
          terms_accepted_at?: string | null
          terms_sha256?: string
          terms_url?: string
          terms_version?: string
          token_hash?: string
          token_last4?: string
          updated_at?: string | null
          zoho_module?: string
          zoho_record_id?: string
        }
        Relationships: []
      }
      processed_stripe_events: {
        Row: {
          processed_at: string | null
          stripe_event_id: string
        }
        Insert: {
          processed_at?: string | null
          stripe_event_id: string
        }
        Update: {
          processed_at?: string | null
          stripe_event_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      enrollments_public: {
        Row: {
          amount_cents: number | null
          created_at: string | null
          currency: string | null
          expires_at: string | null
          id: string | null
          opened_at: string | null
          patient_first_name: string | null
          privacy_url: string | null
          status: Database["public"]["Enums"]["enrollment_status"] | null
          terms_sha256: string | null
          terms_url: string | null
          terms_version: string | null
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string | null
          opened_at?: string | null
          patient_first_name?: never
          privacy_url?: string | null
          status?: Database["public"]["Enums"]["enrollment_status"] | null
          terms_sha256?: string | null
          terms_url?: string | null
          terms_version?: string | null
        }
        Update: {
          amount_cents?: number | null
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string | null
          opened_at?: string | null
          patient_first_name?: never
          privacy_url?: string | null
          status?: Database["public"]["Enums"]["enrollment_status"] | null
          terms_sha256?: string | null
          terms_url?: string | null
          terms_version?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      enrollment_status:
        | "created"
        | "sent"
        | "opened"
        | "processing"
        | "paid"
        | "failed"
        | "expired"
        | "canceled"
      payment_method_type: "card" | "ach"
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
      enrollment_status: [
        "created",
        "sent",
        "opened",
        "processing",
        "paid",
        "failed",
        "expired",
        "canceled",
      ],
      payment_method_type: ["card", "ach"],
    },
  },
} as const
