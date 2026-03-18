// This function creates a Stripe PaymentIntent when the checkout form is submitted
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  // Enable CORS so your checkout page can call this API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, name } = req.body;

    // Validate input
    if (!email || !name) {
      return res.status(400).json({ error: 'Email and name are required' });
    }

    // Create a PaymentIntent with Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 5900, // $59.00 in cents
      currency: 'usd',
      receipt_email: email,
      metadata: {
        product: 'Estate Planning Guide for Young Families',
        customer_name: name,
        customer_email: email,
      },
      description: 'Estate Planning Guide for Young Families - Digital PDF',
    });

    // Return the client secret to the frontend
    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });

  } catch (error) {
    console.error('Payment Intent Error:', error);
    res.status(500).json({ 
      error: error.message || 'Failed to create payment intent' 
    });
  }
};
