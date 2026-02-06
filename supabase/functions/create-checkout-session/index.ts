import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";
import Stripe from "npm:stripe@18.5.0";
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CheckoutRequest {
  token: string;
  terms_accepted: boolean;
  consent_ip?: string;
  consent_user_agent?: string;
  signature_data?: string;
}

async function sha256Hash(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  return Array.from(new Uint8Array(hashBuffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "  • ")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function wrapText(text: string, maxWidth: number, font: any, fontSize: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");
  
  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    const words = paragraph.split(" ");
    let currentLine = "";
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const width = font.widthOfTextAtSize(testLine, fontSize);
      if (width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
  }
  return lines;
}

async function generateConsentPdf(
  enrollment: any,
  termsText: string | null,
  privacyText: string | null,
  signaturePngBytes: Uint8Array | null,
  clientIp: string,
  userAgent: string,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 10;
  const headerSize = 14;
  const margin = 50;
  const pageWidth = 612; // US Letter
  const pageHeight = 792;
  const contentWidth = pageWidth - margin * 2;
  const lineHeight = fontSize * 1.4;

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  const drawText = (text: string, options: { font?: any; size?: number; color?: any } = {}) => {
    const f = options.font || font;
    const s = options.size || fontSize;
    const c = options.color || rgb(0, 0, 0);
    if (y < margin + 40) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(text, { x: margin, y, font: f, size: s, color: c });
    y -= s * 1.4;
  };

  const drawWrappedText = (text: string) => {
    const lines = wrapText(text, contentWidth, font, fontSize);
    for (const line of lines) {
      if (y < margin + 20) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      if (line === "") {
        y -= lineHeight * 0.5;
      } else {
        page.drawText(line, { x: margin, y, font, size: fontSize, color: rgb(0, 0, 0) });
        y -= lineHeight;
      }
    }
  };

  // Header
  drawText("CONSENT & PAYMENT AUTHORIZATION", { font: fontBold, size: headerSize });
  y -= 10;

  // Patient details
  drawText("Patient Details", { font: fontBold, size: 12 });
  drawText(`Name: ${enrollment.patient_name || "N/A"}`);
  drawText(`Email: ${enrollment.patient_email || "N/A"}`);
  drawText(`Phone: ${enrollment.patient_phone || "N/A"}`);
  y -= 10;

  // Transaction details
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (enrollment.currency || "usd").toUpperCase(),
  }).format(enrollment.amount_cents / 100);
  drawText("Transaction Details", { font: fontBold, size: 12 });
  drawText(`Amount: ${amount}`);
  drawText(`Enrollment ID: ${enrollment.id}`);
  drawText(`Terms Version: ${enrollment.terms_version}`);
  drawText(`Terms SHA-256: ${enrollment.terms_sha256}`);
  y -= 10;

  // Terms content
  if (termsText) {
    drawText("Terms of Service", { font: fontBold, size: 12 });
    y -= 4;
    const plainTerms = stripHtml(termsText);
    drawWrappedText(plainTerms);
    y -= 10;
  }

  if (privacyText) {
    drawText("Privacy Policy", { font: fontBold, size: 12 });
    y -= 4;
    const plainPrivacy = stripHtml(privacyText);
    drawWrappedText(plainPrivacy);
    y -= 10;
  }

  // Consent record
  const acceptedAt = new Date().toISOString();
  drawText("Consent Record", { font: fontBold, size: 12 });
  drawText(`Accepted At: ${acceptedAt}`);
  drawText(`IP Address: ${clientIp}`);
  drawText(`User Agent: ${userAgent}`);
  y -= 10;

  // Signature
  if (signaturePngBytes) {
    drawText("Signature", { font: fontBold, size: 12 });
    y -= 4;
    if (y < margin + 100) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    try {
      const sigImage = await pdfDoc.embedPng(signaturePngBytes);
      const sigDims = sigImage.scale(0.4);
      const sigWidth = Math.min(sigDims.width, contentWidth);
      const sigHeight = sigDims.height * (sigWidth / sigDims.width);
      page.drawImage(sigImage, { x: margin, y: y - sigHeight, width: sigWidth, height: sigHeight });
      y -= sigHeight + 10;
    } catch (e) {
      console.error("Error embedding signature:", e);
      drawText("[Signature image could not be embedded]");
    }
  }

  // Footer
  y -= 20;
  drawText("This document was generated automatically at the time of consent.", {
    size: 8,
    color: rgb(0.5, 0.5, 0.5),
  });

  return await pdfDoc.save();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }

    const body: CheckoutRequest = await req.json();

    if (!body.token) {
      return new Response(JSON.stringify({ error: "Token is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body.terms_accepted) {
      return new Response(JSON.stringify({ error: "Terms must be accepted" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Hash the token to find the enrollment
    const tokenHash = await sha256Hash(body.token);

    // Fetch enrollment by token hash (with policy text)
    const { data: enrollment, error: fetchError } = await supabase
      .from("enrollments")
      .select(`
        *,
        policies (
          terms_text,
          privacy_text
        )
      `)
      .eq("token_hash", tokenHash)
      .single();

    if (fetchError || !enrollment) {
      return new Response(JSON.stringify({ error: "Invalid or expired enrollment link" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if already paid
    if (enrollment.status === "paid") {
      return new Response(JSON.stringify({ error: "This enrollment has already been paid" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if expired
    if (new Date(enrollment.expires_at) < new Date()) {
      if (enrollment.status !== "expired") {
        await supabase
          .from("enrollments")
          .update({ status: "expired", expired_at: new Date().toISOString() })
          .eq("id", enrollment.id);
      }
      return new Response(JSON.stringify({ error: "This enrollment link has expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if canceled
    if (enrollment.status === "canceled") {
      return new Response(JSON.stringify({ error: "This enrollment has been canceled" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Record terms acceptance
    const clientIp = body.consent_ip || req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
    const userAgent = body.consent_user_agent || req.headers.get("user-agent") || "unknown";

    // Process signature
    let signaturePngBytes: Uint8Array | null = null;
    if (body.signature_data) {
      // Extract base64 from data URL
      const base64Match = body.signature_data.match(/^data:image\/png;base64,(.+)$/);
      if (base64Match) {
        const binaryString = atob(base64Match[1]);
        signaturePngBytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          signaturePngBytes[i] = binaryString.charCodeAt(i);
        }
      }
    }

    // Generate consent PDF
    const policyData = (enrollment as any).policies;
    let consentPdfPath: string | null = null;
    
    try {
      const pdfBytes = await generateConsentPdf(
        enrollment,
        policyData?.terms_text || null,
        policyData?.privacy_text || null,
        signaturePngBytes,
        clientIp,
        userAgent,
      );

      // Upload to storage
      const pdfFileName = `${enrollment.id}/${Date.now()}-consent.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("consent-documents")
        .upload(pdfFileName, pdfBytes, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        console.error("Error uploading consent PDF:", uploadError);
      } else {
        consentPdfPath = pdfFileName;
        console.log(`Consent PDF uploaded: ${pdfFileName}`);
      }
    } catch (pdfError) {
      console.error("Error generating consent PDF:", pdfError);
      // Don't block checkout if PDF fails
    }

    // Update enrollment with consent data
    await supabase
      .from("enrollments")
      .update({
        terms_accepted_at: new Date().toISOString(),
        terms_accept_ip: clientIp,
        terms_accept_user_agent: userAgent,
        signature_data: body.signature_data ? "stored" : null,
        consent_pdf_path: consentPdfPath,
      })
      .eq("id", enrollment.id);

    // Log terms acceptance event
    await supabase.from("enrollment_events").insert({
      enrollment_id: enrollment.id,
      event_type: "terms_accepted",
      event_data: {
        ip: clientIp,
        user_agent: userAgent,
        terms_version: enrollment.terms_version,
        has_signature: !!body.signature_data,
        consent_pdf_path: consentPdfPath,
      },
    });

    // Initialize Stripe
    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Calculate session expiration
    const enrollmentExpiry = new Date(enrollment.expires_at);
    const thirtyMinutesFromNow = new Date(Date.now() + 30 * 60 * 1000);
    const sessionExpiry = enrollmentExpiry < thirtyMinutesFromNow ? enrollmentExpiry : thirtyMinutesFromNow;
    const minExpiryTime = new Date(Date.now() + 30 * 60 * 1000);
    const stripeExpiresAt = Math.max(
      Math.floor(sessionExpiry.getTime() / 1000),
      Math.floor(minExpiryTime.getTime() / 1000)
    );

    // Check if customer exists or create one
    let customerId: string | undefined;
    if (enrollment.patient_email) {
      const customers = await stripe.customers.list({ 
        email: enrollment.patient_email, 
        limit: 1 
      });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: enrollment.patient_email,
          name: enrollment.patient_name || undefined,
          phone: enrollment.patient_phone || undefined,
          metadata: {
            zoho_record_id: enrollment.zoho_record_id,
            zoho_module: enrollment.zoho_module,
          },
        });
        customerId = customer.id;
      }
    }

    // Get base URL for redirects
    const appUrl = (Deno.env.get("APP_URL") || req.headers.get("origin") || "https://secure-enrollment-flow.lovable.app").replace(/\/+$/, "");

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      customer_email: customerId ? undefined : enrollment.patient_email || undefined,
      payment_method_types: ["card", "us_bank_account"],
      line_items: [
        {
          price_data: {
            currency: enrollment.currency || "usd",
            product_data: {
              name: "Medical Service Enrollment",
              description: `Enrollment payment for ${enrollment.patient_name || "Patient"}`,
            },
            unit_amount: enrollment.amount_cents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${appUrl}/enroll/${body.token}?status=success`,
      cancel_url: `${appUrl}/enroll/${body.token}?status=canceled`,
      expires_at: stripeExpiresAt,
      metadata: {
        enrollment_id: enrollment.id,
        zoho_record_id: enrollment.zoho_record_id,
        zoho_module: enrollment.zoho_module,
        terms_version: enrollment.terms_version,
        terms_sha256: enrollment.terms_sha256,
      },
      payment_intent_data: {
        metadata: {
          enrollment_id: enrollment.id,
          zoho_record_id: enrollment.zoho_record_id,
          zoho_module: enrollment.zoho_module,
        },
      },
    });

    // Update enrollment with Stripe session info
    await supabase
      .from("enrollments")
      .update({
        stripe_session_id: session.id,
        stripe_customer_id: customerId || null,
      })
      .eq("id", enrollment.id);

    // Log checkout session created event
    await supabase.from("enrollment_events").insert({
      enrollment_id: enrollment.id,
      event_type: "checkout_session_created",
      event_data: {
        session_id: session.id,
        customer_id: customerId,
        amount_cents: enrollment.amount_cents,
      },
    });

    console.log(`Created checkout session ${session.id} for enrollment ${enrollment.id}`);

    return new Response(JSON.stringify({
      success: true,
      checkout_url: session.url,
      session_id: session.id,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in create-checkout-session:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Internal server error" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
