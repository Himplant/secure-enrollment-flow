# Secure Enrollment Payments Platform

## Project info

**URL**: https://lovable.dev/projects/6dca5097-6c96-4e95-b60d-ff792b7e78f4

**Production**: https://secure-enrollment-flow.lovable.app

## Overview

A medical-grade enrollment and payment collection platform designed to:
- Generate secure, single-use payment links from Zoho CRM
- Collect Credit Card and ACH payments via Stripe Checkout
- Maintain complete audit trails with enforceable consent
- Automatically sync payment status back to Zoho CRM

## Documentation

For detailed technical documentation, see **[docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)**.

## Technology Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS, shadcn/ui
- **Backend**: Lovable Cloud (PostgreSQL, Edge Functions, Auth)
- **Payments**: Stripe Checkout Sessions + Webhooks
- **CRM**: Zoho CRM API integration

## Key Features

- **Secure Token Links**: SHA-256 hashed tokens, never stored in plain text
- **Terms Consent Tracking**: Version control with content hashing
- **Row Level Security**: All tables protected with restrictive RLS policies
- **Admin Dashboard**: Patient, transaction, policy, and surgeon management
- **Dynamic Policies**: Rich text editor with placeholder support

## Local Development

```bash
# Clone and install
git clone <YOUR_GIT_URL>
cd <PROJECT_NAME>
npm install

# Start development server
npm run dev
```

## Environment Variables

Environment variables are managed through Lovable Cloud. See the [Developer Guide](docs/DEVELOPER_GUIDE.md#environment-variables) for details.

## Edge Functions

| Function | Purpose |
|----------|---------|
| `create-enrollment` | Create enrollment from Zoho CRM |
| `get-enrollment` | Fetch enrollment for patient view |
| `create-checkout-session` | Create Stripe Checkout Session |
| `stripe-webhook` | Handle Stripe payment events |
| `regenerate-enrollment` | Generate new link for existing enrollment |
| `admin-create-enrollment` | Create enrollment from admin dashboard |
| `sync-surgeons` | Sync surgeons from Zoho CRM |
| `send-admin-invite` | Send admin user invites |

## Deployment

Deployed automatically via Lovable. Click **Share → Publish** to deploy frontend changes. Edge functions deploy automatically on save.
