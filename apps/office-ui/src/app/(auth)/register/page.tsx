"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import Link from "next/link";
import api from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

const schema = z
  .object({
    display_name: z.string().min(2, "Name must be at least 2 characters"),
    organization_name: z.string().min(2, "Organization name is required"),
    email: z.string().email("Enter a valid work email"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password too long")
      .regex(/[A-Z]/, "Must include an uppercase letter")
      .regex(/[a-z]/, "Must include a lowercase letter")
      .regex(/[0-9]/, "Must include a number")
      .regex(/[^A-Za-z0-9]/, "Must include a special character"),
    confirm_password: z.string(),
  })
  .refine((data) => data.password === data.confirm_password, {
    message: "Passwords do not match",
    path: ["confirm_password"],
  });

type FormValues = z.infer<typeof schema>;

export default function RegisterPage() {
  const router = useRouter();
  const { setTokens, setUser } = useAuthStore();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    try {
      const { data } = await api.post("/auth/register", {
        display_name: values.display_name,
        organization_name: values.organization_name,
        email: values.email,
        password: values.password,
        workspace_name: "Main",
      });
      setTokens(data.access_token, data.refresh_token);
      const { data: me } = await api.get("/auth/me");
      setUser(me);
      router.push("/setup");
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })
        ?.response?.data?.detail;
      const msg =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
          ? ((detail[0] as { msg?: string })?.msg ?? "Validation failed.")
          : "Registration failed. Please try again.";
      setServerError(msg);
    }
  }

  return (
    <div className="min-h-screen bg-background-dark grid-bg flex items-center justify-center p-4">
      <div className="fixed top-0 left-0 w-96 h-96 bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
      <div className="fixed bottom-0 right-0 w-96 h-96 bg-primary/10 blur-[120px] rounded-full pointer-events-none" />

      <div className="w-full max-w-[440px] space-y-6 relative z-10">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center size-14 rounded-xl bg-primary/10 border border-primary/30 glow-primary mb-2">
            <span className="icon text-primary text-3xl">rocket_launch</span>
          </div>
          <h1 className="text-3xl font-black uppercase tracking-wider">Create Account</h1>
          <p className="text-sm text-text-muted">Set up your AI Office OS workspace</p>
        </div>

        <div className="glass-panel rounded-xl p-8 space-y-4 neo-shadow">
          <form method="POST" action="" onSubmit={handleSubmit(onSubmit)} className="space-y-4" autoComplete="on">
            {/* Full Name */}
            <div className="space-y-1">
              <label htmlFor="register-name" className="text-sm font-semibold text-text-muted uppercase tracking-wider">Full Name</label>
              <div className="relative group">
                <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">person</span>
                <input id="register-name" type="text" placeholder="Jane Smith" autoComplete="name" aria-invalid={errors.display_name ? "true" : undefined} aria-describedby={errors.display_name ? "register-name-error" : undefined} className="w-full pl-10 pr-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all" {...register("display_name")} />
              </div>
              {errors.display_name && <p id="register-name-error" className="text-xs text-accent-warning" role="alert">{errors.display_name.message}</p>}
            </div>

            {/* Organization */}
            <div className="space-y-1">
              <label htmlFor="register-org" className="text-sm font-semibold text-text-muted uppercase tracking-wider">Organization</label>
              <div className="relative group">
                <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">business</span>
                <input id="register-org" type="text" placeholder="Acme Corp" autoComplete="organization" aria-invalid={errors.organization_name ? "true" : undefined} aria-describedby={errors.organization_name ? "register-org-error" : undefined} className="w-full pl-10 pr-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all" {...register("organization_name")} />
              </div>
              {errors.organization_name && <p id="register-org-error" className="text-xs text-accent-warning" role="alert">{errors.organization_name.message}</p>}
            </div>

            {/* Work Email */}
            <div className="space-y-1">
              <label htmlFor="register-email" className="text-sm font-semibold text-text-muted uppercase tracking-wider">Work Email</label>
              <div className="relative group">
                <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">mail</span>
                <input id="register-email" type="email" placeholder="jane@acme.ai" autoComplete="email" aria-invalid={errors.email ? "true" : undefined} aria-describedby={errors.email ? "register-email-error" : undefined} className="w-full pl-10 pr-4 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all" {...register("email")} />
              </div>
              {errors.email && <p id="register-email-error" className="text-xs text-accent-warning" role="alert">{errors.email.message}</p>}
            </div>

            {/* Password */}
            <div className="space-y-1">
              <label htmlFor="register-password" className="text-sm font-semibold text-text-muted uppercase tracking-wider">Password</label>
              <div className="relative group">
                <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">lock</span>
                <input id="register-password" type={showPassword ? "text" : "password"} placeholder="••••••••" autoComplete="new-password" aria-invalid={errors.password ? "true" : undefined} aria-describedby={errors.password ? "register-password-error" : undefined} className="w-full pl-10 pr-10 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all" {...register("password")} />
                <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary transition-colors" tabIndex={-1} aria-label={showPassword ? "Hide password" : "Show password"}>
                  <span className="icon text-lg">{showPassword ? "visibility_off" : "visibility"}</span>
                </button>
              </div>
              {errors.password && <p id="register-password-error" className="text-xs text-accent-warning" role="alert">{errors.password.message}</p>}
            </div>

            {/* Confirm Password */}
            <div className="space-y-1">
              <label htmlFor="register-confirm-password" className="text-sm font-semibold text-text-muted uppercase tracking-wider">Confirm Password</label>
              <div className="relative group">
                <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors">lock_reset</span>
                <input id="register-confirm-password" type={showConfirm ? "text" : "password"} placeholder="••••••••" autoComplete="new-password" aria-invalid={errors.confirm_password ? "true" : undefined} aria-describedby={errors.confirm_password ? "register-confirm-password-error" : undefined} className="w-full pl-10 pr-10 py-3 bg-background-dark/50 border border-primary/10 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all" {...register("confirm_password")} />
                <button type="button" onClick={() => setShowConfirm((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-primary transition-colors" tabIndex={-1} aria-label={showConfirm ? "Hide password confirmation" : "Show password confirmation"}>
                  <span className="icon text-lg">{showConfirm ? "visibility_off" : "visibility"}</span>
                </button>
              </div>
              {errors.confirm_password && <p id="register-confirm-password-error" className="text-xs text-accent-warning" role="alert">{errors.confirm_password.message}</p>}
            </div>

            {serverError && (
              <p className="text-xs text-accent-warning bg-accent-warning/10 border border-accent-warning/20 rounded-lg px-3 py-2" role="alert">
                {serverError}
              </p>
            )}

            <button type="submit" disabled={isSubmitting} className="w-full bg-primary hover:bg-primary/90 text-background-dark font-black py-4 rounded-lg flex items-center justify-center gap-2 active:scale-[0.98] shadow-lg shadow-primary/20 transition-all disabled:opacity-60 mt-2">
              {isSubmitting ? (
                <span className="icon animate-spin text-sm">progress_activity</span>
              ) : (
                <span className="icon text-sm">person_add</span>
              )}
              CREATE WORKSPACE
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-bold hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
