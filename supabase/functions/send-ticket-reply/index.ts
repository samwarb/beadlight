import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get(
  "SUPABASE_SERVICE_ROLE_KEY"
);

const SUPPORT_EMAIL = "beadlight@merciandigital.co.uk";
const SUPPORT_FROM_EMAIL =
  "Beadlight Support <beadlight@merciandigital.co.uk>";

const RECEIVING_DOMAIN = "yeeerkoul.resend.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const allowedStatuses = new Set([
  "keep",
  "open",
  "in_progress",
  "waiting_for_customer",
  "resolved",
  "closed"
]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      {
        error: "Method not allowed."
      },
      405
    );
  }

  if (
    !RESEND_API_KEY ||
    !SUPABASE_URL ||
    !SUPABASE_SERVICE_ROLE_KEY
  ) {
    return jsonResponse(
      {
        error:
          "Required Edge Function secrets are missing."
      },
      500
    );
  }

  const authorization =
    req.headers.get("Authorization") || "";

  const accessToken = authorization
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!accessToken) {
    return jsonResponse(
      {
        error:
          "You must be signed in to send a reply."
      },
      401
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
      data: { user },
      error: userError
    } = await supabaseAdmin.auth.getUser(
      accessToken
    );

    if (userError || !user) {
      return jsonResponse(
        {
          error:
            "Your admin session is invalid or has expired."
        },
        401
      );
    }

    const {
      data: adminMembership,
      error: adminError
    } = await supabaseAdmin
      .from("admin_users")
      .select("user_id,email")
      .eq("user_id", user.id)
      .maybeSingle();

    if (adminError) {
      console.error(
        "Admin membership check failed:",
        adminError
      );

      return jsonResponse(
        {
          error:
            "Could not verify administrator access."
        },
        500
      );
    }

    if (!adminMembership) {
      return jsonResponse(
        {
          error:
            "You are not authorised to send ticket replies."
        },
        403
      );
    }

    const body = await req.json();

    const ticketId = clean(
      body.ticketId,
      100
    );

    const subject = clean(
      body.subject,
      200
    );

    const message = clean(
      body.message,
      10000
    );

    const statusAfterSend = clean(
      body.statusAfterSend ||
        "waiting_for_customer",
      50
    );

    if (
      !ticketId ||
      !subject ||
      !message
    ) {
      return jsonResponse(
        {
          error:
            "Ticket, subject and message are required."
        },
        400
      );
    }

    if (
      !allowedStatuses.has(
        statusAfterSend
      )
    ) {
      return jsonResponse(
        {
          error:
            "The selected ticket status is invalid."
        },
        400
      );
    }

    const {
      data: ticket,
      error: ticketError
    } = await supabaseAdmin
      .from("support_tickets")
      .select(
        "id,ticket_reference,name,email,subject,status"
      )
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticket) {
      return jsonResponse(
        {
          error:
            "The support ticket could not be found."
        },
        404
      );
    }

    if (!isValidEmail(ticket.email)) {
      return jsonResponse(
        {
          error:
            "This ticket has an invalid customer email address. Verify the customer's correct address and update the ticket before replying."
        },
        400
      );
    }

    const adminEmail =
      user.email ||
      adminMembership.email ||
      SUPPORT_EMAIL;

    /*
     * This is the address the customer will reply to.
     * The ticket reference lets the inbound webhook match
     * their email to the correct support ticket.
     */
    const ticketReplyAddress =
      `${ticket.ticket_reference}@${RECEIVING_DOMAIN}`;

    const {
      data: replyRecord,
      error: replyInsertError
    } = await supabaseAdmin
      .from("support_ticket_replies")
      .insert({
        ticket_id: ticket.id,
        direction: "outbound",
        sender_email: SUPPORT_EMAIL,
        recipient_email: ticket.email,
        subject,
        message,
        delivery_status: "pending",
        sent_by_user_id: user.id,
        sent_by_email: adminEmail
      })
      .select("id")
      .single();

    if (
      replyInsertError ||
      !replyRecord
    ) {
      console.error(
        "Could not create pending reply record:",
        replyInsertError
      );

      return jsonResponse(
        {
          error:
            "Could not prepare the reply for sending."
        },
        500
      );
    }

    const emailPayload = {
      from: SUPPORT_FROM_EMAIL,
      to: [ticket.email],

      /*
       * When the customer presses Reply, their response
       * goes to the ticket-specific Resend address.
       */
      reply_to: ticketReplyAddress,

      subject,

      text: buildTextEmail(
        ticket.name,
        ticket.ticket_reference,
        message
      ),

      html: buildHtmlEmail(
        ticket.name,
        ticket.ticket_reference,
        message
      )
    };

    const resendResponse = await fetch(
      "https://api.resend.com/emails",
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${RESEND_API_KEY}`,
          "Content-Type":
            "application/json"
        },
        body: JSON.stringify(
          emailPayload
        )
      }
    );

    const resendData =
      await resendResponse
        .json()
        .catch(() => ({}));

    if (!resendResponse.ok) {
      const resendError = String(
        resendData?.message ||
          resendData?.error ||
          "Resend could not send the email."
      ).slice(0, 2000);

      await supabaseAdmin
        .from("support_ticket_replies")
        .update({
          delivery_status: "failed",
          error_message: resendError
        })
        .eq("id", replyRecord.id);

      return jsonResponse(
        {
          error: resendError
        },
        resendResponse.status || 502
      );
    }

    const sentAt =
      new Date().toISOString();

    const resendEmailId =
      clean(
        resendData?.id,
        500
      ) || null;

    let warning = "";

    const {
      error: replyUpdateError
    } = await supabaseAdmin
      .from("support_ticket_replies")
      .update({
        delivery_status: "sent",
        resend_email_id:
          resendEmailId,
        sent_at: sentAt,
        error_message: null
      })
      .eq("id", replyRecord.id);

    if (replyUpdateError) {
      console.error(
        "Reply sent but reply log update failed:",
        replyUpdateError
      );

      warning =
        "The email was sent, but its delivery record could not be fully updated.";
    }

    const ticketUpdates: Record<
      string,
      string | boolean
    > = {
      last_replied_at: sentAt,

      /*
       * Once you respond, the previously unread customer
       * reply is considered dealt with.
       */
      has_unread_customer_reply: false
    };

    if (
      statusAfterSend !== "keep"
    ) {
      ticketUpdates.status =
        statusAfterSend;
    }

    const {
      data: updatedTicket,
      error: ticketUpdateError
    } = await supabaseAdmin
      .from("support_tickets")
      .update(ticketUpdates)
      .eq("id", ticket.id)
      .select(
        "id,status,last_replied_at,updated_at,has_unread_customer_reply"
      )
      .single();

    if (ticketUpdateError) {
      console.error(
        "Reply sent but ticket update failed:",
        ticketUpdateError
      );

      warning = warning
        ? `${warning} The ticket status also needs to be updated manually.`
        : "The email was sent, but the ticket status needs to be updated manually.";
    }

    return jsonResponse({
      success: true,
      ticketReference:
        ticket.ticket_reference,
      recipientEmail: ticket.email,
      replyToAddress:
        ticketReplyAddress,
      resendEmailId,
      replyId: replyRecord.id,
      ticket:
        updatedTicket || null,
      warning:
        warning || null
    });
  } catch (error) {
    console.error(
      "Unexpected send-ticket-reply error:",
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

function buildTextEmail(
  name: string,
  ticketReference: string,
  message: string
): string {
  return `
Hi ${name},

${message}

You can reply directly to this email to add another message to your support ticket.

Ticket reference: ${ticketReference}

Thank you,
Beadlight Support
`.trim();
}

function buildHtmlEmail(
  name: string,
  ticketReference: string,
  message: string
): string {
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.65; color: #202431; max-width: 680px; margin: 0 auto;">
      <div style="padding: 24px; border: 1px solid #ead7ad; border-radius: 18px; background: #fffdf8;">
        <p>Hi ${escapeHtml(name)},</p>

        <div style="white-space: normal;">
          ${escapeHtml(message).replaceAll("\n", "<br>")}
        </div>

        <div style="margin: 24px 0; padding: 14px 16px; border-radius: 12px; background: #fff8e8; border: 1px solid #f1d49a;">
          <strong>Ticket reference:</strong>
          ${escapeHtml(ticketReference)}
        </div>

        <p>
          You can reply directly to this email to add another message to your support ticket.
        </p>

        <p style="margin-bottom: 0;">
          Thank you,<br>
          Beadlight Support
        </p>
      </div>
    </div>
  `;
}

function clean(
  value: unknown,
  maxLength: number
): string {
  return String(value || "")
    .trim()
    .slice(0, maxLength);
}

function isValidEmail(value: string): boolean {
  const address = value.trim();
  if (address.length > 254 || /\s/.test(address)) return false;
  const atIndex = address.lastIndexOf("@");
  if (atIndex <= 0 || atIndex !== address.indexOf("@")) return false;

  const local = address.slice(0, atIndex);
  const labels = address.slice(atIndex + 1).split(".");
  if (
    local.length > 64 ||
    !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..")
  ) return false;
  return labels.length >= 2 && labels.every((label) =>
    label.length <= 63 &&
    /^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/i.test(label)
  );
}

function escapeHtml(
  value: string
): string {
  return String(value).replace(
    /[&<>"']/g,
    (character) => {
      const replacements: Record<
        string,
        string
      > = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      };

      return replacements[
        character
      ];
    }
  );
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
        ...corsHeaders,
        "Content-Type":
          "application/json"
      }
    }
  );
}