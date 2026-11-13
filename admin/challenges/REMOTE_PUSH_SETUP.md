# Beadlight Remote Push — Setup and operation

The private [Challenge Studio](https://beadlight.app/admin/challenges/) can compose, preview, test and send optional remote notifications to:

- Participants in a published challenge (including the always-available Daily Rosary Challenge), **only when they opted into challenge updates**.
- Users who have explicitly enabled general Beadlight announcements and offers.

Local countdown notifications and Daily Prayer Reminders do not subscribe someone to broadcasts.

## Deployment state

The SQL in `supabase/migrations/20261113214500_beadlight_remote_push.sql` was applied to the existing Beadlight Supabase project. The `beadlight-push-device` and `beadlight-push-admin` functions were deployed. The functions currently cannot send until Apple's APNs credentials are configured; this is intentional.

## Complete Apple Push setup (required)

1. In Apple Developer → Certificates, Identifiers & Profiles → Keys, create an **Apple Push Notifications service (APNs)** authentication key (or reuse an appropriate existing key). Download the **.p8** file; Apple normally permits downloading only once.
2. In the Beadlight Supabase Dashboard → **Edge Functions → Secrets**, set these exact four names and values:
   - `APNS_KEY_ID`: the 10-character Key ID from your Apple Developer key.
   - `APNS_TEAM_ID`: `7G946NA64Q` (confirm this matches the team signing your build).
   - `APNS_BUNDLE_ID`: `com.samwarburton.Beadlight` (case-sensitive).
   - `APNS_PRIVATE_KEY`: the complete content of the .p8 file, including the BEGIN/END PRIVATE KEY lines and newlines.
3. **Never** commit the .p8 key, a Supabase secret/service-role key, or push tokens to GitHub, and don't paste the .p8 key into support chats.
4. Open the included Xcode project. In the iPhone app target → Signing & Capabilities, confirm **Push Notifications** appears, and that your Apple Developer provisioning profile is enabled for remote notifications. A real signed iPhone is required for reliable testing; simulators have limitations.
5. Install the updated app on the test iPhone; go to **Rosary Challenge → Challenge announcements**. Enable **Challenge updates** or **Beadlight announcements** separately, allow iOS notifications, then press **Copy my test device ID**.
6. Open the Challenge Studio, choose the appropriate audience, paste the copied installation ID, enter a short title and message, and **Preview audience** then **Send test to my iPhone**. Type SEND to confirm.
7. Check that the test notification arrives. Once a test has been accepted by Apple, the admin dashboard permits broadcasting to eligible devices. A further confirmation and typing SEND is required each time.

## Features and limitations

- Challenge and general announcement opt-ins are **OFF by default**. No one receives marketing pushes just because they allowed Daily Prayer Reminders.
- Opting out updates server preferences. Revoking iOS notification permission is also respected on the next app launch.
- The device endpoint uses an installation-specific random proof and stores only its SHA-256 digest on the server.
- APNs tokens and registration proofs are private. Supabase table RLS and GRANTs prevent direct reads from client applications.
- Admin endpoint verifies the signed-in Supabase Auth identity against the existing admin allowlist.
- Admin history records send status and aggregate accepted/failed counts, **not** every user's token.
- Preview and send are limited to small recipient groups (maximum 150 devices per broadcast). The dashboard rejects larger audiences rather than sending a partial blast. A queue/worker will be required to scale.
- The present version supports **send now** and **test**, but **does not schedule** future remote broadcasts.
- APNs acceptance doesn't guarantee the notification was displayed on an iPhone.
- Pushes require internet connectivity and may be suppressed by device settings/Focus modes.
- New audience membership from the previously released challenge sign-up counts build is matched by installation ID. Only installed versions containing remote push registration can receive server-sent announcements.
- The app may ask for Apple's push entitlement when first built. Enable the Push Notifications capability using the existing Apple Developer team.

## Operations

If the dashboard says `credentials missing`, set the four secrets above in the correct Supabase project. They are available to the functions without a redeploy.

For errors, inspect Supabase Edge Functions → Logs for `beadlight-push-admin`. A `403` indicates the admin JWT is not valid for the allowlist; a `409` before a send indicates missing credentials, no eligible devices, no successful test, or an audience over the limit.

If Apple reports `BadDeviceToken` or `DeviceTokenNotForTopic`, check the app signing environment, team, and bundle ID. The app uses sandbox for Debug and production for TestFlight/App Store.

No notifications have been sent as part of this change. Only send to opted-in recipients after the test succeeds.
