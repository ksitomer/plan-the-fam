// Receives payment notifications from Stripe and emails the guide via Resend.
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs');
const path = require('path');

// Stripe signature verification requires the RAW request body. Vercel parses
// JSON bodies by default, which breaks verification (HTTP 400), so the parser
// is disabled (see module.exports.config at the bottom) and we buffer manually.
function readRawBody(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

// The guide has been committed under a few different names over time.
const PDF_CANDIDATES = [
  'Estate Planning Guide.pdf',
  'Estate_Planning_Guide_for_Families.pdf',
  'Estate_Planning_Guide_for_Young_Families.pdf',
];

async function loadGuide(req) {
  // 1. Try the function's own filesystem. Vercel only bundles static assets
  //    into a function when explicitly configured, so this usually misses.
  for (const name of PDF_CANDIDATES) {
    const candidatePath = path.join(process.cwd(), name);
    if (fs.existsSync(candidatePath)) {
      console.log('Loaded guide from disk:', candidatePath);
      return fs.readFileSync(candidatePath);
    }
  }

  // 2. Fall back to fetching it from this same deployment, which serves the
  //    PDF as a static file.
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';

  for (const name of PDF_CANDIDATES) {
    const url = `${proto}://${host}/${encodeURIComponent(name)}`;
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        console.log('Loaded guide from URL:', url);
        return Buffer.from(await resp.arrayBuffer());
      }
    } catch (err) {
      console.error('Fetch failed for', url, err.message);
    }
  }

  throw new Error(
    'Guide PDF not found on disk or over HTTP. Looked for: ' +
      PDF_CANDIDATES.join(', ')
  );
}

module.exports = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    const rawBody = await readRawBody(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const customerEmail = paymentIntent.metadata.customer_email;
    const customerName = paymentIntent.metadata.customer_name || '';
    const firstName = customerName.split(' ')[0] || 'there';

    console.log('Payment succeeded for:', customerEmail);

    try {
      const pdfBuffer = await loadGuide(req);
      const pdfBase64 = pdfBuffer.toString('base64');

      // Until a custom domain is verified in Resend, sending must come from
      // onboarding@resend.dev, which can only deliver to your own account
      // address. Once planthefam.co is verified, set RESEND_FROM in Vercel to
      // something like: Plan the Fam <hello@planthefam.co>
      const fromAddress =
        process.env.RESEND_FROM || 'Plan the Fam <onboarding@resend.dev>';

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #1a472a;">Thank You for Your Purchase!</h1>

          <p>Hi ${firstName},</p>

          <p>Thank you for purchasing the <strong>Essential Estate Planning Guide for Families</strong>! Your guide is attached to this email.</p>

          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="color: #2d5f3d; margin-top: 0;">Your Next Steps:</h2>
            <ol style="line-height: 1.8;">
              <li><strong>Save the PDF</strong> attached to this email</li>
              <li><strong>Read Chapters 1-6</strong> to understand the core principles of a strong estate plan</li>
              <li><strong>Complete the worksheets</strong> in Chapter 7 (Asset Inventory)</li>
              <li><strong>Decide on guardians</strong> using the framework in Chapter 5</li>
              <li><strong>Schedule an attorney meeting</strong> - arrive fully prepared!</li>
            </ol>
          </div>

          <p><strong>&#128161; Pro Tip:</strong> Print out the worksheets or fill them out digitally. Arriving at your attorney meeting with completed worksheets can save you $500-$1,500 in billable hours!</p>

          <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">

          <p style="font-size: 14px; color: #666;">
            Questions? Just reply to this email.<br><br>
            &copy; 2026 Plan the Fam. All rights reserved.
          </p>
        </div>
      `;

      const text = `Hi ${firstName},

Thank you for purchasing the Essential Estate Planning Guide for Families! Your guide is attached to this email.

Your Next Steps:
1. Save the PDF attached to this email
2. Read Chapters 1-6 to understand the core principles of a strong estate plan
3. Complete the worksheets in Chapter 7 (Asset Inventory)
4. Decide on guardians using the framework in Chapter 5
5. Schedule an attorney meeting - arrive fully prepared!

Pro Tip: Print out the worksheets or fill them out digitally. Arriving at your attorney meeting with completed worksheets can save you $500-$1,500 in billable hours!

Questions? Just reply to this email.

(c) 2026 Plan the Fam. All rights reserved.`;

      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [customerEmail],
          subject: 'Your Estate Planning Guide is Ready!',
          html: html,
          text: text,
          attachments: [
            {
              filename: 'Estate Planning Guide.pdf',
              content: pdfBase64,
            },
          ],
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          `Resend responded ${response.status}: ${JSON.stringify(result)}`
        );
      }

      console.log('Email sent successfully to:', customerEmail, '| id:', result.id);
    } catch (emailError) {
      // Log the failure but acknowledge the event. Returning an error here
      // would make Stripe retry, and a retry cannot fix a bad address, a
      // missing PDF, or a provider outage. Failures are logged instead and
      // handled manually.
      console.error('Failed to send email:', emailError.message);
      console.error('Recipient was:', customerEmail || '(no email in metadata)');
      console.error('Payment intent:', paymentIntent.id);
    }
  }

  res.json({ received: true });
};

// Must come AFTER the module.exports assignment above, otherwise it gets
// overwritten. Turning off the body parser is what lets Stripe's signature
// verification see the raw payload.
module.exports.config = {
  api: {
    bodyParser: false,
  },
};
