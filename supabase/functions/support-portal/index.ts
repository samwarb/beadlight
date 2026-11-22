import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL") || "";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const SUPPORT_EMAIL = "beadlight@merciandigital.co.uk";
const cors = {
  "Access-Control-Allow-Origin": "https://beadlight.app",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { ...cors, "Content-Type": "application/json" }
});

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  if (!URL || !KEY) return reply({ error: "Support service is not configured" }, 503);

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return reply({ error: "Please sign in to view your support tickets." }, 401);

  const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authError } = await db.auth.getUser(token);
  if (authError || !user || !user.email || !user.email_confirmed_at || user.is_anonymous) {
    return reply({ error: "Please verify your email address before accessing support tickets." }, 401);
  }

  const verifiedEmail = user.email.trim().toLowerCase();
  let body: any;
  try { body = await request.json(); }
  catch { return reply({ error: "Invalid request body." }, 400); }
  const action = String(body?.action || "");

  try {
    if (action === "list") {
      // Match the verified mailbox only. Do not return private admin notes.
      const { data, error } = await db.from("support_tickets")
        .select("id,ticket_reference,subject,status,created_at,updated_at,last_replied_at,last_customer_reply_at,acknowledgement_delivery_status")
        .eq("email", verifiedEmail)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return reply({ tickets: data || [], email: verifiedEmail });
    }

    if (action !== "thread" && action !== "reply") {
      return reply({ error: "Unknown support action." }, 400);
    }

    const ticketId = String(body?.ticketId || "");
    if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return reply({ error: "Invalid ticket." }, 400);

    const { data: ticket, error: ticketError } = await db.from("support_tickets")
      .select("id,ticket_reference,subject,message,status,created_at,email")
      .eq("id", ticketId).eq("email", verifiedEmail).maybeSingle();
    if (ticketError) throw ticketError;
    if (!ticket) return reply({ error: "Ticket not found for this verified email address." }, 404);

    if (action === "thread") {
      const { data, error } = await db.from("support_ticket_replies")
        .select("id,direction,message,delivery_status,created_at,sent_at,received_at")
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: true }).limit(250);
      if (error) throw error;
      return reply({
        ticket: { id: ticket.id, ticket_reference: ticket.ticket_reference,
                  subject: ticket.subject, message: ticket.message, status: ticket.status,
                  created_at: ticket.created_at },
        replies: data || []
      });
    }

    const message = String(body?.message || "").trim();
    if (!message || message.length > 10000) {
      return reply({ error: "Please enter a reply of up to 10,000 characters." }, 400);
    }

    // Basic per-ticket cooldown to avoid accidental duplicates and automated flooding.
    const { data: latest, error: latestError } = await db.from("support_ticket_replies")
      .select("created_at").eq("ticket_id", ticket.id).eq("direction", "inbound")
      .eq("sender_email", verifiedEmail).order("created_at", { ascending: false }).limit(1);
    if (latestError) throw latestError;
    if (latest?.length && Date.now() - Date.parse(latest[0].created_at) < 30000) {
      return reply({ error: "Please wait 30 seconds before sending another message." }, 429);
    }

    const { data: saved, error: saveError } = await db.from("support_ticket_replies")
      .insert({
        ticket_id: ticket.id, direction: "inbound", sender_email: verifiedEmail,
        recipient_email: SUPPORT_EMAIL, subject: "Re: " + ticket.ticket_reference,
        message, delivery_status: "received", is_read: false,
        received_at: new Date().toISOString()
      }).select("id").single();
    if (saveError) throw saveError;

    const { error: updateError } = await db.from("support_tickets")
      .update({ status: "open", has_unread_customer_reply: true,
                last_customer_reply_at: new Date().toISOString() })
      .eq("id", ticket.id);
    if (updateError) console.error("Ticket update failed after reply insert", updateError);

    // Best effort admin notification: saving a portal message never depends on email delivery.
    if (RESEND_KEY) {
      try {
        const n = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Beadlight Support <beadlight@merciandigital.co.uk>",
            to: [SUPPORT_EMAIL], reply_to: verifiedEmail,
            subject: `[Beadlight ticket ${ticket.ticket_reference}] New customer reply`,
            text: `A customer has replied to ticket ${ticket.ticket_reference}.\n\n${message}\n\nOpen https://beadlight.app/admin/ to reply.`
          })
        });
        if (!n.ok) console.error("Portal reply notification failed", n.status);
      } catch (error) { console.error("Portal reply notification error", error); }
    }
    return reply({ success: true, replyId: saved.id, ticketReference: ticket.ticket_reference });
  } catch (error) {
    console.error("Support portal error", error);
    return reply({ error: "We could not complete this request. Please try again." }, 500);
  }
});