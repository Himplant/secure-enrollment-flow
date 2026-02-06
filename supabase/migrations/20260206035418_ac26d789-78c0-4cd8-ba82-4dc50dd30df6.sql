
-- Table to store email-based MFA OTP codes
CREATE TABLE public.mfa_email_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.mfa_email_codes ENABLE ROW LEVEL SECURITY;

-- No direct public access - managed via edge functions with service role
-- Users can only read their own unexpired codes for verification
CREATE POLICY "Users can read own codes"
ON public.mfa_email_codes
FOR SELECT
TO authenticated
USING (user_id = auth.uid() AND used_at IS NULL AND expires_at > now());

-- Cleanup: auto-delete expired codes after 1 hour via index for efficient queries
CREATE INDEX idx_mfa_email_codes_user_expires ON public.mfa_email_codes (user_id, expires_at DESC);

-- Add mfa_method column to admin_users to track which MFA method each admin uses
ALTER TABLE public.admin_users ADD COLUMN IF NOT EXISTS mfa_method TEXT DEFAULT NULL;
-- Values: 'totp', 'email', or NULL (not yet set up)
