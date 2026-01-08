import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.string().url(),
    // Your community management system
    WOOCOMMERCE_URL: z.string().url(),
    WOOCOMMERCE_CONSUMER_KEY: z.string().min(1),
    WOOCOMMERCE_CONSUMER_SECRET: z.string().min(1),
    RESEND_API_KEY: z.string().min(1),
    LOOPS_API_KEY: z.string().min(1),
    LOOPS_ACTIVE_MEMBERS_LIST_ID: z.string().min(1),
    CRON_SECRET: z.string().min(1),
    STACK_SECRET_SERVER_KEY: z.string().min(1),
    // Audio Recordings Authorization
    AUDIO_RECORDING_SESSION_SECRET: z.string().min(32),
    HCAPTCHA_SECRET_KEY: z.string().min(1),
    // Demo features (UploadThing, Redis)
    UPLOADTHING_TOKEN: z.string().optional(),
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url(),
    NEXT_PUBLIC_STACK_PROJECT_ID: z.string().min(1),
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: z.string().min(1),
    NEXT_PUBLIC_HCAPTCHA_SITE_KEY: z.string().min(1),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    // Your community management system
    WOOCOMMERCE_URL: process.env.WOOCOMMERCE_URL,
    WOOCOMMERCE_CONSUMER_KEY: process.env.WOOCOMMERCE_CONSUMER_KEY,
    WOOCOMMERCE_CONSUMER_SECRET: process.env.WOOCOMMERCE_CONSUMER_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    LOOPS_API_KEY: process.env.LOOPS_API_KEY,
    LOOPS_ACTIVE_MEMBERS_LIST_ID: process.env.LOOPS_ACTIVE_MEMBERS_LIST_ID,
    CRON_SECRET: process.env.CRON_SECRET,
    STACK_SECRET_SERVER_KEY: process.env.STACK_SECRET_SERVER_KEY,
    // Audio Recordings Authorization
    AUDIO_RECORDING_SESSION_SECRET: process.env.AUDIO_RECORDING_SESSION_SECRET,
    HCAPTCHA_SECRET_KEY: process.env.HCAPTCHA_SECRET_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_STACK_PROJECT_ID: process.env.NEXT_PUBLIC_STACK_PROJECT_ID,
    NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
    NEXT_PUBLIC_HCAPTCHA_SITE_KEY: process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY,
    // Demo features
    UPLOADTHING_TOKEN: process.env.UPLOADTHING_TOKEN,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined.
   * `SOME_VAR: z.string()` and `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
