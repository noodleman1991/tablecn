import type { Metadata } from "next";
import { NewsletterSignupForm } from "@/components/newsletter-signup-form";

export const metadata: Metadata = {
  title: "Newsletter Signup - Kairos Events",
  description: "Sign up to receive updates about upcoming Kairos events and community news.",
  robots: {
    index: false, // Don't index embed version
    follow: false,
  },
};

export default function NewsletterSignupEmbedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <NewsletterSignupForm />
    </div>
  );
}
