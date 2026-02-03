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

    // Success - show the refresh token to the user
    // In production, you'd store this securely
    const refreshToken = tokenData.refresh_token;
    const accessToken = tokenData.access_token;

    console.log('Zoho OAuth successful, refresh token obtained');

    return new Response(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>OAuth Success</title>
          <style>
            body { font-family: system-ui; padding: 40px; max-width: 600px; margin: 0 auto; }
            h1 { color: #03111d; }
            .success { color: #22c55e; }
            .token-box { 
              background: #f5f5f5; 
              padding: 16px; 
              border-radius: 8px; 
              word-break: break-all;
              margin: 16px 0;
              font-family: monospace;
              font-size: 12px;
            }
            .warning { 
              background: #fef3cd; 
              border: 1px solid #ffc107; 
              padding: 12px; 
              border-radius: 8px;
              margin-top: 20px;
            }
          </style>
        </head>
        <body>
          <h1 class="success">✓ OAuth Successful!</h1>
          <p>Your Zoho CRM connection has been authorized.</p>
          
          <h3>Refresh Token:</h3>
          <div class="token-box">${refreshToken || 'No refresh token returned - you may need to revoke and re-authorize'}</div>
          
          <div class="warning">
            <strong>Important:</strong> Copy this refresh token and add it as the <code>ZOHO_REFRESH_TOKEN</code> secret in your project. 
            This token is only shown once!
          </div>
          
          <p style="margin-top: 20px; color: #666;">
            Access token expires in ${tokenData.expires_in || 3600} seconds. The refresh token is used to obtain new access tokens automatically.
          </p>
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
