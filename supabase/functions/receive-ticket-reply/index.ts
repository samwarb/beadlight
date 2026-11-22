import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Resend } from "npm:resend";

const RESEND_RECEIVE_FULL_KEY = (
  Deno.env.get("RESEND_RECEIVE_FULL_KEY") || ""
).trim();

const RESEND_WEBHOOK_SECRET = (
  Deno.env.get("RESEND_WEBHOOK_SECRET") || ""
).trim();

const SUPABASE_URL = (
  Deno.env.get("SUPABASE_URL") || ""
).trim();

const SUPABASE_SERVICE_ROLE_KEY = (
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
).trim();

const RECEIVING_DOMAIN = "yeeerkoul.resend.app";

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse(
      {
        error: "Method not allowed."
      },
      405
    );
  }

  if (
    !RESEND_RECEIVE_FULL_KEY ||
    !RESEND_WEBHOOK_SECRET ||
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    console.error("Required Edge Function secrets are missing.");

    return jsonResponse(
      {
        error: "Function is not fully configured.",
        receiveKeyLoaded: RESEND_RECEIVE_FULL_KEY.length > 0,
        webhookSecretLoaded: RESEND_WEBHOOK_SECRET.length > 0,
        supabaseUrlLoaded: SUPABASE_URL.length > 0,
        serviceRoleKeyLoaded: SUPABASE_SERVICE_ROLE_KEY.length > 0
      },
      500
    );
  }

  const rawBody = await req.text();

  const svixId = req.headers.get("svix-id") || "";
  const svixTimestamp =
    req.headers.get("svix-timestamp") || "";
  const svixSignature =
    req.headers.get("svix-signature") || "";

  if (!svixId || !svixTimestamp || !svixSignature) {
    return jsonResponse(
      {
        error: "Missing webhook signature headers."
      },
      400
    );
  }

  const resend = new Resend(RESEND_RECEIVE_FULL_KEY);

  let event: any;

  try {
    event = await resend.webhooks.verify({
      payload: rawBody,
      headers: {
        id: svixId,
        timestamp: svixTimestamp,
        signature: svixSignature
      },
      webhookSecret: RESEND_WEBHOOK_SECRET
    });
  } catch (error) {
    console.error("Invalid Resend webhook signature:", error);

    return jsonResponse(
      {
        error: "Invalid webhook signature."
      },
      400
    );
  }

  // The same signature-verified Resend webhook also processes outbound
  // delivery events when enabled in Resend's webhook event subscriptions.
  // This does not change the existing email.received behaviour.
  const deliveryEventTypes = new Map([
    ["email.sent", "sent"],
    ["email.delivered", "delivered"],
    ["email.delivery_delayed", "delayed"],
    ["email.bounced", "bounced"],
    ["email.complained", "complained"],
    ["email.failed", "failed"],
    ["email.suppressed", "suppressed"]
  ]);
  const eventStatus = deliveryEventTypes.get(String(event?.type || ""));
  if (eventStatus) {
    const outgoingId = clean(event?.data?.email_id, 500);
    if (!outgoingId) return jsonResponse({ error: "Missing outgoing email ID." }, 400);
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const errorText = clean(
      event?.data?.bounce?.message || event?.data?.error?.message ||
      event?.data?.reason || "", 1000
    );
    const terminal = new Set(["delivered", "bounced", "complained", "failed", "suppressed"]);
    const isFailure = new Set(["bounced", "complained", "failed", "suppressed"]).has(eventStatus);

    for (const [idColumn, statusColumn] of [
      ["notification_email_id", "notification_delivery_status"],
      ["acknowledgement_email_id", "acknowledgement_delivery_status"]
    ]) {
      const { data: matched, error: findError } = await db.from("support_tickets")
        .select("id," + statusColumn).eq(idColumn, outgoingId).maybeSingle();
      if (findError) {
        console.error("Email delivery ticket lookup failed", findError);
        return jsonResponse({ error: "Delivery ticket lookup failed." }, 500);
      }
      if (matched && (!terminal.has(matched[statusColumn]) || matched[statusColumn] === eventStatus)) {
        const updates: Record<string, string> = { [statusColumn]: eventStatus };
        if (isFailure) updates.delivery_last_error = errorText || "Email delivery failed";
        const { error: updateError } = await db.from("support_tickets")
          .update(updates).eq("id", matched.id);
        if (updateError) {
          console.error("Delivery ticket update failed", updateError);
          return jsonResponse({ error: "Delivery ticket update failed." }, 500);
        }
      }
    }

    const { data: outbound, error: replyFindError } = await db.from("support_ticket_replies")
      .select("id,delivery_status").eq("resend_email_id", outgoingId).maybeSingle();
    if (replyFindError) return jsonResponse({ error: "Delivery reply lookup failed." }, 500);
    if (outbound && !(terminal.has(outbound.delivery_status) &&
                      outbound.delivery_status !== eventStatus)) {
      const { error: replyUpdateError } = await db.from("support_ticket_replies")
        .update({
          delivery_status: eventStatus,
          error_message: isFailure ? (errorText || "Email delivery failed") : null
        }).eq("id", outbound.id);
      if (replyUpdateError) return jsonResponse({ error: "Reply delivery update failed." }, 500);
    }
    return jsonResponse({ success: true, eventType: event?.type, matched: true });
  }

  if (event?.type !== "email.received") {
    return jsonResponse({
      success: true,
      ignored: true,
      eventType: event?.type || "unknown"
    });
  }

  const receivedEmailId = clean(
    event?.data?.email_id,
    500
  );

  if (!receivedEmailId) {
    return jsonResponse(
      {
        error: "The webhook did not contain an email ID."
      },
      400
    );
  }

  const supabaseAdmin = createClient(
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    }
  );

  try {
    const {
      data: existingReply,
      error: duplicateCheckError
    } = await supabaseAdmin
      .from("support_ticket_replies")
      .select("id")
      .eq(
        "resend_received_email_id",
        receivedEmailId
      )
      .maybeSingle();

    if (duplicateCheckError) {
      console.error(
        "Duplicate check failed:",
        duplicateCheckError
      );

      return jsonResponse(
        {
          error: "Could not check the incoming email."
        },
        500
      );
    }

    if (existingReply) {
      return jsonResponse({
        success: true,
        duplicate: true,
        replyId: existingReply.id
      });
    }

    const receivedEmailResponse = await fetch(
      `https://api.resend.com/emails/receiving/${encodeURIComponent(
        receivedEmailId
      )}`,
      {
        method: "GET",
        headers: {
          Authorization:
            `Bearer ${RESEND_RECEIVE_FULL_KEY}`,
          Accept: "application/json"
        }
      }
    );

    const receivedEmail = await receivedEmailResponse
      .json()
      .catch(() => ({}));

    if (!receivedEmailResponse.ok) {
      console.error(
        "Could not retrieve received email:",
        receivedEmail
      );

      return jsonResponse(
        {
          error:
            receivedEmail?.message ||
            receivedEmail?.error ||
            "Could not retrieve the incoming email.",
          keyLoaded:
            RESEND_RECEIVE_FULL_KEY.length > 0,
          keyStartsCorrectly:
            RESEND_RECEIVE_FULL_KEY.startsWith("re_"),
          keyLength:
            RESEND_RECEIVE_FULL_KEY.length
        },
        receivedEmailResponse.status || 502
      );
    }

    const recipients = normalizeAddressList(
      receivedEmail?.to ||
        event?.data?.to ||
        []
    );

    const ticketRecipient = recipients.find(
      (address) =>
        address.endsWith(
          `@${RECEIVING_DOMAIN}`
        )
    );

    if (!ticketRecipient) {
      return jsonResponse({
        success: true,
        ignored: true,
        reason:
          "No Beadlight ticket recipient was found.",
        recipients
      });
    }

    const ticketReference =
      extractTicketReference(ticketRecipient);

    if (!ticketReference) {
      return jsonResponse({
        success: true,
        ignored: true,
        reason:
          "The recipient did not contain a valid ticket reference.",
        ticketRecipient
      });
    }

    const {
      data: ticket,
      error: ticketError
    } = await supabaseAdmin
      .from("support_tickets")
      .select(
        "id,ticket_reference,name,email,status"
      )
      .ilike(
        "ticket_reference",
        ticketReference
      )
      .maybeSingle();

    if (ticketError) {
      console.error(
        "Ticket lookup failed:",
        ticketError
      );

      return jsonResponse(
        {
          error:
            "Could not match the email to a support ticket.",
          details: ticketError.message
        },
        500
      );
    }

    if (!ticket) {
      return jsonResponse({
        success: true,
        ignored: true,
        reason: "No matching support ticket exists.",
        ticketReference
      });
    }

    const senderEmail = extractEmailAddress(
      receivedEmail?.from ||
        event?.data?.from ||
        ""
    );

    if (
      normalizeEmail(senderEmail) !==
      normalizeEmail(ticket.email)
    ) {
      console.warn(
        "Ignored customer reply because sender did not match ticket email.",
        {
          ticketReference,
          senderEmail,
          expectedEmail: ticket.email
        }
      );

      return jsonResponse({
        success: true,
        ignored: true,
        reason:
          "The sender did not match the ticket customer.",
        senderEmail
      });
    }

    const subject =
      clean(
        receivedEmail?.subject ||
          event?.data?.subject ||
          `Reply to ${ticket.ticket_reference}`,
        500
      ) || `Reply to ${ticket.ticket_reference}`;

    const message = getReceivedMessage(
      receivedEmail?.text,
      receivedEmail?.html
    );

    if (!message) {
      return jsonResponse({
        success: true,
        ignored: true,
        reason:
          "The incoming email did not contain a readable message."
      });
    }

    const receivedAt =
      clean(
        receivedEmail?.created_at ||
          event?.data?.created_at,
        100
      ) || new Date().toISOString();

    const messageId =
      clean(
        receivedEmail?.message_id ||
          event?.data?.message_id,
        1000
      ) || null;

    const {
      data: reply,
      error: replyError
    } = await supabaseAdmin
      .from("support_ticket_replies")
      .insert({
        ticket_id: ticket.id,
        direction: "inbound",
        sender_email: senderEmail,
        recipient_email: ticketRecipient,
        subject,
        message,
        delivery_status: "received",
        resend_received_email_id: receivedEmailId,
        message_id: messageId,
        received_at: receivedAt,
        is_read: false
      })
      .select("id")
      .single();

    if (replyError || !reply) {
      if (replyError?.code === "23505") {
        return jsonResponse({
          success: true,
          duplicate: true
        });
      }

      console.error(
        "Could not save incoming customer reply:",
        replyError
      );

      return jsonResponse(
        {
          error: "Could not save the customer reply.",
          details: replyError?.message || null
        },
        500
      );
    }

    const {
      error: ticketUpdateError
    } = await supabaseAdmin
      .from("support_tickets")
      .update({
        status: "open",
        last_customer_reply_at: receivedAt,
        has_unread_customer_reply: true
      })
      .eq("id", ticket.id);

    if (ticketUpdateError) {
      console.error(
        "Reply saved but ticket update failed:",
        ticketUpdateError
      );

      return jsonResponse({
        success: true,
        replyId: reply.id,
        ticketReference: ticket.ticket_reference,
        warning:
          "The reply was saved, but the ticket status was not updated."
      });
    }

    return jsonResponse({
      success: true,
      replyId: reply.id,
      ticketReference: ticket.ticket_reference,
      senderEmail
    });
  } catch (error) {
    console.error(
      "Unexpected receive-ticket-reply error:",
      error
    );

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected error."
      },
      500
    );
  }
});

