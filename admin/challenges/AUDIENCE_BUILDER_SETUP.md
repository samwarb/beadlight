# Beadlight Push Audience Builder

This builds on the existing private Challenge Studio at https://beadlight.app/admin/challenges/ and the opt-in APNs push sender.

## What you can do

1. Open **Audience Builder** after signing in to Beadlight Admin.
2. Select a saved audience or click **New audience**.
3. Pick **General Beadlight announcements** or **Challenge updates** (and a challenge), then choose independent filters:
   - Subscription: Any / verified Free / Trial / Monthly / Annual / Lifetime / Expired
   - App installation age of at least N days
   - Inactive for at least N days, optionally no more than N days
   - Subscription age of at least N days
4. Save. Select **Preview matching devices**. The number shown comes from a server-side query; the browser never downloads individual token records.
5. Before a broadcast, provide title and message; pass the APNs test gate and explicit confirmations.

Three editable starter audiences have been created in Supabase: Free for 28+ days, Inactive 14+ days, and Monthly Premium for 60+ days. **They send nothing automatically.**

## Required server configuration

The Supabase migration is at `supabase/migrations/20261113221500_push_audience_builder.sql`. It was applied to the Beadlight Supabase project; both push functions were also deployed.

Set the additional **server-side-only** Supabase Edge Function secret `REVENUECAT_SECRET_API_KEY` to a valid RevenueCat REST API key with access to subscriber status. Keep the secret in Supabase Secrets, **never in GitHub or the app**. Existing APNs secrets `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID` and `APNS_PRIVATE_KEY` are also required for delivery.

The iPhone build bundled as **Beadlight 1.7.5 Audience Builder** sends the current RevenueCat app user ID as a hint. Supabase verifies the plan and entitlement with RevenueCat, caches it for up to 24 hours before re-checking on an app-open event, and does not accept a claimed Premium/Free status from the client. Unknown or stale verification is excluded from subscription-targeted audiences. The RevenueCat REST API v1 endpoint used is `GET /v1/subscribers/{app_user_id}`.

## Definitions and accuracy

- **App age** = time since the first push registration on this system, not necessarily the original App Store install date. Older installations are not backfilled.
- **Inactive for N days** = N days since the app last reported activity to the push server. Only installations with explicit push opt-in are tracked.
- **Subscription age** = the RevenueCat original purchase date for the currently verified product (when available). Unknown dates are excluded when this filter is used.
- **Free** = no active verified Premium entitlement and no prior subscription. **Expired** = prior subscription exists but Premium is no longer active.
- An app may contain multiple RevenueCat identities (anonymous or signed in) over its life; a change triggers re-verification on the next device sync. This does not identify a person uniquely across multiple iPhones.
- Subscriber filters require verification in the last seven days. For long-inactive users, combining an inactivity rule with a plan filter will often yield **zero devices** rather than relying on stale plan data. Activity-only inactive audiences still work.

## Privacy and safeguards

- Only devices that opted into the appropriate **notification category** are eligible; allowing local prayer reminders is not marketing consent.
- The only fields used for targeting are app-open timestamps, app-installation identifiers, notification preferences, and server-verified subscription data. Never target prayer content, intentions or inferred religious beliefs.
- One **general marketing** send per opted-in installation in any rolling seven-day period, enforced server-side.
- The current synchronous sender can send to at most **150 eligible devices per confirmed broadcast**. Larger audiences fail safely rather than quietly sending only part.
- APNs acceptance does not guarantee notification delivery or display.
- Admin sign-in and authorisation are checked by the server. Audience rules, push device tokens, subscription statuses and send history are inaccessible to anonymous or ordinary authenticated users via table permissions/RLS.
- The Studio can save and change targeting rules without an iOS update. New device-data fields require the updated app to be released once.
- There is no automatic/scheduled marketing campaign, no auto-send upon joining a cohort, and no campaign has been sent during this implementation.

## Tests

1. Test with a real iPhone using the updated signed Beadlight build, enable separate announcement consent.
2. Confirm the install appears as an eligible device when an audience matches.
3. Verify that an old Free account, an inactive account, and a Monthly subscriber match only their respective filters. When the RevenueCat secret is absent or subscriber verification is stale, Free/Monthly audiences must return zero.
4. Test unsubscribing from general announcements (device becomes ineligible).
5. Confirm the current APNs test and send confirmation gates still block accidental broadcasts.
6. Verify frequency cap after sending a **test-only** message; never test full broadcast against real users without approval.

No live notification broadcast has been sent by the deployment.
