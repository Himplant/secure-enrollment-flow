 # Secure Enrollment Payments Platform - Developer Guide
 
 > **Last Updated**: February 2026  
 > **Version**: 1.0.0
 
 ---
 
 ## Table of Contents
 
 1. [Overview](#overview)
 2. [Architecture](#architecture)
 3. [Technology Stack](#technology-stack)
 4. [Database Schema](#database-schema)
 5. [Authentication & Authorization](#authentication--authorization)
 6. [External Integrations](#external-integrations)
 7. [Edge Functions](#edge-functions)
 8. [Patient Enrollment Flow](#patient-enrollment-flow)
 9. [Admin Dashboard](#admin-dashboard)
 10. [Security Implementation](#security-implementation)
 11. [Environment Variables](#environment-variables)
 12. [Deployment](#deployment)
 
 ---
 
 ## Overview
 
 The Secure Enrollment Payments Platform is a medical-grade payment collection system designed to:
 
 - Generate unique, single-use payment links from Zoho CRM
 - Collect Credit Card and ACH payments via Stripe Checkout
 - Maintain a complete audit trail with enforceable consent
 - Automatically sync payment status back to Zoho CRM
 - Provide an admin dashboard for managing enrollments, patients, policies, and surgeons
 
 ### Key Principles
 
 1. **No PHI or payment data stored locally** - All sensitive payment processing happens through Stripe
 2. **Token-based security** - Payment links use SHA-256 hashed tokens
 3. **Complete audit trail** - Every action is logged with timestamps and metadata
 4. **Row Level Security (RLS)** - All database tables have restrictive policies
 
 ---
 
 ## Architecture
 
 ```
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                              EXTERNAL SYSTEMS                                │
 ├─────────────────────────────────────────────────────────────────────────────┤
 │                                                                              │
 │   ┌──────────────┐         ┌──────────────┐         ┌──────────────┐        │
 │   │   Zoho CRM   │         │    Stripe    │         │   Patient    │        │
 │   │              │         │              │         │   Browser    │        │
 │   └──────┬───────┘         └──────┬───────┘         └──────┬───────┘        │
 │          │                        │                        │                │
 └──────────┼────────────────────────┼────────────────────────┼────────────────┘
            │                        │                        │
            ▼                        ▼                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
  │                          LOVABLE CLOUD EDGE FUNCTIONS                        │
 ├─────────────────────────────────────────────────────────────────────────────┤
 │                                                                              │
 │   ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐    │
 │   │ create-enrollment  │  │ stripe-webhook     │  │ get-enrollment     │    │
 │   │ (from Zoho)        │  │ (payment events)   │  │ (patient view)     │    │
 │   └────────────────────┘  └────────────────────┘  └────────────────────┘    │
 │                                                                              │
 │   ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐    │
 │   │ create-checkout-   │  │ regenerate-        │  │ admin-create-      │    │
 │   │ session            │  │ enrollment         │  │ enrollment         │    │
 │   └────────────────────┘  └────────────────────┘  └────────────────────┘    │
 │                                                                              │
 │   ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐    │
 │   │ sync-surgeons      │  │ zoho-oauth-        │  │ send-admin-invite  │    │
 │   │ (from Zoho)        │  │ callback           │  │                    │    │
 │   └────────────────────┘  └────────────────────┘  └────────────────────┘    │
 │                                                                              │
 └─────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
  │                          LOVABLE CLOUD DATABASE                              │
 ├─────────────────────────────────────────────────────────────────────────────┤
 │                                                                              │
 │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
 │   │  enrollments │  │   patients   │  │   policies   │  │   surgeons   │    │
 │   └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
 │                                                                              │
 │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
 │   │ enrollment_  │  │ admin_users  │  │ processed_   │                      │
 │   │ events       │  │              │  │ stripe_events│                      │
 │   └──────────────┘  └──────────────┘  └──────────────┘                      │
 │                                                                              │
 │   All tables have Row Level Security (RLS) enabled with restrictive policies│
 │                                                                              │
 └─────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │                              REACT FRONTEND                                  │
 ├─────────────────────────────────────────────────────────────────────────────┤
 │                                                                              │
 │   ┌────────────────────────────────────────────────────────────────────┐    │
 │   │                        PUBLIC ROUTES                                │    │
 │   │   /enroll/:token  →  Patient enrollment & payment page             │    │
 │   └────────────────────────────────────────────────────────────────────┘    │
 │                                                                              │
 │   ┌────────────────────────────────────────────────────────────────────┐    │
 │   │                        ADMIN ROUTES                                 │    │
 │   │   /admin/login    →  Admin authentication                          │    │
 │   │   /admin/pending  →  Pending invite acceptance                     │    │
 │   │   /admin          →  Dashboard (Patients, Transactions, Policies)  │    │
 │   └────────────────────────────────────────────────────────────────────┘    │
 │                                                                              │
 └─────────────────────────────────────────────────────────────────────────────┘
 ```
 
 ---
 
 ## Technology Stack
 
 ### Frontend
 
 | Technology | Purpose |
 |------------|---------|
 | React 18 | UI framework |
 | TypeScript | Type safety |
 | Vite | Build tool & dev server |
 | Tailwind CSS | Styling |
 | shadcn/ui | Component library |
 | TanStack Query | Server state management |
 | React Router DOM | Client-side routing |
 | TipTap | Rich text editor for policies |
 | Recharts | Analytics charts |
 
 ### Backend (Lovable Cloud)

> **Note**: This project uses **Lovable Cloud**, which provides a fully-managed backend. You do NOT need a separate Supabase account - everything is integrated automatically through Lovable. Access your backend via the "Cloud View" button in your Lovable project.
 
 | Technology | Purpose |
 |------------|---------|
| Lovable Cloud Database | PostgreSQL database (auto-provisioned) |
| Lovable Cloud Auth | Admin user authentication |
| Edge Functions | Serverless API endpoints (Deno runtime) |
 | Row Level Security | Data access control |
 
 ### External Services
 
 | Service | Purpose |
 |---------|---------|
 | Stripe | Payment processing (Checkout Sessions) |
 | Zoho CRM | Patient/enrollment source, status sync |
 
 ---
 
 ## Database Schema
 
 ### Tables Overview
 
 #### `enrollments`
 The core table storing all payment enrollment records.
 
 ```sql
 CREATE TABLE enrollments (
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   
   -- Patient Information (denormalized for quick access)
   patient_id UUID REFERENCES patients(id),
   patient_name TEXT,
   patient_email TEXT,
   patient_phone TEXT,
   
   -- Payment Details
   amount_cents INTEGER NOT NULL,
   currency TEXT DEFAULT 'usd',
   payment_method_type payment_method_type, -- 'card' | 'ach'
   
   -- Token Security (link authentication)
   token_hash TEXT NOT NULL,      -- SHA-256 hash of the token
   token_last4 TEXT NOT NULL,     -- Last 4 chars for reference
   
   -- Status & Timestamps
   status enrollment_status DEFAULT 'created',
   expires_at TIMESTAMPTZ NOT NULL,
   opened_at TIMESTAMPTZ,
   processing_at TIMESTAMPTZ,
   paid_at TIMESTAMPTZ,
   failed_at TIMESTAMPTZ,
   expired_at TIMESTAMPTZ,
   
   -- Terms/Consent Tracking
   policy_id UUID REFERENCES policies(id),
   terms_version TEXT NOT NULL,
   terms_url TEXT NOT NULL,
   privacy_url TEXT NOT NULL,
   terms_sha256 TEXT NOT NULL,     -- Hash of terms content at time of acceptance
   terms_accepted_at TIMESTAMPTZ,
   terms_accept_ip TEXT,
   terms_accept_user_agent TEXT,
   
   -- Stripe Integration
   stripe_session_id TEXT,
   stripe_payment_intent_id TEXT,
   stripe_customer_id TEXT,
   
   -- Zoho Integration
   zoho_module TEXT NOT NULL,
   zoho_record_id TEXT NOT NULL,
   
   -- Audit
   created_at TIMESTAMPTZ DEFAULT now(),
   updated_at TIMESTAMPTZ DEFAULT now()
 );
 ```
 
 **Status Flow:**
 ```
 created → opened → processing → paid
                  ↘           ↘ failed
                   → expired
                   → canceled
 ```
 
 #### `patients`
 Unique patient records for tracking history across multiple enrollments.
 
 ```sql
 CREATE TABLE patients (
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   name TEXT NOT NULL,
   email TEXT,                     -- Unique constraint
   phone TEXT,                     -- Unique constraint
   surgeon_id UUID REFERENCES surgeons(id),
   notes TEXT,
   created_at TIMESTAMPTZ DEFAULT now(),
   updated_at TIMESTAMPTZ DEFAULT now()
 );
 ```
 
 #### `policies`
 Terms of Service and Privacy Policy versions.
 
 ```sql
 CREATE TABLE policies (
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   name TEXT NOT NULL,
   version TEXT NOT NULL,
   description TEXT,
   terms_text TEXT,                -- Full HTML content
   terms_url TEXT NOT NULL,
   privacy_text TEXT,
   privacy_url TEXT NOT NULL,
   terms_content_sha256 TEXT NOT NULL,  -- Content hash for integrity
   is_default BOOLEAN DEFAULT false,
   is_active BOOLEAN DEFAULT true,
   created_at TIMESTAMPTZ DEFAULT now(),
   updated_at TIMESTAMPTZ DEFAULT now()
 );
 ```
 
 **Dynamic Placeholders Supported:**
 - `{{patient_name}}` - Patient's full name
 - `{{patient_email}}` - Patient's email
 - `{{patient_phone}}` - Patient's phone
 - `{{amount}}` - Formatted payment amount
 - `{{deposit_date}}` - Current date
 - `{{surgeon_name}}` - Assigned surgeon
 - `{{expiration_date}}` - Link expiration date
 
 #### `surgeons`
 Surgeon records synced from Zoho CRM.
 
 ```sql
 CREATE TABLE surgeons (
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   zoho_id TEXT NOT NULL UNIQUE,
   name TEXT NOT NULL,
   email TEXT,
   phone TEXT,
   specialty TEXT,
   is_active BOOLEAN DEFAULT true,
   created_at TIMESTAMPTZ DEFAULT now(),
   updated_at TIMESTAMPTZ DEFAULT now()
 );
 ```
 
 #### `enrollment_events`
 Complete audit log of all enrollment state changes.
 
 ```sql
 CREATE TABLE enrollment_events (
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   enrollment_id UUID NOT NULL REFERENCES enrollments(id),
   event_type TEXT NOT NULL,
   event_data JSONB,
   created_at TIMESTAMPTZ DEFAULT now()
 );
 ```
 
 **Event Types:**
 - `created` - Initial enrollment creation
 - `opened` - Patient accessed the link
 - `terms_accepted` - Patient accepted terms
 - `checkout_started` - Stripe session created
 - `processing` - Payment initiated (ACH)
 - `paid` - Payment successful
 - `failed` - Payment failed
 - `expired` - Link expired
 - `regenerated` - New link generated by admin
 
 #### `admin_users`
 Admin user management with role-based access.
 
 ```sql
 CREATE TABLE admin_users (
   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
   user_id UUID,                   -- Links to auth.users after signup
   email TEXT NOT NULL,
   role admin_role DEFAULT 'viewer',  -- 'admin' | 'viewer'
   invited_by UUID,
   invited_at TIMESTAMPTZ DEFAULT now(),
   accepted_at TIMESTAMPTZ,        -- NULL until invite accepted
   created_at TIMESTAMPTZ DEFAULT now(),
   updated_at TIMESTAMPTZ DEFAULT now()
 );
 ```
 
 #### `processed_stripe_events`
 Idempotency table for webhook deduplication.
 
 ```sql
 CREATE TABLE processed_stripe_events (
   stripe_event_id TEXT PRIMARY KEY,
   processed_at TIMESTAMPTZ DEFAULT now()
 );
 ```
 
 ### Database Functions
 
 | Function | Purpose |
 |----------|---------|
 | `is_admin(user_id)` | Check if user is an accepted admin |
 | `has_admin_role(user_id, role)` | Check if user has specific role |
 | `has_pending_invite(email)` | Check for pending invite by email |
 | `get_pending_invite_id(email)` | Get invite ID for acceptance |
 | `auth_user_email()` | Get current user's email |
 | `ensure_single_default_policy()` | Trigger to maintain one default policy |
 | `update_updated_at_column()` | Trigger for automatic timestamp updates |
 
 ---
 
 ## Authentication & Authorization
 
 ### Admin Authentication Flow
 
 ```
 1. Super Admin invites user via email
    └─→ Creates admin_users record with email, accepted_at = NULL
 
 2. Invited user clicks signup link
      └─→ Creates auth.users account via Lovable Cloud Auth
 
 3. User redirected to /admin/pending
    └─→ System checks has_pending_invite(email)
    └─→ If true, links user_id and sets accepted_at = now()
 
 4. User gains access to /admin dashboard
    └─→ AdminProtectedRoute checks is_admin(user_id)
 ```
 
 ### Role-Based Access Control
 
 | Role | Capabilities |
 |------|--------------|
 | `admin` | Full access: manage users, policies, enrollments, surgeons |
 | `viewer` | Read-only access to dashboard and transactions |
 
 ### RLS Policies Summary
 
 All tables have RLS enabled with restrictive policies:
 
 | Table | Public Access | Admin Access |
 |-------|---------------|--------------|
 | `enrollments` | Denied (use edge functions) | SELECT only |
 | `enrollment_events` | Denied | Denied (service role only) |
 | `patients` | Denied | Full CRUD |
 | `policies` | Denied | Full CRUD |
 | `surgeons` | Denied | Full CRUD |
 | `admin_users` | Denied | Based on role |
 | `processed_stripe_events` | Denied | Denied (service role only) |
 
 ---
 
 ## External Integrations
 
 ### Stripe Integration
 
 #### Configuration
 
 ```
 STRIPE_SECRET_KEY     - API key for server-side operations
 STRIPE_WEBHOOK_SECRET - Webhook signature verification
 ```
 
 #### Payment Flow
 
 ```
 1. Patient accepts terms on enrollment page
    └─→ Frontend calls create-checkout-session edge function
 
 2. Edge function creates Stripe Checkout Session
    └─→ payment_method_types: ['card', 'us_bank_account']
    └─→ success_url: /enroll/:token?status=success
    └─→ cancel_url: /enroll/:token?status=canceled
 
 3. Patient completes payment on Stripe-hosted page
    └─→ Stripe sends webhook event to stripe-webhook
 
 4. Webhook updates enrollment status
    └─→ checkout.session.completed:
        - Card: status → 'paid'
        - ACH: status → 'processing'
    └─→ payment_intent.succeeded (ACH): status → 'paid'
    └─→ payment_intent.payment_failed: status → 'failed'
    └─→ checkout.session.expired: status → 'expired'
 ```
 
 #### Webhook Signature Verification
 
 **Critical**: Uses `constructEventAsync` (not `constructEvent`) for Deno/Edge compatibility:
 
 ```typescript
 // CORRECT - Async version for Edge Functions
 event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
 
 // WRONG - Synchronous version fails in Deno
 event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
 ```
 
 ### Zoho CRM Integration
 
 #### Configuration
 
 ```
 ZOHO_CLIENT_ID      - OAuth application client ID
 ZOHO_CLIENT_SECRET  - OAuth application secret
 ZOHO_REFRESH_TOKEN  - Long-lived refresh token for API access
 ```
 
 #### OAuth Setup
 
 1. Created Zoho API Console application
 2. Redirect URI: `https://aygfraqvempqexlplofu.supabase.co/functions/v1/zoho-oauth-callback`
 3. Scopes: `ZohoCRM.modules.ALL`, `ZohoCRM.settings.ALL`
 4. Obtained refresh token via OAuth flow
 
 #### Integration Points
 
 | Function | Purpose |
 |----------|---------|
 | `create-enrollment` | Called by Zoho button/workflow to create payment link |
 | `sync-surgeons` | Syncs surgeon records from Zoho Surgeons module |
 | `zoho-oauth-callback` | Handles OAuth token exchange |
 | `test-zoho-token` | Validates Zoho API connectivity |
 
 #### Setting Up Zoho CRM Button (Deals Module)
 
 To create a button in Zoho CRM that triggers payment link creation:
 
 **Step 1: Create the Button**
 1. Go to **Setup → Customization → Modules and Fields → Deals**
 2. Click on **Links and Buttons** tab
 3. Click **+ New Button**
 4. Name it: `Create Payment Link`
 5. Choose **View Page** as the placement
 6. Select **Writing Function** as the action
 
 **Step 2: Create the Deluge Function**
 
 Use this Deluge script:
 
 ```deluge
 // Get Deal details
 dealId = deal.get("id");
 contactId = deal.get("Contact_Name").get("id");
 
 // Fetch contact details
 contactResp = zoho.crm.getRecordById("Contacts", contactId);
 
 // Prepare the request
 patientName = contactResp.get("Full_Name");
 patientEmail = contactResp.get("Email");
 patientPhone = contactResp.get("Phone");
 amountCents = (deal.get("Amount").toDecimal() * 100).round();
 
 // Make API call to create enrollment
 headers = Map();
 headers.put("Content-Type", "application/json");
 headers.put("X-Shared-Secret", "YOUR_ENROLLMENT_SHARED_SECRET");
 
 payload = Map();
 payload.put("zoho_module", "Deals");
 payload.put("zoho_record_id", dealId.toString());
 payload.put("patient_name", patientName);
 payload.put("patient_email", patientEmail);
 payload.put("patient_phone", patientPhone);
 payload.put("amount_cents", amountCents);
 payload.put("currency", "usd");
 // Note: terms data is optional - the system will use the default policy
 // To use a specific policy, add: payload.put("policy_id", "your-policy-uuid");
 
 response = invokeurl
 [
     url: "https://aygfraqvempqexlplofu.supabase.co/functions/v1/create-enrollment"
     type: POST
     parameters: payload.toString()
     headers: headers
 ];
 
 // Parse response
 responseData = response.toMap();
 
 if(responseData.containsKey("enrollment_url"))
 {
     // Update the Deal with the payment link
     updateData = Map();
     updateData.put("Payment_Link", responseData.get("enrollment_url"));
     updateData.put("Payment_Link_Expires", responseData.get("expires_at"));
     updateData.put("Enrollment_Status", "Link Sent");
     
     zoho.crm.updateRecord("Deals", dealId, updateData);
     
     // Return success message with link
     return "Payment Link Created!\n\n" + responseData.get("enrollment_url");
 }
 else
 {
     return "Error: " + responseData.get("error");
 }
 ```
 
 **Step 3: Create Required Zoho Fields**
 
 Add these custom fields to your Deals module:
 
 | Field Label | API Name | Type |
 |-------------|----------|------|
 | Payment Link | `Payment_Link` | URL |
 | Payment Link Expires | `Payment_Link_Expires` | DateTime |
 | Enrollment Status | `Enrollment_Status` | Picklist |
 | Payment Method | `Payment_Method` | Picklist |
 | Payment Date | `Payment_Date` | DateTime |
 | Stripe Session ID | `Stripe_Session_ID` | Text |
 | Processing Date | `Processing_Date` | DateTime |
 | Payment Failed Date | `Payment_Failed_Date` | DateTime |
 | Expired Date | `Expired_Date` | DateTime |
 
 **Step 4: Set Up ENROLLMENT_SHARED_SECRET**
 
 In your Lovable project, add the `ENROLLMENT_SHARED_SECRET` secret and use the same value in your Deluge function.
 
 **Step 5: Create a Default Policy**
 
 Before the Zoho button will work, you must create at least one policy in the admin dashboard (`/admin` → Policies tab) and mark it as the default. This policy's terms and privacy text will be used for all enrollments.
 
 #### 2-Way Sync: Payment Status Updates to Zoho
 
 When payment events occur, the `stripe-webhook` function automatically updates Zoho CRM:
 
 | Stripe Event | Zoho Update |
 |--------------|-------------|
 | `checkout.session.completed` (Card) | Status → "Paid", Payment_Date set |
 | `checkout.session.completed` (ACH) | Status → "Processing", Processing_Date set |
 | `payment_intent.succeeded` | Status → "Paid", Payment_Date set |
 | `payment_intent.payment_failed` | Status → "Failed", Payment_Failed_Date set |
 | `checkout.session.expired` | Status → "Expired", Expired_Date set |
 
 A timeline note is also added to the Zoho record for each event.
 
 #### Enrollment Creation from Zoho
 
 ```
 POST /functions/v1/create-enrollment
 Headers:
   X-SHARED-SECRET: ${ENROLLMENT_SHARED_SECRET}
 Body:
   {
     "zoho_module": "Deals",
     "zoho_record_id": "1234567890",
     "patient_name": "John Doe",
     "patient_email": "john@example.com",
     "patient_phone": "+1234567890",
     "amount_cents": 50000,
     "currency": "usd"
   }
 Response:
   {
     "enrollment_url": "https://app.com/enroll/abc123...",
     "expires_at": "2026-02-07T12:00:00Z"
   }
 ```
 
 ---
 
 ## Edge Functions
 
 ### Function Reference
 
 | Function | JWT Required | Purpose |
 |----------|--------------|---------|
 | `create-enrollment` | No (shared secret) | Create new enrollment from Zoho |
 | `get-enrollment` | No (token auth) | Fetch enrollment for patient view |
 | `create-checkout-session` | No (token auth) | Create Stripe Checkout Session |
 | `stripe-webhook` | No (signature) | Handle Stripe webhook events |
 | `regenerate-enrollment` | Yes (admin) | Generate new link for existing enrollment |
 | `admin-create-enrollment` | Yes (admin) | Create enrollment from admin dashboard |
 | `send-admin-invite` | Yes (admin) | Send admin invite email |
 | `sync-surgeons` | Yes (admin) | Sync surgeons from Zoho |
 | `zoho-oauth-callback` | No | Handle Zoho OAuth |
 | `test-zoho-token` | No | Test Zoho API connection |
 
 ### Configuration (supabase/config.toml)
 
 ```toml
 project_id = "aygfraqvempqexlplofu"
 
 [functions.zoho-oauth-callback]
 verify_jwt = false
 
 [functions.create-enrollment]
 verify_jwt = false
 
 [functions.create-checkout-session]
 verify_jwt = false
 
 [functions.stripe-webhook]
 verify_jwt = false
 
 [functions.test-zoho-token]
 verify_jwt = false
 ```
 
 ### Token Security Pattern
 
 Enrollment links use a secure token pattern:
 
 ```typescript
 // Token Generation
 const rawToken = crypto.randomBytes(32).toString('hex');  // 64 char hex
 const tokenHash = SHA256(rawToken);  // Stored in DB
 const tokenLast4 = rawToken.slice(-4);  // For reference
 
 // Token Validation (in get-enrollment)
 const incomingHash = SHA256(requestToken);
 const enrollment = await db.query(
   'SELECT * FROM enrollments WHERE token_hash = $1',
   [incomingHash]
 );
 ```
 
 **Key Points:**
 - Raw token is NEVER stored in database
 - Only the hash is stored for lookup
 - Token is single-use (status changes after use)
 - Last 4 chars stored for admin reference
 
 ---
 
 ## Patient Enrollment Flow
 
 ### Complete Flow Diagram
 
 ```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │                         PATIENT ENROLLMENT FLOW                         │
 └─────────────────────────────────────────────────────────────────────────┘
 
 1. ENROLLMENT CREATION (Zoho → Edge Function)
    ┌──────────────┐         ┌────────────────────┐
    │   Zoho CRM   │ ──────→ │ create-enrollment  │
    │  (Button)    │  POST   │  Edge Function     │
    └──────────────┘         └─────────┬──────────┘
                                       │
                                       ▼
                              ┌────────────────────┐
                              │ Generate Token     │
                              │ Hash & Store       │
                              │ Set expires_at     │
                              │ Return URL         │
                              └────────────────────┘
 
 2. PATIENT OPENS LINK (Browser → Edge Function → React)
    ┌──────────────┐         ┌────────────────────┐
    │   Patient    │ ──────→ │ /enroll/:token     │
    │   Browser    │  GET    │   React Page       │
    └──────────────┘         └─────────┬──────────┘
                                       │
                                       ▼
                              ┌────────────────────┐
                              │ get-enrollment     │
                              │ - Validate token   │
                              │ - Check expiry     │
                              │ - Scrub PII        │
                              │ - Return minimal   │
                              │   data             │
                              └────────────────────┘
 
 3. PATIENT ACCEPTS TERMS & PAYS
    ┌──────────────┐         ┌────────────────────┐
    │   Accept     │ ──────→ │ create-checkout-   │
    │   Terms      │  POST   │ session            │
    └──────────────┘         └─────────┬──────────┘
                                       │
                                       ▼
                              ┌────────────────────┐
                              │ Create Stripe      │
                              │ Checkout Session   │
                              │ Redirect patient   │
                              └─────────┬──────────┘
                                       │
                                       ▼
                              ┌────────────────────┐
                              │   Stripe Hosted    │
                              │   Checkout Page    │
                              └─────────┬──────────┘
                                       │
                                       ▼
 4. PAYMENT CONFIRMATION (Stripe → Webhook → Database)
    ┌──────────────┐         ┌────────────────────┐
    │   Stripe     │ ──────→ │ stripe-webhook     │
    │   Webhook    │  POST   │ Edge Function      │
    └──────────────┘         └─────────┬──────────┘
                                       │
                                       ▼
                              ┌────────────────────┐
                              │ Verify signature   │
                              │ Update enrollment  │
                              │ Log event          │
                              │ Sync to Zoho CRM   │
                              └────────────────────┘
 ```
 
 ### Frontend Components
 
 | Component | File | Purpose |
 |-----------|------|---------|
 | `EnrollPage` | `src/pages/EnrollPage.tsx` | Main enrollment page container |
 | `EnrollmentCard` | `src/components/EnrollmentCard.tsx` | Payment summary card |
 | `TermsConsent` | `src/components/TermsConsent.tsx` | Terms acceptance UI |
 | `CountdownTimer` | `src/components/CountdownTimer.tsx` | Expiration countdown |
 | `EnrollmentStatus` | `src/components/EnrollmentStatus.tsx` | Status display |
 | `StatusBadge` | `src/components/StatusBadge.tsx` | Status indicator badge |
 
 ---
 
 ## Admin Dashboard
 
 ### Dashboard Structure
 
 ```
 /admin
 ├── DashboardStats         # Revenue, conversion metrics
 ├── Tabs
 │   ├── Patients Tab       # Patient management, history
 │   │   ├── PatientsTab
 │   │   ├── ImportPatientsModal
 │   │   └── PatientHistoryModal
 │   │
 │   ├── Transactions Tab   # Enrollment/payment management
 │   │   ├── TransactionsTab
 │   │   ├── TransactionDetailsModal
 │   │   ├── CreateEnrollmentModal
 │   │   └── RegenerateLinkModal
 │   │
 │   ├── Policies Tab       # Terms & Privacy management
 │   │   ├── PoliciesTab
 │   │   ├── RichTextEditor
 │   │   └── PolicyPlaceholders
 │   │
 │   └── Surgeons Tab       # Surgeon management
 │       ├── SurgeonManagement
 │       ├── SurgeonSelect
 │       └── SurgeonDistributionCard
 │
 └── User Management        # Admin user invites/roles
     └── UserManagement
 ```
 
 ### Key Features
 
 #### Transaction Management
 - View all enrollments with filtering (status, surgeon, date, amount)
 - Create manual enrollments for existing/new patients
 - Regenerate payment links with new expiration and policy
 - View detailed transaction history and events
 
 #### Link Regeneration
 The `RegenerateLinkModal` allows admins to:
 1. Generate a new token for an existing enrollment
 2. Set a new expiration date
 3. Attach a different policy version
 4. Get a fresh, copyable payment link
 
 **Allowed for:** `created`, `opened`, `expired`, `canceled`, `failed`  
 **Blocked for:** `paid`, `processing` (active payments cannot be regenerated)
 
 #### Policy Management
 - Create/edit policies with rich text editor (TipTap)
 - Support for tables, links, formatting
 - Dynamic placeholders replaced at view time
 - SHA-256 hash ensures content integrity
 - One default policy enforced via database trigger
 
 #### Analytics
 - Total revenue (paid enrollments)
 - Conversion rate (paid / total)
 - Revenue by surgeon
 - Status distribution
 - Payment method breakdown
 
 ---
 
 ## Security Implementation
 
 ### 1. Token Security
 
 ```typescript
 // Tokens are NEVER stored in plain text
 const token = generateSecureToken(32);  // 64 hex chars
 const hash = await SHA256(token);       // Only hash stored
 
 // Validation compares hashes
 const incomingHash = await SHA256(requestToken);
 const valid = enrollment.token_hash === incomingHash;
 ```
 
 ### 2. PII Protection
 
The `get-enrollment` edge function controls what data is exposed to unauthenticated patients:
 
 ```typescript
 // Data returned to unauthenticated patient
 return {
  patient_first_name: enrollment.patient_name?.split(' ')[0],
  patient_name: enrollment.patient_name,     // For terms placeholder display
  patient_email: enrollment.patient_email,   // For terms placeholder display
  patient_phone: enrollment.patient_phone,   // For terms placeholder display
  surgeon_name: surgeonName,                 // For terms placeholder display
   amount_cents: enrollment.amount_cents,
   currency: enrollment.currency,
   status: enrollment.status,
   expires_at: enrollment.expires_at,
   terms_text: policy.terms_text,  // Rendered with placeholders
   privacy_text: policy.privacy_text,
 };
 
// NOT returned: IP address, user agent, Zoho IDs, Stripe IDs, token hash
 ```
 
> **Note**: Patient PII (name, email, phone) is intentionally returned to enable dynamic placeholder replacement in terms/privacy text. Access is gated by the secure SHA-256 token.

 ### 3. Row Level Security
 
 All tables deny public access:
 
 ```sql
 -- Example: enrollments table
 CREATE POLICY "Deny public access" ON enrollments
   FOR SELECT USING (false);
 
 CREATE POLICY "Admins can view" ON enrollments
   FOR SELECT USING (is_admin(auth.uid()));
 ```
 
 ### 4. Webhook Security
 
 Stripe webhooks verified via signature:
 
 ```typescript
 const event = await stripe.webhooks.constructEventAsync(
   body,
   req.headers.get('stripe-signature'),
   Deno.env.get('STRIPE_WEBHOOK_SECRET')
 );
 ```
 
 ### 5. API Authentication
 
 | Endpoint | Auth Method |
 |----------|-------------|
 | `create-enrollment` | Shared secret header |
 | `get-enrollment` | Token in URL |
 | `create-checkout-session` | Token validation |
 | `stripe-webhook` | Stripe signature |
 | Admin functions | Lovable Cloud JWT |
 
 ---
 
 ## Environment Variables
 
 ### Lovable Cloud (Auto-configured)
 
 These variables are automatically provided by Lovable Cloud and should NOT be edited manually:
 
 | Variable | Source |
 |----------|--------|
 | `VITE_SUPABASE_URL` | Frontend - Lovable Cloud backend URL |
 | `VITE_SUPABASE_PUBLISHABLE_KEY` | Frontend - Lovable Cloud public key |
 | `VITE_SUPABASE_PROJECT_ID` | Frontend - Project identifier |
 | `SUPABASE_URL` | Edge Functions - Backend URL |
 | `SUPABASE_ANON_KEY` | Edge Functions - Public key |
 | `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions - Admin key |
 | `SUPABASE_DB_URL` | Edge Functions - Direct database URL |
 
 ### Stripe
 
 | Variable | Purpose |
 |----------|---------|
 | `STRIPE_SECRET_KEY` | API authentication |
 | `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
 
 ### Zoho CRM
 
 | Variable | Purpose |
 |----------|---------|
 | `ZOHO_CLIENT_ID` | OAuth application ID |
 | `ZOHO_CLIENT_SECRET` | OAuth application secret |
 | `ZOHO_REFRESH_TOKEN` | Long-lived API access |
 
 ### Application
 
 | Variable | Purpose |
 |----------|---------|
 | `ENROLLMENT_SHARED_SECRET` | Zoho → API authentication |
 | `APP_URL` | Base URL for generated links |
 | `LOVABLE_API_KEY` | AI gateway access (if enabled) |
 
 ---
 
 ## Deployment
 
 ### URLs
 
 | Environment | URL |
 |-------------|-----|
 | Preview | https://id-preview--6dca5097-6c96-4e95-b60d-ff792b7e78f4.lovable.app |
 | Production | https://secure-enrollment-flow.lovable.app |
 
 ### Edge Function Deployment
 
 Edge functions are automatically deployed when code changes. Manual deployment:
 
 ```bash
 # Via Lovable Cloud
 # Functions are deployed automatically on save
 ```
 
 ### Database Migrations
 
 Migrations are stored in `supabase/migrations/` and applied automatically.
 
 ---
 
 ## Troubleshooting
 
 ### Common Issues
 
 #### 1. Stripe Webhook Signature Errors
 **Error**: `SubtleCryptoProvider cannot be used in a synchronous context`
 **Solution**: Use `constructEventAsync` instead of `constructEvent`
 
 #### 2. Terms Not Showing on Regenerated Links
 **Cause**: Policy data not copied during regeneration
 **Solution**: Fetch and attach policy metadata in `regenerate-enrollment`
 
 #### 3. Cannot Regenerate Active Enrollments
 **Cause**: Original logic restricted to expired/failed only
 **Solution**: Allow regeneration for any non-paid/non-processing status
 
 #### 4. Admin Access Denied
 **Check**: 
 - `admin_users.accepted_at` is not NULL
 - `admin_users.user_id` matches `auth.uid()`
 - RLS policies allow access
 
 ---
 
 ## Future Improvements
 
- [x] ~~Zoho CRM status sync on payment events~~ (Implemented)
 - [ ] Email notifications to patients
 - [ ] Refund processing via admin dashboard
 - [ ] Multi-currency support
 - [ ] Recurring payment schedules
 - [ ] PDF receipt generation
 - [ ] Webhook retry dashboard
- [ ] Patient portal for viewing payment history
 
 ---
 
 *This document is maintained as part of the codebase. For questions or updates, refer to the project repository.*