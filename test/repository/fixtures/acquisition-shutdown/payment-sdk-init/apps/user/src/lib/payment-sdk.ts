import Stripe from "stripe";

export const client = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");
