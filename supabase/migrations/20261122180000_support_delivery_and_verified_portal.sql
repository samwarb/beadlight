-- Beadlight support reliability: verified ownership and delivery telemetry.
alter table public.support_tickets
  add column if not exists customer_user_id uuid references auth.users(id) on delete set null,
  add column if not exists email_verified boolean not null default false,
  add column if not exists notification_email_id text,
  add column if not exists notification_delivery_status text not null default 'unknown',
  add column if not exists acknowledgement_email_id text,
  add column if not exists acknowledgement_delivery_status text not null default 'unknown',
  add column if not exists delivery_last_error text;

create index if not exists support_tickets_email_lookup_idx
  on public.support_tickets (lower(email));
create index if not exists support_tickets_notification_email_idx
  on public.support_tickets (notification_email_id)
  where notification_email_id is not null;
create index if not exists support_tickets_ack_email_idx
  on public.support_tickets (acknowledgement_email_id)
  where acknowledgement_email_id is not null;
create index if not exists support_ticket_replies_resend_idx
  on public.support_ticket_replies (resend_email_id)
  where resend_email_id is not null;

alter table public.support_tickets
  add constraint support_notification_delivery_status_check
    check (notification_delivery_status in ('unknown','pending','sent','delivered','delayed','bounced','complained','suppressed','failed')),
  add constraint support_acknowledgement_delivery_status_check
    check (acknowledgement_delivery_status in ('unknown','pending','sent','delivered','delayed','bounced','complained','suppressed','failed'));

comment on column public.support_tickets.email_verified is 'Set only by server after checking a confirmed Supabase Auth email; never trust client flags.';
comment on column public.support_tickets.customer_user_id is 'Verified account identity when ticket is created by authenticated user; legacy records remain null.';
-- Both tables continue to be readable only by admins through existing RLS. Customer portal uses JWT-verified Edge Function and a filtered service-role query.