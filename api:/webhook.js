// This webhook receives notifications from Stripe when payments succeed
// It then sends the PDF to the customer via SendGrid
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const sgMail = require('@sendgrid/mail');
const fs = require('fs');
const path = require('path');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

module.exports = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verify the webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    
    console.log('Payment succeeded for:', paymentIntent.metadata.customer_email);

    try {
      // Read the PDF file
      const pdfPath = path.join(process.cwd(), 'public', 'Estate_Planning_Guide_for_Young_Families.pdf');
      const pdfBuffer = fs.readFileSync(pdfPath);
      const pdfBase64 = pdfBuffer.toString('base64');

      // Send email with PDF attachment
      const msg = {
        to: paymentIntent.metadata.customer_email,
        from: {
          email: 'kyle.sitomer@gmail.com',
          name: 'Plan the Fam'
        },
        subject: '🎉 Your Estate Planning Guide is Ready!',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #1a472a;">Thank You for Your Purchase!</h1>
            
            <p>Hi ${paymentIntent.metadata.customer_name.split(' ')[0]},</p>
            
            <p>Thank you for purchasing the <strong>Estate Planning Guide for Young Families</strong>! Your guide is attached to this email.</p>
            
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h2 style="color: #2d5f3d; margin-top: 0;">Your Next Steps:</h2>
              <ol style="line-height: 1.8;">
                <li><strong>Download the PDF</strong> attached to this email</li>
                <li><strong>Read Chapters 1-3</strong> to understand estate planning basics</li>
                <li><strong>Complete the worksheets</strong> in Chapter 6 (Asset Inventory)</li>
                <li><strong>Decide on guardians</strong> using the framework in Chapter 5</li>
                <li><strong>Schedule an attorney meeting</strong> - arrive fully prepared!</li>
              </ol>
            </div>
            
            <p><strong>💡 Pro Tip:</strong> Print out the worksheets or fill them out digitally. Arriving at your attorney meeting with completed worksheets can save you $500-$1,500 in billable hours!</p>
            
            <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
            
            <p style="font-size: 14px; color: #666;">
              Questions? Contact us at <a href="mailto:support@planthefam.com">support@planthefam.com</a><br>
              <br>
              © 2026 Plan the Fam. All rights reserved.
            </p>
          </div>
        `,
        text: `
Hi ${paymentIntent.metadata.customer_name.split(' ')[0]},

Thank you for purchasing the Estate Planning Guide for Young Families! Your guide is attached to this email.

Your Next Steps:
1. Download the PDF attached to this email
2. Read Chapters 1-3 to understand estate planning basics
3. Complete the worksheets in Chapter 6 (Asset Inventory)
4. Decide on guardians using the framework in Chapter 5
5. Schedule an attorney meeting - arrive fully prepared!

Pro Tip: Print out the worksheets or fill them out digitally. Arriving at your attorney meeting with completed worksheets can save you $500-$1,500 in billable hours!

Questions? Contact us at support@planthefam.com

© 2026 Plan the Fam. All rights reserved.
        `,
        attachments: [
          {
            content: pdfBase64,
            filename: 'Estate_Planning_Guide_for_Young_Families.pdf',
            type: 'application/pdf',
            disposition: 'attachment'
          }
        ]
      };

      await sgMail.send(msg);
      console.log('Email sent successfully to:', paymentIntent.metadata.customer_email);

    } catch (emailError) {
      console.error('Failed to send email:', emailError);
      // Don't return error to Stripe - we don't want them to retry
      // Log it and handle manually
    }
  }

  // Return a response to acknowledge receipt of the event
  res.json({ received: true });
};
