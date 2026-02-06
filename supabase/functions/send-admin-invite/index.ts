import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface InviteRequest {
  email: string;
  role: "admin" | "viewer";
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with user's auth token
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Get the current user
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify user is an admin
    const { data: adminUser, error: adminError } = await supabase
      .from("admin_users")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .not("accepted_at", "is", null)
      .maybeSingle();

    if (adminError || !adminUser) {
      return new Response(
        JSON.stringify({ error: "Only admins can invite users" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { email, role }: InviteRequest = await req.json();
    
    if (!email || !role) {
      return new Response(
        JSON.stringify({ error: "Email and role are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from("admin_users")
      .select("id, accepted_at")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingUser) {
      return new Response(
        JSON.stringify({ error: "A user with this email has already been invited" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Use service role to insert the admin user (bypasses RLS)
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Insert the new admin user invite
    const { error: insertError } = await supabaseAdmin
      .from("admin_users")
      .insert({
        email: normalizedEmail,
        role,
        invited_by: user.id,
      });

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create invite" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the app URL for the invite link
    const appUrl = Deno.env.get("APP_URL") || req.headers.get("origin") || "https://secure-enrollment-flow.lovable.app";
    const inviteLink = `${appUrl}/admin/login`;

    // Send email using Resend if API key is configured
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    let emailSent = false;
    let emailError = null;

    if (resendApiKey) {
      try {
        const emailResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: Deno.env.get("EMAIL_FROM") || "noreply@himplant.com",
            to: normalizedEmail,
            subject: "You've been invited to the Admin Dashboard",
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Admin Dashboard Invitation</h2>
                <p>You've been invited to access the Enrollment Admin Dashboard as a <strong>${role}</strong>.</p>
                <p>Click the button below to sign in with your Google account:</p>
                <p style="margin: 24px 0;">
                  <a href="${inviteLink}" 
                     style="background-color: #c65d21; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
                    Sign In to Dashboard
                  </a>
                </p>
                <p style="color: #666; font-size: 14px;">
                  If you didn't expect this invitation, you can safely ignore this email.
                </p>
              </div>
            `,
          }),
        });

        if (emailResponse.ok) {
          emailSent = true;
        } else {
          const errorData = await emailResponse.json();
          emailError = errorData.message || "Failed to send email";
          console.error("Email send error:", errorData);
        }
      } catch (e) {
        emailError = e instanceof Error ? e.message : "Unknown error";
        console.error("Email exception:", e);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        emailSent,
        emailError: emailSent ? null : (emailError || "Email service not configured"),
        inviteLink: emailSent ? null : inviteLink, // Only return link if email wasn't sent
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
