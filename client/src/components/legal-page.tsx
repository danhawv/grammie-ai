import type { ReactNode } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/page-header";

// Layout for the plain-language policy pages (/privacy, /terms, /support).

export const SUPPORT_EMAIL = "support@grammie.ai";

export function LegalPage({ title, effective, children }: { title: string; effective?: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:py-10">
      <PageHeader title={title} description={effective ? `Effective date: ${effective}` : undefined} />
      <div className="space-y-6 text-base leading-relaxed break-words">{children}</div>
      <LegalLinks className="mt-10 border-t pt-6" />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6">{children}</ul>;
}

export function EmailLink({ subject }: { subject?: string }) {
  const href = `mailto:${SUPPORT_EMAIL}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`;
  return <a className="text-primary underline" href={href}>{SUPPORT_EMAIL}</a>;
}

export function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return <Link href={href} className="text-primary underline">{children}</Link>;
}

/** Privacy, Terms, Help: small links for the Me page and the policy pages */
export function LegalLinks({ className }: { className?: string }) {
  const link = "inline-flex min-h-11 items-center text-sm text-muted-foreground underline hover:text-foreground";
  return (
    <nav aria-label="Policies and help" className={className}>
      <ul className="flex flex-wrap gap-x-6">
        <li><Link href="/privacy" className={link}>Privacy policy</Link></li>
        <li><Link href="/terms" className={link}>Terms of use</Link></li>
        <li><Link href="/print-policy" className={link}>Printed books</Link></li>
        <li><Link href="/support" className={link}>Help and contact</Link></li>
      </ul>
    </nav>
  );
}
