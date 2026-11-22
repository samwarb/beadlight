import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
  "SUPABASE_SERVICE_ROLE_KEY"
);

const SUPPORT_TO_EMAIL = "beadlight@merciandigital.co.uk";
const SUPPORT_FROM_EMAIL =
  "Beadlight <beadlight@merciandigital.co.uk>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      {
        error: "Method not allowed"
      },
      405
    );
  }

  if (!RESEND_API_KEY) {
    return jsonResponse(
      {
        error: "Missing RESEND_API_KEY secret in Supabase."
      },
      500
    );
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(
      {
        error:
          "Missing Supabase database environment variables."
      },
      500
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
    const body = await req.json();

    const name = clean(body.name);
    const email = clean(body.email).toLowerCase();
    const type = clean(body.type);
    const priorityInput = clean(body.priority || "Normal");
    const subject = clean(body.subject);
    const message = clean(body.message);
    const device = clean(body.device || "Not provided");

    // Only Supabase Auth can confirm an email address. Never trust a
    // verified flag sent by the browser or the mobile app.
    let verifiedUserId: string | null = null;
    const bearer = (req.headers.get("Authorization") || "")
      .replace(/^Bearer\s+/i, "").trim();
    if (bearer && bearer.split(".").length === 3) {
      const { data: auth, error: authError } = await supabaseAdmin.auth.getUser(bearer);
      if (authError || !auth?.user) {
        return jsonResponse({ error: "Your support session has expired. Please verify your email again." }, 401);
      }
      if (!auth.user.email_confirmed_at ||
          auth.user.email?.trim().toLowerCase() !== email ||
          auth.user.is_anonymous) {
        return jsonResponse({ error: "Please verify the email address you are using to contact support." }, 403);
      }
      verifiedUserId = auth.user.id;
    }

    if (!name || !email || !type || !subject || !message) {
      return jsonResponse(
        {
          error: "Missing required fields."
        },
        400
      );
    }

    if (!isValidEmail(email)) {
      return jsonResponse(
        {
          error: "Please check your email address. We need a valid address so we can reply to your ticket."
        },
        400
      );
    }

    const priority = normalisePriority(priorityInput);
    const priorityLabel = formatLabel(priority);
    const ticketReference = createTicketReference();

    /*
     * Save the ticket before sending either email.
     * This ensures every successful submission has a database record.
     */
    const { data: createdTicket, error: ticketError } =
      await supabaseAdmin
        .from("support_tickets")
        .insert({
          ticket_reference: ticketReference,
          name,
          email,
          ticket_type: type,
          subject,
          message,
          device_details: device,
          status: "open",
          priority,
          customer_user_id: verifiedUserId,
          email_verified: Boolean(verifiedUserId),
          notification_delivery_status: "pending",
          acknowledgement_delivery_status: "pending"
        })
        .select("id, ticket_reference")
        .single();

    if (ticketError) {
      console.error("Ticket database insert failed:", ticketError);

      return jsonResponse(
        {
          error:
            "Your support ticket could not be created. Please try again.",
          details: ticketError.message
        },
        500
      );
    }

    const supportEmailSubject =
      `[Beadlight ${type}] ${subject}`;

    const supportTextBody = `
Beadlight Support Ticket

Reference: ${ticketReference}

Name: ${name}
Email: ${email}
Type: ${type}
Priority: ${priorityLabel}
Device / app details: ${device}

Message:
${message}

---
Sent from the Beadlight support page.
`.trim();

    const supportHtmlBody = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #202431;">
        <h2>Beadlight Support Ticket</h2>

        <p><strong>Reference:</strong> ${escapeHtml(ticketReference)}</p>
        <p><strong>Name:</strong> ${escapeHtml(name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(email)}</p>
        <p><strong>Type:</strong> ${escapeHtml(type)}</p>
        <p><strong>Priority:</strong> ${escapeHtml(priorityLabel)}</p>
        <p><strong>Device / app details:</strong> ${escapeHtml(device)}</p>

        <hr>

        <h3>Message</h3>
        <p>${escapeHtml(message).replaceAll("\n", "<br>")}</p>

        <hr>

        <p style="font-size: 12px; color: #777;">
          Sent from the Beadlight support page.
        </p>
      </div>
    `;

    const userEmailSubject =
      `We received your Beadlight ticket: ${subject}`;

    const userTextBody = `
Hi ${name},

Thanks for contacting Beadlight.

We've received your support ticket and will review it as soon as possible.

Ticket reference: ${ticketReference}
Ticket type: ${type}
Priority: ${priorityLabel}
Subject: ${subject}

Your message:
${message}

You can reply to this email, or visit https://beadlight.app/support/tickets/ to view your support conversation.

Thank you,
Beadlight Support
`.trim();

    const userHtmlBody = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #202431;">
        <h2>Thanks for contacting Beadlight</h2>

        <p>Hi ${escapeHtml(name)},</p>

        <p>
          We've received your support ticket and will review it as soon as possible.
        </p>

        <div style="background: #fff8e8; border: 1px solid #f1d49a; padding: 16px; border-radius: 12px; margin: 18px 0;">
          <p>
            <strong>Ticket reference:</strong>
            ${escapeHtml(ticketReference)}
          </p>

          <p>
            <strong>Ticket type:</strong>
            ${escapeHtml(type)}
          </p>

          <p>
            <strong>Priority:</strong>
            ${escapeHtml(priorityLabel)}
          </p>

          <p>
            <strong>Subject:</strong>
            ${escapeHtml(subject)}
          </p>
        </div>

        <h3>Your message</h3>

        <p>
          ${escapeHtml(message).replaceAll("\n", "<br>")}
        </p>

        <p>
          You can reply to this email, or visit https://beadlight.app/support/tickets/ to view your support conversation.
        </p>

        <p>
          Thank you,<br>
          Beadlight Support
        </p>
      </div>
    `;

    const supportEmailResult = await sendEmail({
      from: SUPPORT_FROM_EMAIL,
      to: [SUPPORT_TO_EMAIL],
      // Keep admin notification delivery independent of the customer address.
      // Admins reply from the Beadlight ticket dashboard instead.
      reply_to: SUPPORT_TO_EMAIL,
      subject: supportEmailSubject,
      text: supportTextBody,
      html: supportHtmlBody
    });

    if (supportEmailResult.ok) {
      const { error: emailLogError } = await supabaseAdmin.from("support_tickets")
        .update({ notification_email_id: supportEmailResult.payload.id || null,
                  notification_delivery_status: "sent" }).eq("id", createdTicket.id);
      if (emailLogError) console.error("Notification status update failed", emailLogError);
    }

    if (!supportEmailResult.ok) {
      console.error(
        "Support email failed:",
        supportEmailResult.payload
      );
      await supabaseAdmin.from("support_tickets")
        .update({ notification_delivery_status: "failed",
                  delivery_last_error: String(supportEmailResult.payload?.error || "Notification send failed").slice(0,1000) })
        .eq("id", createdTicket.id);

      // Still attempt the customer's acknowledgement; the two deliveries
      // must be independent so a notification outage does not mask a ticket.
    }

    const acknowledgementResult = await sendEmail({
      from: SUPPORT_FROM_EMAIL,
      to: [email],
      reply_to: `${ticketReference}@yeeerkoul.resend.app`,
      subject: userEmailSubject,
      text: userTextBody,
      html: userHtmlBody
    });

    if (acknowledgementResult.ok) {
      const { error: acknowledgementLogError } = await supabaseAdmin.from("support_tickets")
        .update({ acknowledgement_email_id: acknowledgementResult.payload.id || null,
                  acknowledgement_delivery_status: "sent" }).eq("id", createdTicket.id);
      if (acknowledgementLogError) console.error("Acknowledgement status update failed", acknowledgementLogError);
    }

    if (!acknowledgementResult.ok) {
      console.error(
        "Acknowledgement email failed:",
        acknowledgementResult.payload
      );
      await supabaseAdmin.from("support_tickets")
        .update({ acknowledgement_delivery_status: "failed",
                  delivery_last_error: String(acknowledgementResult.payload?.error || "Acknowledgement send failed").slice(0,1000) })
        .eq("id", createdTicket.id);

      return jsonResponse(
        {
          success: true,
          ticketCreated: true,
          ticketId: createdTicket.id,
          ticketReference,
          supportEmailId: supportEmailResult.ok ? supportEmailResult.payload.id : null,
          warning: supportEmailResult.ok
            ? "Your ticket was saved, but the acknowledgement email could not be sent. Please keep the ticket reference for your records."
            : "Your ticket was saved, but both support notification and acknowledgement email failed. Please keep the reference."
        },
        200
      );
    }

    return jsonResponse(
      {
        success: true,
        ticketCreated: true,
        ticketId: createdTicket.id,
        ticketReference,
        supportEmailId: supportEmailResult.ok ? supportEmailResult.payload.id : null,
        acknowledgementEmailId: acknowledgementResult.payload.id,
        warning: supportEmailResult.ok ? null
          : "Your ticket was saved and acknowledged, but the admin notification could not be delivered."
      },
      200
    );
  } catch (error) {
    console.error("Unexpected contact function error:", error);

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

async function sendEmail(payload: {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const response = await fetch(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      payload: {
        error:
          data?.message ||
          data?.error ||
          "Could not send email through Resend.",
        details: data
      }
    };
  }

  return {
    ok: true,
    status: response.status,
    payload: data
  };
}

function clean(value: unknown): string {
  return String(value || "")
    .trim()
    .slice(0, 5000);
}

function normalisePriority(
  value: string
): "low" | "normal" | "high" | "urgent" {
  const normalised = value.trim().toLowerCase();

  if (
    normalised === "low" ||
    normalised === "normal" ||
    normalised === "high" ||
    normalised === "urgent"
  ) {
    return normalised;
  }

  return "normal";
}

function formatLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isValidEmail(value: string): boolean {
  // Check domain labels individually. A permissive email regex accepted
  // addresses like privaterelay.appleid.-.com, which Resend rejects.
  const address = value.trim();
  if (address.length > 254 || /\s/.test(address)) return false;
  const atIndex = address.lastIndexOf("@");
  if (atIndex <= 0 || atIndex !== address.indexOf("@")) return false;

  const local = address.slice(0, atIndex);
  const domain = address.slice(atIndex + 1);
  if (
    local.length > 64 ||
    !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  ) return false;

  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((label) =>
    label.length <= 63 &&
    /^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/i.test(label)
  );
}

function createTicketReference(): string {
  const date = new Date();

  const datePart = date
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");

  const randomPart = Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase();

  return `BL-${datePart}-${randomPart}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return map[char];
  });
}

function jsonResponse(
  payload: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}