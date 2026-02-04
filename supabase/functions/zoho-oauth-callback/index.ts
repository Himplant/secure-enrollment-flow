import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      console.error('Zoho OAuth error:', error);
      return new Response(
        `
        <!DOCTYPE html>
        <html>
          <head><title>OAuth Error</title></head>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1 style="color: #cc5000;">OAuth Error</h1>
            <p>Error: ${error}</p>
            <p>Please try again or contact support.</p>
          </body>
        </html>
        `,
        { 
          headers: { ...corsHeaders, 'Content-Type': 'text/html' },
          status: 400 
        }
      );
    }

    if (!code) {
      return new Response(
        `
        <!DOCTYPE html>
        <html>
          <head><title>Missing Code</title></head>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1 style="color: #cc5000;">Missing Authorization Code</h1>
            <p>No authorization code was provided.</p>
          </body>
        </html>
        `,
        { 
          headers: { ...corsHeaders, 'Content-Type': 'text/html' },
          status: 400 
        }
      );
    }

    // Exchange code for tokens
    const clientId = Deno.env.get('ZOHO_CLIENT_ID');
    const clientSecret = Deno.env.get('ZOHO_CLIENT_SECRET');
    const redirectUri = `${Deno.env.get('SUPABASE_URL')}/functions/v1/zoho-oauth-callback`;

    if (!clientId || !clientSecret) {
      console.error('Missing Zoho credentials');
      return new Response(
        `
        <!DOCTYPE html>
        <html>
          <head><title>Configuration Error</title></head>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1 style="color: #cc5000;">Configuration Error</h1>
            <p>Zoho credentials are not configured. Please add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET.</p>
          </body>
        </html>
        `,
        { 
          headers: { ...corsHeaders, 'Content-Type': 'text/html' },
          status: 500 
        }
      );
    }

    // Exchange authorization code for tokens
    const tokenResponse = await fetch('https://accounts.zoho.com/oauth/v2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code: code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('Token exchange error:', tokenData);
      return new Response(
        `
        <!DOCTYPE html>
        <html>
          <head><title>Token Error</title></head>
          <body style="font-family: system-ui; padding: 40px; text-align: center;">
            <h1 style="color: #cc5000;">Token Exchange Failed</h1>
            <p>Error: ${tokenData.error}</p>
            <p>Please try again.</p>
          </body>
        </html>
        `,
        { 
          headers: { ...corsHeaders, 'Content-Type': 'text/html' },
          status: 400 
        }
      );
    }

    // SECURITY: Log token server-side only - never expose in browser
    const refreshToken = tokenData.refresh_token;
    const accessToken = tokenData.access_token;

    // Log the refresh token to server logs (only accessible by admins)
    // This is a one-time setup operation - the token should be copied from logs
    // and added as ZOHO_REFRESH_TOKEN secret
    console.log('='.repeat(60));
    console.log('ZOHO OAUTH SUCCESS - REFRESH TOKEN OBTAINED');
    console.log('='.repeat(60));
    console.log('Refresh Token (copy this to ZOHO_REFRESH_TOKEN secret):');
    console.log(refreshToken);
    console.log('='.repeat(60));
    console.log('Access Token (temporary, expires in', tokenData.expires_in || 3600, 'seconds):');
    console.log(accessToken);
    console.log('='.repeat(60));

    // Return success page WITHOUT exposing the token
    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>OAuth Success</title>
          <style>
            body { font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto; background: #f9fafb; }
            .container { background: white; padding: 32px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            h1 { color: #22c55e; margin-top: 0; }
            .step { background: #f0f9ff; padding: 16px; border-radius: 8px; margin: 16px 0; border-left: 4px solid #0ea5e9; }
            .step-number { font-weight: bold; color: #0ea5e9; }
            code { background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
            .security-note { background: #f0fdf4; border: 1px solid #22c55e; padding: 16px; border-radius: 8px; margin-top: 24px; }
            .security-icon { font-size: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✓ OAuth Authorization Successful!</h1>
            <p>Your Zoho CRM connection has been authorized. The refresh token has been securely logged to the server.</p>
            
            <h3>Next Steps:</h3>
            
            <div class="step">
              <span class="step-number">Step 1:</span> 
              Open your Lovable project's backend logs
            </div>
            
            <div class="step">
              <span class="step-number">Step 2:</span> 
              Find the log entry containing <code>ZOHO OAUTH SUCCESS</code>
            </div>
            
            <div class="step">
              <span class="step-number">Step 3:</span> 
              Copy the refresh token from the logs
            </div>
            
            <div class="step">
              <span class="step-number">Step 4:</span> 
              Add it as the <code>ZOHO_REFRESH_TOKEN</code> secret in your project
            </div>
            
            <div class="security-note">
              <span class="security-icon">🔒</span> <strong>Security Note:</strong> 
              The refresh token is not displayed in the browser for security reasons. 
              It can only be retrieved from the server logs, which are only accessible to project administrators.
            </div>
            
            <p style="margin-top: 24px; color: #666; font-size: 14px;">
              You can close this window after completing the steps above.
            </p>
          </div>
        </body>
      </html>
      `,
      { 
        headers: { ...corsHeaders, 'Content-Type': 'text/html' },
        status: 200 
      }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    console.error('Unexpected error:', error);
    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head><title>Error</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1 style="color: #cc5000;">Unexpected Error</h1>
          <p>${errorMessage}</p>
        </body>
      </html>
      `,
      { 
        headers: { ...corsHeaders, 'Content-Type': 'text/html' },
        status: 500 
      }
    );
  }
});
