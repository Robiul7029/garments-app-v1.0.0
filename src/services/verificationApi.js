import emailjs from '@emailjs/browser';

// ---------------------------------------------------------------------------
// Email verification e-mails, sent through EmailJS.
// ---------------------------------------------------------------------------
// The sign-up verification mail carries a 6-digit code AND a custom link so the
// user can either type the code or click the "Verify Email" button in the
// template. Credentials come from the same VITE_EMAILJS_* values already used
// by `notificationService.js`.
//
// IMPORTANT — the template's "To Email" field MUST contain one of the
// placeholders below, e.g. {{to_email}}. If it holds a literal address, or a
// placeholder we do not send, EmailJS throws "The recipients address is empty"
// because it has nothing to resolve. We therefore send the same address under
// every common recipient name:
//
//   recipient / to_email / to / email / user_email / reply_to
//
// Template parameters sent to EmailJS:
//   recipient, to_email, to, email, user_email, reply_to — recipient
//   subject                 — "{code} is your verification code"
//   code / verification_code / otp — the 6-digit code
//   verification_link / link / button_link / action_link — the custom link
//   app_name, expires_in_minutes, message
//
// The EmailJS template should place {{code}} where the digits appear and put
// the button's href on {{verification_link}}.
// ---------------------------------------------------------------------------

const CODE_TTL_MINUTES = 10;

function emailJsConfig() {
  return {
    serviceId: import.meta.env.VITE_EMAILJS_SERVICE_ID,
    templateId:
      import.meta.env.VITE_EMAILJS_VERIFY_TEMPLATE_ID || import.meta.env.VITE_EMAILJS_TEMPLATE_ID,
    publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY,
    appName: import.meta.env.VITE_APP_NAME || 'Garments ERP',
    appUrl: (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/+$/, ''),
  };
}

/** True when all three EmailJS values are present. */
export function verificationEmailConfigured() {
  const { serviceId, templateId, publicKey } = emailJsConfig();
  return Boolean(serviceId && templateId && publicKey);
}

/** A cryptographically random 6-digit code: 100000-999999. */
export function generateVerificationCode() {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return String(100000 + (buffer[0] % 900000));
}

/** Builds the short custom link used by the "Verify Email" button. */
export function buildVerificationLink({ email, code }) {
  const { appUrl } = emailJsConfig();
  const params = new URLSearchParams({ email: String(email || '').trim(), code });
  return `${appUrl}/verify-email?${params.toString()}`;
}

/**
 * Emails the 6-digit code and the custom verification link via EmailJS.
 *
 * @param {{ email: string, code: string, link: string }} params
 * @returns {Promise<{ emailed: boolean }>}
 */
export async function sendVerificationEmail({ email, code, link }) {
  const { serviceId, templateId, publicKey, appName } = emailJsConfig();

  // Normalise the address once. `email` is the user's input from the sign-up form
  // (or firebaseUser.email); every recipient parameter below is derived from this
  // one value, so they can never disagree.
  const to = String(email || '').trim();
  if (!to) {
    throw new Error('This account has no email address to verify.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    throw new Error(`"${to}" is not a valid email address.`);
  }

  if (!serviceId || !templateId || !publicKey) {
    throw new Error(
      'EmailJS is not configured. Set VITE_EMAILJS_SERVICE_ID, VITE_EMAILJS_TEMPLATE_ID and VITE_EMAILJS_PUBLIC_KEY in your .env file.',
    );
  }

  const subject = `${code} is your ${appName} verification code`;
  const message =
    `Your ${appName} verification code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.\n\n` +
    `Or click this link to verify: ${link}`;

  // The same address under every name the template might reference. EmailJS
  // resolves whichever placeholder the "To Email" field actually contains; if
  // none of them match it, the send fails with "The recipients address is empty".
  const recipientParams = {
    recipient: to,
    to_email: to,
    to: to,
    email: to,
    user_email: to,
    reply_to: to,
  };

  try {
    await emailjs.send(
      serviceId,
      templateId,
      {
        ...recipientParams,
        subject,
        // The code is exposed under several common parameter names so the
        // EmailJS template works whichever placeholder it uses.
        code,
        verification_code: code,
        otp: code,
        // The custom link, same idea — the button's href binds to one of these.
        verification_link: link,
        link,
        button_link: link,
        action_link: link,
        app_name: appName,
        expires_in_minutes: String(CODE_TTL_MINUTES),
        message,
      },
      publicKey,
    );
    return { emailed: true };
  } catch (error) {
    const detail = error?.text || error?.message || String(error);
    console.error('[Verification] EmailJS send failed', detail);
    // Surface EmailJS's own wording: "The recipients address is empty" means the
    // template's To Email field does not use one of the recipient placeholders
    // above, which is a template setting rather than an app bug.
    if (/recipients? address is empty/i.test(detail)) {
      throw new Error('The EmailJS template has no recipient set. Put {{to_email}} in the template\'s "To Email" field.');
    }
    throw new Error('Could not send the verification email. Please try again.');
  }
}

/**
 * Checks a code the user typed against the code generated for this sign-up.
 *
 * NOTE: EmailJS sends the mail from the browser and there is no server, so the
 * comparison happens in the browser against the code kept in sessionStorage for
 * the pending registration. A server-side check is stronger; this matches the
 * "EmailJS only" setup you asked for.
 *
 * @param {{ code?: string, storedCode?: string }} params
 * @returns {{ verified: boolean, error?: string }}
 */
export function confirmVerificationCode({ code, storedCode }) {
  const submitted = String(code || '').trim();
  if (!submitted) {
    return { verified: false, error: 'Enter the 6-digit code from the email we sent you.' };
  }
  if (!storedCode) {
    return { verified: false, error: 'No pending verification found. Please sign up again.' };
  }
  if (submitted !== String(storedCode).trim()) {
    return { verified: false, error: 'That code is not correct. Please try again.' };
  }
  return { verified: true };
}
