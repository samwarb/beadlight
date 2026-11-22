# Beadlight support reliability rollout — 22 November 2026

This rollout contains a verified-email website support submission flow, a signed-in customer ticket inbox, and signed Resend outbound delivery event handling.

## What is deployed

- `supabase/functions/support-portal/index.ts` — authenticated ticket list, thread, and reply API, restricted to the Supabase Auth user's **confirmed email address**. It does not expose private admin notes.
- `supabase/functions/dynamic-endpoint/index.ts` — records email verification only when Supabase Auth confirms it, sends admin and customer emails independently, stores Resend IDs and initial delivery states, and links customers to their ticket portal.
- `supabase/functions/send-ticket-reply/index.ts` — stores replies to the database even when Resend rejects email delivery. The admin is warned, and customers with a verified sign-in can still read the response.
- `supabase/functions/receive-ticket-reply/index.ts` — verifies Resend webhook signatures and handles both existing inbound email replies and outbound email event updates.
- `support/index.html`, `es/support/index.html` — request verification via a magic-link email before website support submission; authenticated tickets record verified identity. Fallback: help@beadlight.app.
- `support/tickets/index.html` — customer ticket history and reply interface.
- `admin/admin.js` — shows ticket verification and delivery states, including failures.
- `supabase/migrations/20261122180000_support_delivery_and_verified_portal.sql` and `20261122182500_support_reply_delivery_event_statuses.sql`.

## Required one-time setup (not automated)

1. In **Supabase Dashboard → Authentication → URL Configuration**, add these exact redirect URLs:
   - `https://beadlight.app/support/`
   - `https://beadlight.app/es/support/`
   - `https://beadlight.app/support/tickets/`
   Confirm Email/OTP sign-in remains enabled and your SMTP/rate-limit settings support customer verification. Existing admin magic-link sign-in should not be removed.
2. In **Resend Dashboard → Webhooks**, edit the **existing** webhook whose URL ends with `/functions/v1/receive-ticket-reply` and currently receives `email.received`.
   **Keep `email.received` enabled.** Also subscribe to `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.bounced`, `email.complained`, `email.failed`, and `email.suppressed`, insofar as those are offered in the UI.
   Do not create a new webhook with a different signing secret unless you also securely update the Supabase `RESEND_WEBHOOK_SECRET` secret to match.
3. Allow GitHub Pages or your hosting pipeline to publish the `main` branch changes. Verify `https://beadlight.app/support/tickets/` is accessible.
4. Confirm your outbound support domain is verified and authenticated in Resend. Existing notifications are sent using `beadlight@merciandigital.co.uk`. `help@beadlight.app` is only the fallback contact address.

## Suggested acceptance tests

- Open `/support/` in a private window: submit disabled until email verified.
- Enter a reachable email, request a magic link, open it, return, and submit one test ticket.
- Confirm ticket shows `email_verified = true` in admin.
- Sign in via `/support/tickets/` with that email and confirm only that account's tickets appear.
- Send a customer portal reply: the admin ticket should reopen and show a new inbound message.
- Send an admin reply: confirm it appears in the portal even if the email fails.
- Use Resend's test destinations/events or webhook event replay to verify `email.delivered` and `email.bounced` updates. Don't send tests to real customers.
- Confirm a second unrelated signed-in account cannot read the first account's ticket.

## Important limitations

- The GitHub repository is the **website**, not the native iOS or Android app sources. The live mobile app's support screen has **not** been updated. To add an in-app ticket inbox button or native customer reply flow, update and release the native app projects separately; for now the secure web portal can be linked or opened in an in-app browser.
- Website email verification proves possession of the mailbox when opening the link, not guaranteed future deliverability.
- Older tickets were not retroactively marked as verified. Maria's original malformed email was deliberately left unchanged.
- Email webhooks only update delivery status when Resend is configured to send these events to the existing verified endpoint.
- Supabase Auth redirects and real email delivery require end-to-end testing with a test mailbox; source syntax checks and successful Edge Function deployment are not substitutes.
