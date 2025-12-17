import type { Metadata } from "next";
import { NewsletterSignupForm } from "@/components/newsletter-signup-form";

export const metadata: Metadata = {
  title: "Newsletter Signup - Kairos Events",
  description: "Sign up to receive updates about upcoming Kairos events and community news.",
};

export default function NewsletterSignupPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-2xl">
        <NewsletterSignupForm />
        <div className="mt-8 text-center text-sm text-muted-foreground">
          <p>By subscribing, you'll receive updates about upcoming events, community news, and more.</p>
        </div>
      </div>
    </div>
  );
}
