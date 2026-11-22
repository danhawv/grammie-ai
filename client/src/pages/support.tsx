import { EmailLink, InlineLink, LegalPage, LegalSection, List } from "@/components/legal-page";

// Help and contact (the App Store "support URL").
export default function Support() {
  return (
    <LegalPage title="Help and contact">
      <LegalSection title="Get help">
        <p>
          Email <EmailLink subject="Grammie help" /> and we'll write back as soon as we can.
          It helps to tell us whether you're using the website or the iPhone or iPad app, and what you were trying to do.
          A screenshot is great if you have one.
        </p>
      </LegalSection>

      <LegalSection title="Common questions">
        <List>
          <li>
            <strong>A recipe didn't come out right.</strong> Open it and tap Edit to fix anything. Your original photo or
            link is kept with the recipe so you can check it.
          </li>
          <li>
            <strong>Printed books.</strong> See <InlineLink href="/print-policy">ordering, refunds and returns</InlineLink>.
            Email us with your order number for anything about an order.
          </li>
          <li>
            <strong>Credits.</strong> See <InlineLink href="/credits">Credits</InlineLink> for your balance and history.
            For App Store purchases, refunds are handled by Apple.
          </li>
          <li>
            <strong>Signing in.</strong> Use the same way you signed up (Google, Apple or email). If you're stuck, email us
            from the address on your account.
          </li>
        </List>
      </LegalSection>

      <LegalSection title="Delete your account">
        <p>
          Go to <InlineLink href="/settings">Me</InlineLink>, scroll to Account, and choose "Delete my account". You'll be
          asked to type DELETE to confirm. This permanently removes your account and everything in it, and can't be undone.
          If a printed book is still on its way, you can delete your account once it's delivered.
        </p>
        <p>If you can't sign in, email us from the address on your account and we'll delete it for you.</p>
      </LegalSection>

      <LegalSection title="Privacy">
        <p>
          Read our <InlineLink href="/privacy">privacy policy</InlineLink> and{" "}
          <InlineLink href="/terms">terms of use</InlineLink>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
