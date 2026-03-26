"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { toast } from "@/store/useToastStore";

const schema = z.object({
  email: z.string().email("Enter a valid work email"),
});

type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [submitted, setSubmitted] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(_values: FormValues) {
    // Simulate network delay — actual Keycloak integration later
    await new Promise((r) => setTimeout(r, 800));
    setSubmitted(true);
    toast.success(
      "Check your inbox",
      "If an account exists with that email, you'll receive a reset link."
    );
  }

  return (
    <div className="min-h-screen bg-background-dark grid-bg flex items-center justify-center p-4">
      {/* Blur orbs */}
      <div className="fixed top-0 left-0 w-96 h-96 bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="fixed bottom-0 right-0 w-96 h-96 bg-primary/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Deployment badge */}
      <div className="fixed top-4 left-4 hidden md:flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-text-muted border border-border-dark rounded px-2 py-1">
        <span className="size-1.5 rounded-full bg-primary" />
        DEPLOYMENT: 0x1a2b3c
      </div>

      {/* Security badge */}
      <div className="fixed bottom-4 right-4 hidden md:flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-text-muted border border-border-dark rounded px-2 py-1">
        <span className="size-1.5 rounded-full bg-accent-success animate-pulse" />
        NODE-01 ● SECURE ENC: AES-256-GCM
      </div>

      <div className="w-full max-w-[440px] space-y-6 relative z-10">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center size-14 rounded-xl bg-primary/10 border border-primary/30 glow-primary mb-2">
            <span className="icon text-primary text-3xl">rocket_launch</span>
          </div>
          <h1 className="text-3xl font-black uppercase tracking-wider">URULE</h1>
          <p className="text-sm text-text-muted">AI-powered virtual office platform</p>
        </div>

        {/* Card */}
        <div className="glass-panel rounded-xl p-8 space-y-6 neo-shadow">
          {submitted ? (
            <div className="text-center space-y-4 py-4">
              <div className="inline-flex items-center justify-center size-16 rounded-full bg-accent-success/10 border border-accent-success/30">
                <span className="icon text-accent-success text-4xl">mark_email_read</span>
              </div>
              <div className="space-y-2">
                <h2 className="text-xl font-bold">Check your email</h2>
                <p className="text-sm text-text-muted">
                  If an account exists with that email, you&apos;ll receive a reset link.
                </p>
              </div>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-primary text-sm font-bold hover:underline mt-2"
              >
                <span className="icon text-sm">arrow_back</span>
                Back to login
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-2 text-center">
                <h2 className="text-xl font-bold">Reset your password</h2>
                <p className="text-sm text-text-muted">
                  Enter the email associated with your account and we&apos;ll send a reset link.
                </p>
              </div>

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                {/* Email */}
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-text-muted uppercase tracking-wider">
                    Work Email
                  </label>
                  <div className="relative group">
                    <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">
                      mail
                    </span>
                    <input
                      type="email"
                      placeholder="name@company.ai"
                      autoComplete="email"
                      className="w-full pl-10 pr-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                      {...register("email")}
                    />
                  </div>
                  {errors.email && (
                    <p className="text-xs text-accent-warning">{errors.email.message}</p>
                  )}
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-primary hover:bg-primary/90 text-background-dark font-black py-4 rounded-lg flex items-center justify-center gap-2 active:scale-[0.98] shadow-lg shadow-primary/20 transition-all disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <span className="icon animate-spin text-sm">progress_activity</span>
                  ) : (
                    <span className="icon text-sm">send</span>
                  )}
                  SEND RESET LINK
                </button>
              </form>
            </>
          )}

          {/* Back to login (shown when form is visible) */}
          {!submitted && (
            <div className="text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-2 text-primary text-sm font-bold hover:underline"
              >
                <span className="icon text-sm">arrow_back</span>
                Back to login
              </Link>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center gap-4 font-mono text-[10px] uppercase tracking-widest text-text-muted">
          <a href="#" className="hover:text-primary transition-colors">Privacy Policy</a>
          <span>·</span>
          <a href="#" className="hover:text-primary transition-colors">System Status</a>
          <span>·</span>
          <a href="#" className="hover:text-primary transition-colors">Security</a>
        </div>
      </div>
    </div>
  );
}