function normalizeAddressList(
  value: unknown
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((address) =>
      extractEmailAddress(address)
    )
    .filter(Boolean);
}

function extractEmailAddress(
  value: unknown
): string {
  const text = String(value || "").trim();

  const angleBracketMatch =
    text.match(/<([^<>]+)>/);

  const address = angleBracketMatch
    ? angleBracketMatch[1]
    : text;

  return address
    .trim()
    .toLowerCase();
}

function extractTicketReference(
  recipient: string
): string | null {
  const localPart =
    recipient.split("@")[0] || "";

  const decoded = decodeURIComponent(
    localPart
  ).trim();

  const match = decoded.match(
    /^BL-\d{8}-[A-Z0-9]{5,6}$/i
  );

  return match
    ? match[0].toUpperCase()
    : null;
}

function getReceivedMessage(
  textValue: unknown,
  htmlValue: unknown
): string {
  const text = clean(textValue, 20000);

  if (text) {
    return text;
  }

  const html = String(
    htmlValue || ""
  ).slice(0, 100000);

  if (!html) {
    return "";
  }

  return clean(
    html
      .replace(
        /<style[\s\S]*?<\/style>/gi,
        " "
      )
      .replace(
        /<script[\s\S]*?<\/script>/gi,
        " "
      )
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " "),
    20000
  );
}

function normalizeEmail(
  value: unknown
): string {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function clean(
  value: unknown,
  maximumLength: number
): string {
  return String(value || "")
    .trim()
    .slice(0, maximumLength);
}

function jsonResponse(
  payload: unknown,
  status = 200
): Response {
  return new Response(
    JSON.stringify(payload),
    {
      status,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}