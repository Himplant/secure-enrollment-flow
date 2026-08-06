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
      admin_audit_log: {
        Row: {
          action: string
          admin_email: string | null
          admin_user_id: string | null
          created_at: string
          id: string
          resource_id: string | null
          resource_summary: Json | null
          resource_type: string
        }
        Insert: {
          action: string
          admin_email?: string | null
          admin_user_id?: string | null
          created_at?: string
          id?: string
          resource_id?: string | null
          resource_summary?: Json | null
          resource_type: string
        }
        Update: {
          action?: string
          admin_email?: string | null
          admin_user_id?: string | null
          created_at?: string
          id?: string
          resource_id?: string | null
          resource_summary?: Json | null
          resource_type?: string
        }
        Relationships: []
      }
      admin_users: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          id: string
          invited_at: string
          invited_by: string | null
          mfa_method: string | null
          role: Database["public"]["Enums"]["admin_role"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          mfa_method?: string | null
          role?: Database["public"]["Enums"]["admin_role"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          mfa_method?: string | null
          role?: Database["public"]["Enums"]["admin_role"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      app_feature_flags: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          key: string
          scope: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          key: string
          scope?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          key?: string
          scope?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      clinic_distributors: {
        Row: {
          clinic_id: string
          created_at: string
          distributor_id: string
          id: string
          is_primary: boolean
        }
        Insert: {
          clinic_id: string
          created_at?: string
          distributor_id: string
          id?: string
          is_primary?: boolean
        }
        Update: {
          clinic_id?: string
          created_at?: string
          distributor_id?: string
          id?: string
          is_primary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "clinic_distributors_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_distributors_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
        ]
      }
      clinic_surgeons: {
        Row: {
          clinic_id: string
          consultation_fee_minor: number
          created_at: string
          currency: string
          id: string
          is_active: boolean
          surgeon_id: string
          updated_at: string
        }
        Insert: {
          clinic_id: string
          consultation_fee_minor?: number
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          surgeon_id: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          consultation_fee_minor?: number
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          surgeon_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clinic_surgeons_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clinic_surgeons_surgeon_id_fkey"
            columns: ["surgeon_id"]
            isOneToOne: false
            referencedRelation: "surgeons"
            referencedColumns: ["id"]
          },
        ]
      }
      clinics: {
        Row: {
          active_provider:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          address: string | null
          city: string | null
          contact_email: string | null
          contact_phone: string | null
          country: Database["public"]["Enums"]["intl_country"]
          created_at: string
          default_currency: string
          id: string
          is_active: boolean
          name: string
          region_id: string | null
          timezone: string
          updated_at: string
          zoho_id: string | null
        }
        Insert: {
          active_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          default_currency?: string
          id?: string
          is_active?: boolean
          name: string
          region_id?: string | null
          timezone?: string
          updated_at?: string
          zoho_id?: string | null
        }
        Update: {
          active_provider?:
            | Database["public"]["Enums"]["payment_provider"]
            | null
          address?: string | null
          city?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          country?: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          default_currency?: string
          id?: string
          is_active?: boolean
          name?: string
          region_id?: string | null
          timezone?: string
          updated_at?: string
          zoho_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clinics_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      consultation_events: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          actor_type: string
          consultation_id: string
          created_at: string
          event_data: Json | null
          event_type: string
          id: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          actor_type?: string
          consultation_id: string
          created_at?: string
          event_data?: Json | null
          event_type: string
          id?: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          actor_type?: string
          consultation_id?: string
          created_at?: string
          event_data?: Json | null
          event_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultation_events_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
        ]
      }
      consultation_patients: {
        Row: {
          country: Database["public"]["Enums"]["intl_country"]
          created_at: string
          created_by_admin_id: string | null
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          preferred_language: string
          updated_at: string
          zoho_record_id: string | null
        }
        Insert: {
          country: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          created_by_admin_id?: string | null
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          preferred_language?: string
          updated_at?: string
          zoho_record_id?: string | null
        }
        Update: {
          country?: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          created_by_admin_id?: string | null
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          preferred_language?: string
          updated_at?: string
          zoho_record_id?: string | null
        }
        Relationships: []
      }
      consultation_tasks: {
        Row: {
          clinic_id: string
          completed_at: string | null
          completed_by: string | null
          consultation_id: string
          created_at: string
          due_at: string | null
          id: string
          task_type: string
          updated_at: string
        }
        Insert: {
          clinic_id: string
          completed_at?: string | null
          completed_by?: string | null
          consultation_id: string
          created_at?: string
          due_at?: string | null
          id?: string
          task_type: string
          updated_at?: string
        }
        Update: {
          clinic_id?: string
          completed_at?: string | null
          completed_by?: string | null
          consultation_id?: string
          created_at?: string
          due_at?: string | null
          id?: string
          task_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultation_tasks_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultation_tasks_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
        ]
      }
      consultations: {
        Row: {
          agent_email: string | null
          agent_zoho_id: string | null
          amount_minor: number
          clinic_id: string
          closed_at: string | null
          consultation_status: Database["public"]["Enums"]["intl_consultation_status"]
          consulted_at: string | null
          country: Database["public"]["Enums"]["intl_country"]
          created_at: string
          created_by_admin_user_id: string | null
          currency: string
          disputed_at: string | null
          distributor_id: string | null
          expired_at: string | null
          expires_at: string
          failed_at: string | null
          first_contact_at: string | null
          id: string
          no_show_at: string | null
          notes: string | null
          opened_at: string | null
          outcome_notes: string | null
          paid_at: string | null
          patient_id: string
          payment_status: Database["public"]["Enums"]["intl_payment_status"]
          policy_id: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_account_id: string | null
          provider_checkout_url: string | null
          provider_order_id: string | null
          provider_payment_id: string | null
          recipient_external_merchant_id: string | null
          refunded_at: string | null
          region_id: string | null
          rescheduled_count: number
          scheduled_at: string | null
          sent_at: string | null
          signature_data: string | null
          surgeon_id: string | null
          surgery_completed_at: string | null
          surgery_recommended_at: string | null
          surgery_scheduled_at: string | null
          surgery_status: Database["public"]["Enums"]["intl_surgery_status"]
          terms_accept_ip: string | null
          terms_accept_user_agent: string | null
          terms_accepted_at: string | null
          terms_sha256: string | null
          terms_version: string | null
          token_hash: string
          token_last4: string
          updated_at: string
          zoho_module: string | null
          zoho_record_id: string | null
        }
        Insert: {
          agent_email?: string | null
          agent_zoho_id?: string | null
          amount_minor: number
          clinic_id: string
          closed_at?: string | null
          consultation_status?: Database["public"]["Enums"]["intl_consultation_status"]
          consulted_at?: string | null
          country: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          created_by_admin_user_id?: string | null
          currency: string
          disputed_at?: string | null
          distributor_id?: string | null
          expired_at?: string | null
          expires_at: string
          failed_at?: string | null
          first_contact_at?: string | null
          id?: string
          no_show_at?: string | null
          notes?: string | null
          opened_at?: string | null
          outcome_notes?: string | null
          paid_at?: string | null
          patient_id: string
          payment_status?: Database["public"]["Enums"]["intl_payment_status"]
          policy_id?: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          provider_account_id?: string | null
          provider_checkout_url?: string | null
          provider_order_id?: string | null
          provider_payment_id?: string | null
          recipient_external_merchant_id?: string | null
          refunded_at?: string | null
          region_id?: string | null
          rescheduled_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          signature_data?: string | null
          surgeon_id?: string | null
          surgery_completed_at?: string | null
          surgery_recommended_at?: string | null
          surgery_scheduled_at?: string | null
          surgery_status?: Database["public"]["Enums"]["intl_surgery_status"]
          terms_accept_ip?: string | null
          terms_accept_user_agent?: string | null
          terms_accepted_at?: string | null
          terms_sha256?: string | null
          terms_version?: string | null
          token_hash: string
          token_last4: string
          updated_at?: string
          zoho_module?: string | null
          zoho_record_id?: string | null
        }
        Update: {
          agent_email?: string | null
          agent_zoho_id?: string | null
          amount_minor?: number
          clinic_id?: string
          closed_at?: string | null
          consultation_status?: Database["public"]["Enums"]["intl_consultation_status"]
          consulted_at?: string | null
          country?: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          created_by_admin_user_id?: string | null
          currency?: string
          disputed_at?: string | null
          distributor_id?: string | null
          expired_at?: string | null
          expires_at?: string
          failed_at?: string | null
          first_contact_at?: string | null
          id?: string
          no_show_at?: string | null
          notes?: string | null
          opened_at?: string | null
          outcome_notes?: string | null
          paid_at?: string | null
          patient_id?: string
          payment_status?: Database["public"]["Enums"]["intl_payment_status"]
          policy_id?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          provider_account_id?: string | null
          provider_checkout_url?: string | null
          provider_order_id?: string | null
          provider_payment_id?: string | null
          recipient_external_merchant_id?: string | null
          refunded_at?: string | null
          region_id?: string | null
          rescheduled_count?: number
          scheduled_at?: string | null
          sent_at?: string | null
          signature_data?: string | null
          surgeon_id?: string | null
          surgery_completed_at?: string | null
          surgery_recommended_at?: string | null
          surgery_scheduled_at?: string | null
          surgery_status?: Database["public"]["Enums"]["intl_surgery_status"]
          terms_accept_ip?: string | null
          terms_accept_user_agent?: string | null
          terms_accepted_at?: string | null
          terms_sha256?: string | null
          terms_version?: string | null
          token_hash?: string
          token_last4?: string
          updated_at?: string
          zoho_module?: string | null
          zoho_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consultations_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "consultation_patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "international_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_provider_account_id_fkey"
            columns: ["provider_account_id"]
            isOneToOne: false
            referencedRelation: "provider_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultations_surgeon_id_fkey"
            columns: ["surgeon_id"]
            isOneToOne: false
            referencedRelation: "surgeons"
            referencedColumns: ["id"]
          },
        ]
      }
      distributor_regions: {
        Row: {
          created_at: string
          distributor_id: string
          id: string
          region_id: string
        }
        Insert: {
          created_at?: string
          distributor_id: string
          id?: string
          region_id: string
        }
        Update: {
          created_at?: string
          distributor_id?: string
          id?: string
          region_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "distributor_regions_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "distributor_regions_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "regions"
            referencedColumns: ["id"]
          },
        ]
      }
      distributors: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          legal_name: string | null
          name: string
          primary_contact_email: string | null
          primary_contact_phone: string | null
          updated_at: string
          zoho_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          legal_name?: string | null
          name: string
          primary_contact_email?: string | null
          primary_contact_phone?: string | null
          updated_at?: string
          zoho_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          legal_name?: string | null
          name?: string
          primary_contact_email?: string | null
          primary_contact_phone?: string | null
          updated_at?: string
          zoho_id?: string | null
        }
        Relationships: []
      }
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
        ]
      }
      enrollments: {
        Row: {
          amount_cents: number
          consent_pdf_path: string | null
          created_at: string | null
          currency: string | null
          expired_at: string | null
          expires_at: string
          failed_at: string | null
          id: string
          opened_at: string | null
          owner_email: string | null
          owner_name: string | null
          owner_zoho_id: string | null
          paid_at: string | null
          patient_email: string | null
          patient_id: string | null
          patient_name: string | null
          patient_phone: string | null
          payment_method_type:
            | Database["public"]["Enums"]["payment_method_type"]
            | null
          policy_id: string | null
          privacy_url: string
          processing_at: string | null
          refunded_at: string | null
          signature_data: string | null
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
          consent_pdf_path?: string | null
          created_at?: string | null
          currency?: string | null
          expired_at?: string | null
          expires_at: string
          failed_at?: string | null
          id?: string
          opened_at?: string | null
          owner_email?: string | null
          owner_name?: string | null
          owner_zoho_id?: string | null
          paid_at?: string | null
          patient_email?: string | null
          patient_id?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          payment_method_type?:
            | Database["public"]["Enums"]["payment_method_type"]
            | null
          policy_id?: string | null
          privacy_url: string
          processing_at?: string | null
          refunded_at?: string | null
          signature_data?: string | null
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
          consent_pdf_path?: string | null
          created_at?: string | null
          currency?: string | null
          expired_at?: string | null
          expires_at?: string
          failed_at?: string | null
          id?: string
          opened_at?: string | null
          owner_email?: string | null
          owner_name?: string | null
          owner_zoho_id?: string | null
          paid_at?: string | null
          patient_email?: string | null
          patient_id?: string | null
          patient_name?: string | null
          patient_phone?: string | null
          payment_method_type?:
            | Database["public"]["Enums"]["payment_method_type"]
            | null
          policy_id?: string | null
          privacy_url?: string
          processing_at?: string | null
          refunded_at?: string | null
          signature_data?: string | null
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
        Relationships: [
          {
            foreignKeyName: "enrollments_patient_id_fkey"
            columns: ["patient_id"]
            isOneToOne: false
            referencedRelation: "patients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_audit_logs: {
        Row: {
          actor_id: string | null
          attempt: number
          created_at: string
          direction: string
          entity_id: string | null
          entity_type: string | null
          error: string | null
          id: string
          integration: string
          request_summary: Json | null
          response_status: number | null
        }
        Insert: {
          actor_id?: string | null
          attempt?: number
          created_at?: string
          direction: string
          entity_id?: string | null
          entity_type?: string | null
          error?: string | null
          id?: string
          integration: string
          request_summary?: Json | null
          response_status?: number | null
        }
        Update: {
          actor_id?: string | null
          attempt?: number
          created_at?: string
          direction?: string
          entity_id?: string | null
          entity_type?: string | null
          error?: string | null
          id?: string
          integration?: string
          request_summary?: Json | null
          response_status?: number | null
        }
        Relationships: []
      }
      international_country_settings: {
        Row: {
          allow_patient_provider_choice: boolean
          allowed_providers: Database["public"]["Enums"]["payment_provider"][]
          country: Database["public"]["Enums"]["intl_country"]
          created_at: string
          default_currency: string
          default_language: string
          is_enabled: boolean
          link_expiry_hours: number
          max_fee_minor: number | null
          min_fee_minor: number
          sla_first_contact_hours: number
          updated_at: string
        }
        Insert: {
          allow_patient_provider_choice?: boolean
          allowed_providers?: Database["public"]["Enums"]["payment_provider"][]
          country: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          default_currency: string
          default_language?: string
          is_enabled?: boolean
          link_expiry_hours?: number
          max_fee_minor?: number | null
          min_fee_minor?: number
          sla_first_contact_hours?: number
          updated_at?: string
        }
        Update: {
          allow_patient_provider_choice?: boolean
          allowed_providers?: Database["public"]["Enums"]["payment_provider"][]
          country?: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          default_currency?: string
          default_language?: string
          is_enabled?: boolean
          link_expiry_hours?: number
          max_fee_minor?: number | null
          min_fee_minor?: number
          sla_first_contact_hours?: number
          updated_at?: string
        }
        Relationships: []
      }
      international_policies: {
        Row: {
          cancellation_policy: string | null
          clinic_id: string | null
          content_sha256: string
          country: Database["public"]["Enums"]["intl_country"]
          created_at: string
          effective_at: string
          id: string
          is_active: boolean
          language: string
          no_show_policy: string | null
          privacy_url: string | null
          provider: Database["public"]["Enums"]["payment_provider"] | null
          refund_exceptions: string | null
          terms_text: string
          terms_url: string | null
          updated_at: string
          version: string
        }
        Insert: {
          cancellation_policy?: string | null
          clinic_id?: string | null
          content_sha256: string
          country: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          effective_at?: string
          id?: string
          is_active?: boolean
          language?: string
          no_show_policy?: string | null
          privacy_url?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"] | null
          refund_exceptions?: string | null
          terms_text: string
          terms_url?: string | null
          updated_at?: string
          version: string
        }
        Update: {
          cancellation_policy?: string | null
          clinic_id?: string | null
          content_sha256?: string
          country?: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          effective_at?: string
          id?: string
          is_active?: boolean
          language?: string
          no_show_policy?: string | null
          privacy_url?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"] | null
          refund_exceptions?: string | null
          terms_text?: string
          terms_url?: string | null
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "international_policies_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
        ]
      }
      intl_zoho_outbox: {
        Row: {
          attempts: number
          consultation_id: string | null
          created_at: string
          id: string
          last_error: string | null
          next_attempt_at: string
          operation: string
          payload: Json
          status: Database["public"]["Enums"]["intl_outbox_status"]
          updated_at: string
        }
        Insert: {
          attempts?: number
          consultation_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          operation: string
          payload: Json
          status?: Database["public"]["Enums"]["intl_outbox_status"]
          updated_at?: string
        }
        Update: {
          attempts?: number
          consultation_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          operation?: string
          payload?: Json
          status?: Database["public"]["Enums"]["intl_outbox_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "intl_zoho_outbox_consultation_id_fkey"
            columns: ["consultation_id"]
            isOneToOne: false
            referencedRelation: "consultations"
            referencedColumns: ["id"]
          },
        ]
      }
      mfa_email_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          id: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          id?: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      patients: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          surgeon_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          surgeon_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          surgeon_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "patients_surgeon_id_fkey"
            columns: ["surgeon_id"]
            isOneToOne: false
            referencedRelation: "surgeons"
            referencedColumns: ["id"]
          },
        ]
      }
      policies: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          privacy_text: string | null
          privacy_url: string
          terms_content_sha256: string
          terms_text: string | null
          terms_url: string
          updated_at: string
          version: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          privacy_text?: string | null
          privacy_url: string
          terms_content_sha256: string
          terms_text?: string | null
          terms_url: string
          updated_at?: string
          version: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          privacy_text?: string | null
          privacy_url?: string
          terms_content_sha256?: string
          terms_text?: string | null
          terms_url?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      portal_memberships: {
        Row: {
          clinic_id: string | null
          created_at: string
          distributor_id: string | null
          granted_at: string
          granted_by: string | null
          id: string
          is_active: boolean
          org_type: Database["public"]["Enums"]["portal_org_type"]
          portal_user_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["portal_role"]
          updated_at: string
        }
        Insert: {
          clinic_id?: string | null
          created_at?: string
          distributor_id?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          org_type: Database["public"]["Enums"]["portal_org_type"]
          portal_user_id: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["portal_role"]
          updated_at?: string
        }
        Update: {
          clinic_id?: string | null
          created_at?: string
          distributor_id?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_active?: boolean
          org_type?: Database["public"]["Enums"]["portal_org_type"]
          portal_user_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["portal_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_memberships_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_memberships_distributor_id_fkey"
            columns: ["distributor_id"]
            isOneToOne: false
            referencedRelation: "distributors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_memberships_portal_user_id_fkey"
            columns: ["portal_user_id"]
            isOneToOne: false
            referencedRelation: "portal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_users: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          invited_at: string
          invited_by: string | null
          is_active: boolean
          last_login_at: string | null
          mfa_required: boolean
          phone: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          is_active?: boolean
          last_login_at?: string | null
          mfa_required?: boolean
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          invited_at?: string
          invited_by?: string | null
          is_active?: boolean
          last_login_at?: string | null
          mfa_required?: boolean
          phone?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      processed_provider_events: {
        Row: {
          error: string | null
          external_event_id: string
          processing_status: string
          provider: Database["public"]["Enums"]["payment_provider"]
          raw_payload: Json | null
          received_at: string
        }
        Insert: {
          error?: string | null
          external_event_id: string
          processing_status?: string
          provider: Database["public"]["Enums"]["payment_provider"]
          raw_payload?: Json | null
          received_at?: string
        }
        Update: {
          error?: string | null
          external_event_id?: string
          processing_status?: string
          provider?: Database["public"]["Enums"]["payment_provider"]
          raw_payload?: Json | null
          received_at?: string
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
      provider_accounts: {
        Row: {
          capabilities: Json
          clinic_id: string
          connected_at: string | null
          connected_by: string | null
          connection_method: Database["public"]["Enums"]["provider_connection_method"]
          country: Database["public"]["Enums"]["intl_country"]
          created_at: string
          currency: string
          disconnected_at: string | null
          environment: string
          external_merchant_id: string | null
          id: string
          is_active: boolean
          last_verified_at: string | null
          onboarding_status: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          status: Database["public"]["Enums"]["provider_account_status"]
          surgeon_id: string | null
          updated_at: string
        }
        Insert: {
          capabilities?: Json
          clinic_id: string
          connected_at?: string | null
          connected_by?: string | null
          connection_method?: Database["public"]["Enums"]["provider_connection_method"]
          country: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          currency: string
          disconnected_at?: string | null
          environment?: string
          external_merchant_id?: string | null
          id?: string
          is_active?: boolean
          last_verified_at?: string | null
          onboarding_status?: string | null
          provider: Database["public"]["Enums"]["payment_provider"]
          status?: Database["public"]["Enums"]["provider_account_status"]
          surgeon_id?: string | null
          updated_at?: string
        }
        Update: {
          capabilities?: Json
          clinic_id?: string
          connected_at?: string | null
          connected_by?: string | null
          connection_method?: Database["public"]["Enums"]["provider_connection_method"]
          country?: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          currency?: string
          disconnected_at?: string | null
          environment?: string
          external_merchant_id?: string | null
          id?: string
          is_active?: boolean
          last_verified_at?: string | null
          onboarding_status?: string | null
          provider?: Database["public"]["Enums"]["payment_provider"]
          status?: Database["public"]["Enums"]["provider_account_status"]
          surgeon_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_accounts_clinic_id_fkey"
            columns: ["clinic_id"]
            isOneToOne: false
            referencedRelation: "clinics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_accounts_surgeon_id_fkey"
            columns: ["surgeon_id"]
            isOneToOne: false
            referencedRelation: "surgeons"
            referencedColumns: ["id"]
          },
        ]
      }
      regions: {
        Row: {
          code: string
          country: Database["public"]["Enums"]["intl_country"]
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          country: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          country?: Database["public"]["Enums"]["intl_country"]
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      surgeon_credits: {
        Row: {
          consultant_email: string | null
          created_at: string
          credit_500_expires: string | null
          credit_750_expires: string | null
          credit_amount: number
          credit_status: Database["public"]["Enums"]["credit_status"]
          enrollment_date: string | null
          enrollment_id: string | null
          id: string
          issued_amount: number
          issued_at: string | null
          issued_by: string | null
          notes: string | null
          patient_email: string | null
          patient_name: string
          source: Database["public"]["Enums"]["credit_source"]
          stage: string | null
          surgeon_id: string | null
          surgeon_name: string
          surgery_date: string | null
          updated_at: string
          zoho_deal_id: string | null
        }
        Insert: {
          consultant_email?: string | null
          created_at?: string
          credit_500_expires?: string | null
          credit_750_expires?: string | null
          credit_amount?: number
          credit_status?: Database["public"]["Enums"]["credit_status"]
          enrollment_date?: string | null
          enrollment_id?: string | null
          id?: string
          issued_amount?: number
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          patient_email?: string | null
          patient_name: string
          source?: Database["public"]["Enums"]["credit_source"]
          stage?: string | null
          surgeon_id?: string | null
          surgeon_name: string
          surgery_date?: string | null
          updated_at?: string
          zoho_deal_id?: string | null
        }
        Update: {
          consultant_email?: string | null
          created_at?: string
          credit_500_expires?: string | null
          credit_750_expires?: string | null
          credit_amount?: number
          credit_status?: Database["public"]["Enums"]["credit_status"]
          enrollment_date?: string | null
          enrollment_id?: string | null
          id?: string
          issued_amount?: number
          issued_at?: string | null
          issued_by?: string | null
          notes?: string | null
          patient_email?: string | null
          patient_name?: string
          source?: Database["public"]["Enums"]["credit_source"]
          stage?: string | null
          surgeon_id?: string | null
          surgeon_name?: string
          surgery_date?: string | null
          updated_at?: string
          zoho_deal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "surgeon_credits_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "surgeon_credits_surgeon_id_fkey"
            columns: ["surgeon_id"]
            isOneToOne: false
            referencedRelation: "surgeons"
            referencedColumns: ["id"]
          },
        ]
      }
      surgeons: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          phone: string | null
          specialty: string | null
          updated_at: string
          zoho_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          phone?: string | null
          specialty?: string | null
          updated_at?: string
          zoho_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          phone?: string | null
          specialty?: string | null
          updated_at?: string
          zoho_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      admin_role: "admin" | "viewer" | "super_admin"
      credit_source: "zoho" | "import"
      credit_status: "pending" | "earned" | "forfeited" | "disputed" | "issued"
      enrollment_status:
        | "created"
        | "sent"
        | "opened"
        | "processing"
        | "paid"
        | "failed"
        | "expired"
        | "canceled"
        | "refunded"
      intl_consultation_status:
        | "draft"
        | "awaiting_payment"
        | "awaiting_clinic_contact"
        | "patient_contacted"
        | "scheduled"
        | "rescheduled"
        | "completed"
        | "no_show"
        | "patient_canceled"
        | "clinic_canceled"
        | "closed_lost"
      intl_country: "MX" | "CO" | "CL"
      intl_outbox_status: "pending" | "sent" | "failed" | "dead"
      intl_payment_status:
        | "draft"
        | "link_created"
        | "link_sent"
        | "link_opened"
        | "processing"
        | "approved"
        | "failed"
        | "expired"
        | "canceled"
        | "refunded"
        | "disputed"
      intl_surgery_status:
        | "none"
        | "recommended"
        | "scheduled"
        | "completed"
        | "declined"
      payment_method_type: "card" | "ach"
      payment_provider: "mercado_pago" | "paypal" | "test" | "stripe_connect"
      portal_org_type: "distributor" | "clinic"
      portal_role:
        | "distributor_admin"
        | "distributor_staff"
        | "distributor_analyst"
        | "clinic_admin"
        | "clinic_staff"
        | "clinic_analyst"
      provider_account_status:
        | "pending"
        | "onboarding"
        | "connected"
        | "expired"
        | "revoked"
        | "disabled"
      provider_connection_method:
        | "oauth"
        | "partner_onboarding"
        | "admin_managed"
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
      admin_role: ["admin", "viewer", "super_admin"],
      credit_source: ["zoho", "import"],
      credit_status: ["pending", "earned", "forfeited", "disputed", "issued"],
      enrollment_status: [
        "created",
        "sent",
        "opened",
        "processing",
        "paid",
        "failed",
        "expired",
        "canceled",
        "refunded",
      ],
      intl_consultation_status: [
        "draft",
        "awaiting_payment",
        "awaiting_clinic_contact",
        "patient_contacted",
        "scheduled",
        "rescheduled",
        "completed",
        "no_show",
        "patient_canceled",
        "clinic_canceled",
        "closed_lost",
      ],
      intl_country: ["MX", "CO", "CL"],
      intl_outbox_status: ["pending", "sent", "failed", "dead"],
      intl_payment_status: [
        "draft",
        "link_created",
        "link_sent",
        "link_opened",
        "processing",
        "approved",
        "failed",
        "expired",
        "canceled",
        "refunded",
        "disputed",
      ],
      intl_surgery_status: [
        "none",
        "recommended",
        "scheduled",
        "completed",
        "declined",
      ],
      payment_method_type: ["card", "ach"],
      payment_provider: ["mercado_pago", "paypal", "test", "stripe_connect"],
      portal_org_type: ["distributor", "clinic"],
      portal_role: [
        "distributor_admin",
        "distributor_staff",
        "distributor_analyst",
        "clinic_admin",
        "clinic_staff",
        "clinic_analyst",
      ],
      provider_account_status: [
        "pending",
        "onboarding",
        "connected",
        "expired",
        "revoked",
        "disabled",
      ],
      provider_connection_method: [
        "oauth",
        "partner_onboarding",
        "admin_managed",
      ],
    },
  },
} as const
