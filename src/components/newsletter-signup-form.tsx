"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { toast } from "sonner";
import { Loader2, CheckCircle2 } from "lucide-react";

interface LoopsAPIResponse {
  success: boolean;
  message?: string;
}

const formSchema = z.object({
  firstName: z
    .string()
    .min(1, "First name is required")
    .max(100, "First name is too long"),
  lastName: z
    .string()
    .min(1, "Last name is required")
    .max(100, "Last name is too long"),
  email: z
    .string()
    .email("Please enter a valid email address")
    .min(1, "Email is required")
    .max(255, "Email is too long"),
});

type FormData = z.infer<typeof formSchema>;

const LOOPS_ENDPOINT = "https://app.loops.so/api/newsletter-form/cmj2q3e7e02af230iu03ul7kf";

export function NewsletterSignupForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
    },
  });

  const onSubmit = async (data: FormData) => {
    setIsSubmitting(true);
    setIsSuccess(false);

    try {
      const formData = new URLSearchParams();
      formData.append("firstName", data.firstName);
      formData.append("lastName", data.lastName);
      formData.append("email", data.email);
      formData.append("source", "Website Signup");

      const response = await fetch(LOOPS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      const result = (await response.json()) as LoopsAPIResponse;

      if (response.ok && result.success) {
        setIsSuccess(true);
        toast.success("Success! Check your email to confirm your subscription.");
        form.reset();
      } else {
        toast.error(result.message || "Something went wrong. Please try again.");
      }
    } catch (error) {
      console.error("Newsletter signup error:", error);
      toast.error("Failed to subscribe. Please try again later.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div
        className="rounded-lg p-12 shadow-xl"
        style={{ backgroundColor: "rgb(101, 30, 29)" }}
      >
        <div className="mb-8">
          <h1
            className="text-4xl md:text-5xl text-center leading-tight"
            style={{
              fontFamily: "var(--font-feijoa)",
              color: "white",
              fontWeight: 400,
            }}
          >
            Sign up to the Kairos events newsletter
          </h1>
        </div>

        {isSuccess ? (
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
            <p className="text-green-800 font-medium mb-2">
              Success! Please check your email to confirm your subscription.
            </p>
            <p className="text-green-700 text-sm">
              We've sent you a confirmation email. Click the link inside to complete your subscription.
            </p>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="First Name"
                        disabled={isSubmitting}
                        className="h-14 text-base"
                        style={{
                          fontFamily: "var(--font-obviously)",
                          backgroundColor: "white",
                        }}
                        autoComplete="given-name"
                      />
                    </FormControl>
                    <FormMessage className="text-red-200 font-medium" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Last Name"
                        disabled={isSubmitting}
                        className="h-14 text-base"
                        style={{
                          fontFamily: "var(--font-obviously)",
                          backgroundColor: "white",
                        }}
                        autoComplete="family-name"
                      />
                    </FormControl>
                    <FormMessage className="text-red-200 font-medium" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder="Email"
                        disabled={isSubmitting}
                        className="h-14 text-base"
                        style={{
                          fontFamily: "var(--font-obviously)",
                          backgroundColor: "white",
                        }}
                        autoComplete="email"
                      />
                    </FormControl>
                    <FormMessage className="text-red-200 font-medium" />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full h-14 text-lg font-semibold transition-all hover:scale-[1.02]"
                style={{
                  fontFamily: "var(--font-obviously-semibold)",
                  color: "white",
                  backgroundColor: "rgb(101, 30, 29)",
                  border: "2px solid white",
                }}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Subscribing...
                  </>
                ) : (
                  <>
                    Subscribe
                  </>
                )}
              </Button>
            </form>
          </Form>
        )}
      </div>
    </div>
  );
}
