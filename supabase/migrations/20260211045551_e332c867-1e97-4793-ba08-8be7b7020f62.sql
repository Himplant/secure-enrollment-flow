
-- Create a persistent admin audit log table
CREATE TABLE public.admin_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user_id UUID REFERENCES auth.users(id),
  admin_email TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  resource_summary JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs
CREATE POLICY "Admins can view audit logs"
ON public.admin_audit_log
FOR SELECT
USING (is_admin(auth.uid()));

-- Only admins can insert audit logs
CREATE POLICY "Admins can insert audit logs"
ON public.admin_audit_log
FOR INSERT
WITH CHECK (is_admin(auth.uid()));

-- No updates or deletes allowed (immutable log)
CREATE POLICY "Deny update audit logs"
ON public.admin_audit_log
FOR UPDATE
USING (false);

CREATE POLICY "Deny delete audit logs"
ON public.admin_audit_log
FOR DELETE
USING (false);

-- Index for fast lookups
CREATE INDEX idx_audit_log_created_at ON public.admin_audit_log(created_at DESC);
CREATE INDEX idx_audit_log_resource ON public.admin_audit_log(resource_type, resource_id);
