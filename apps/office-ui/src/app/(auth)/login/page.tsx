"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import { toast } from "@/store/useToastStore";

const schema = z.object({
  email: z.string().email("Enter a valid work email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { setTokens, setUser } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      const { data } = await api.post("/auth/login", values);
      setTokens(data.access_token, data.refresh_token);
      const { data: me } = await api.get("/auth/me");
      setUser(me);
      router.push("/office");
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Login failed. Check your credentials.";
      setServerError(msg);
    }
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
          <form method="POST" action="" onSubmit={handleSubmit(onSubmit)} className="space-y-4" autoComplete="on">
            {/* Email */}
            <div className="space-y-1">
              <label htmlFor="login-email" className="text-sm font-semibold text-text-muted uppercase tracking-wider">
                Work Email
              </label>
              <div className="relative group">
                <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">
                  mail
                </span>
                <input
                  id="login-email"
                  type="email"
                  placeholder="name@company.ai"
                  autoComplete="email"
                  aria-invalid={errors.email ? "true" : undefined}
                  aria-describedby={errors.email ? "login-email-error" : undefined}
                  className="w-full pl-10 pr-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  {...register("email")}
                />
              </div>
              {errors.email && (
                <p id="login-email-error" className="text-xs text-accent-warning" role="alert">{errors.email.message}</p>
              )}
            </div>

            {/* Password */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="login-password" className="text-sm font-semibold text-text-muted uppercase tracking-wider">
                  Password
                </label>
                <Link href="/forgot-password" className="text-primary text-xs font-bold hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative group">
                <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">
                  lock
                </span>
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  aria-invalid={errors.password ? "true" : undefined}
                  aria-describedby={errors.password ? "login-password-error" : undefined}
                  className="w-full pl-10 pr-10 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <span className="icon text-sm">{showPassword ? "visibility_off" : "visibility"}</span>
                </button>
              </div>
              {errors.password && (
                <p id="login-password-error" className="text-xs text-accent-warning" role="alert">{errors.password.message}</p>
              )}
            </div>

            {serverError && (
              <p className="text-xs text-accent-warning bg-accent-warning/10 border border-accent-warning/20 rounded-lg px-3 py-2" role="alert">
                {serverError}
              </p>
            )}

            {/* AUTHENTICATE */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-primary hover:bg-primary/90 text-background-dark font-black py-4 rounded-lg flex items-center justify-center gap-2 active:scale-[0.98] shadow-lg shadow-primary/20 transition-all disabled:opacity-60"
            >
              {isSubmitting ? (
                <span className="icon animate-spin text-sm">progress_activity</span>
              ) : (
                <span className="icon text-sm">login</span>
              )}
              AUTHENTICATE
            </button>
          </form>

          {/* OAuth providers */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className="bg-background-dark/30 border border-primary/10 rounded-lg py-2.5 text-sm font-bold text-slate-200 hover:bg-primary/5 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="size-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Google
            </button>
            <button
              type="button"
              className="bg-background-dark/30 border border-primary/10 rounded-lg py-2.5 text-sm font-bold text-slate-200 hover:bg-primary/5 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="size-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </svg>
              Apple
            </button>
          </div>

          {/* Sign in with SSO */}
          <button
            type="button"
            onClick={() => toast.info("Coming soon", "SSO login will be available in a future update.")}
            className="w-full bg-background-dark/30 border border-primary/10 rounded-lg py-3 text-sm font-bold text-slate-200 hover:bg-primary/5 transition-colors"
          >
            Sign in with SSO
          </button>

          {/* Demo login */}
          <button
            type="button"
            onClick={() => {
              setTokens("demo-access-token", "demo-refresh-token");
              setUser({
                id: "demo-user",
                email: "demo@urule.dev",
                display_name: "Demo User",
                role: "owner",
              });
              router.push("/office");
            }}
            className="w-full bg-accent-success/10 border border-accent-success/30 rounded-lg py-3 text-sm font-bold text-accent-success hover:bg-accent-success/20 transition-colors flex items-center justify-center gap-2"
          >
            <span className="icon text-sm">play_arrow</span>
            Demo Login (No Auth Required)
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border-dark" />
            <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted whitespace-nowrap">
              Self-Hosted &amp; Open Source
            </span>
            <div className="flex-1 h-px bg-border-dark" />
          </div>

          {/* Self-host + GitHub */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className="bg-background-dark/30 border border-primary/10 rounded-lg py-2.5 text-sm font-bold text-slate-200 hover:bg-primary/5 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="size-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.207 11.387.6.113.793-.258.793-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.73.083-.73 1.205.085 1.838 1.236 1.838 1.236 1.07 1.835 2.807 1.305 3.492.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.604-.015 2.896-.015 3.286 0 .315.21.69.825.573C20.565 21.795 24 17.298 24 12c0-6.627-5.373-12-12-12z" />
              </svg>
              GitHub
            </button>
            <button
              type="button"
              className="bg-background-dark/30 border border-primary/10 rounded-lg py-2.5 text-sm font-bold text-slate-200 hover:bg-primary/5 transition-colors flex items-center justify-center gap-2"
            >
              <span className="icon text-sm">dns</span>
              Self-Host
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-text-muted">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-primary font-bold hover:underline">
            Create Account
          </Link>
        </p>
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
