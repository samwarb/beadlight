# Beadlight Challenge Studio

This adds a Challenges link to the existing private admin dashboard at https://beadlight.app/admin/ and a new editor at https://beadlight.app/admin/challenges/ (hosted by the GitHub Pages repository).

## Features

Approved administrators can create, edit, publish, unpublish and delete 1–90 day Rosary challenges. Fields include English/Spanish titles, descriptions, daily reflections, personalised reminder templates, banner/detail/day images and accent colours.

The studio uses the existing Supabase email magic-link login. All writes require authenticated admin permissions enforced by database and Storage RLS policies. The browser uses only the public publishable API key, never a service-role key.

## Setup

1. Merge this branch into main and confirm GitHub Pages deployed the admin/challenges/ path.
2. In the EXISTING Beadlight Supabase project, run the SQL in supabase/migrations/20261113183000_challenge_admin_studio.sql one time (or apply with your normal reviewed migration process).
3. In Supabase Authentication > URL Configuration, allow https://beadlight.app/admin/challenges/ as a redirect.
4. Sign in at https://beadlight.app/admin/challenges/ using the same approved email as your existing admin dashboard.
5. Test with the Beadlight iOS 1.7.5 Challenge Progress / Images / Reminders project, or later. Older app versions without the catalogue client will not show remote challenges.

## Publishing workflow

- Choose New for a draft or select an existing row on the left.
- Set a unique slug (cannot be edited later), name, start/end date, daily reflection lines, reminder wording and colour.
- Choose PNG/JPEG/WebP images (5MB maximum each) for the banner, detail page and optionally particular days.
- Save uploads newly selected images to the public challenge-images Supabase Storage bucket. Replacements use unique file names to avoid stale cached images.
- Check Publish to make the challenge visible to the installed iOS app; uncheck it to hide again.
- English and Spanish reflections may be empty; otherwise provide one line per day, including blank lines for days without reflections. Date ranges are inclusive.
- User progress continues to be calculated on the iPhone, not in this admin site.

## Built-in Advent

To customise the bundled Advent 2026 challenge, create a published row with slug advent-2026 and dates 2026-11-29 to 2026-12-24. The iOS build merges this row with its built-in Advent reflections; it should not create a duplicate campaign. The app still needs a separate App Store Connect In-App Event submission for promotion.

## Security and cautions

Challenge artwork is deliberately PUBLIC. Never upload confidential or unlicensed images. Server-side RLS restricts edits to the existing approved admin allowlist. Test anonymous requests, non-admin authenticated requests and approved-admin requests; hiding HTML is not a security boundary. Verify your live Storage policies do not include overly broad write access to this bucket.

Deletion removes the challenge row but deliberately keeps previously uploaded images, to avoid broken image links. Unused objects can be cleaned up from Supabase later.

Test: create draft, edit, publish, upload and replace artwork, use Spanish content, try 1-day/90-day challenges, verify App Store/TestFlight app receives content, and verify redirect and signed-out access.

No secret API keys belong in this public GitHub repository.
