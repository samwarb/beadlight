# Beadlight Supabase Roadmap Setup

This version uses GitHub Pages for the website and Supabase for the roadmap database and email login.

## 1. Create your Supabase project

Create a free project at Supabase.

## 2. Run the database setup

Open Supabase → SQL Editor → New query.

Paste the contents of:

```text
beadlight/supabase-setup.sql
```

Before running it, replace:

```text
YOUR_EMAIL_HERE
```

with the email address you want to use for admin login.

## 3. Add your Supabase keys

Open:

```text
beadlight/supabase-config.js
```

Paste in your Supabase Project URL and anon public key from:

```text
Supabase → Project Settings → API
```

## 4. Configure the login redirect

In Supabase, go to:

```text
Authentication → URL Configuration
```

Set Site URL to:

```text
https://merciandigital.co.uk
```

Add this redirect URL:

```text
https://merciandigital.co.uk/beadlight/admin/
```

## 5. Upload to GitHub Pages

Upload the `beadlight` folder to your existing GitHub Pages repo.

Public roadmap:

```text
https://merciandigital.co.uk/beadlight/roadmap/
```

Admin page:

```text
https://merciandigital.co.uk/beadlight/admin/
```

## 6. Log in

Go to the admin page, enter your approved admin email, open the magic link, and edit the roadmap.
