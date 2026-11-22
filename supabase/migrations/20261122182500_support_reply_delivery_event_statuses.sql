alter table public.support_ticket_replies
  drop constraint if exists support_ticket_replies_delivery_status_check;
alter table public.support_ticket_replies
  add constraint support_ticket_replies_delivery_status_check
  check (delivery_status in
    ('pending','sent','delivered','delayed','bounced','complained','suppressed','failed','received'));
