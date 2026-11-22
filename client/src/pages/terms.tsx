import { EmailLink, InlineLink, LegalPage, LegalSection, List } from "@/components/legal-page";

// Plain-language terms of use for grammie.ai and the Grammie app. Printed
// books have their own page (/print-policy); privacy is at /privacy.
export default function Terms() {
  return (
    <LegalPage title="Terms of use" effective="November 21, 2026">
      <p>
        These terms cover using Grammie, the website at grammie.ai and the Grammie app for iPhone and iPad. Grammie is run
        by Daniel Hawvermale, an individual based in Puerto Rico ("we", "us"). By using Grammie you agree to these terms.
      </p>

      <LegalSection title="Your account">
        <p>
          Keep your sign-in safe; you're responsible for what happens in your account. You must be at least 13 to use
          Grammie. You can delete your account at any time from <InlineLink href="/settings">Me</InlineLink>.
        </p>
      </LegalSection>

      <LegalSection title="Your recipes stay yours">
        <p>
          You own the recipes, photos and stories you add. You give us permission to store, process and show them so
          Grammie can work for you, including to the people you share them with, and to anyone if you make them public.
          Only add things you have the right to share.
        </p>
      </LegalSection>

      <LegalSection title="Please don't">
        <List>
          <li>Use Grammie to break the law, or to harass, threaten or mislead people.</li>
          <li>Upload something that isn't yours to share, or that's hateful or explicit.</li>
          <li>Try to break into, overload or copy Grammie, or other people's accounts.</li>
        </List>
        <p>We may remove content or close accounts that do these things.</p>
      </LegalSection>

      <LegalSection title="AI suggestions">
        <p>
          Grammie uses AI to read recipes and suggest things like tags, nutrition estimates, cooking times and meal plans.
          AI can make mistakes. Check amounts, temperatures and allergens yourself, especially when cooking for someone with
          an allergy or a health condition. Grammie isn't medical or nutrition advice.
        </p>
      </LegalSection>

      <LegalSection title="Credits and purchases">
        <p>
          Some features use credits. Credits you buy are for use in Grammie, have no cash value and can't be transferred.
          Purchases in the iPhone and iPad app are handled by Apple under Apple's terms, including refunds. Printed books
          are covered by <InlineLink href="/print-policy">our printed book policy</InlineLink>.
        </p>
      </LegalSection>

      <LegalSection title="Other services">
        <p>
          Grammie links to and works with other services, like Instacart and the websites you import recipes from. They
          have their own terms, and we're not responsible for them.
        </p>
      </LegalSection>

      <LegalSection title="No guarantees">
        <p>
          We work hard to keep Grammie running and your recipes safe, but Grammie is provided "as is". We can't promise it
          will always be available or free of errors, and we may change or stop features. To the extent the law allows, we
          aren't liable for indirect losses, and our total liability is limited to what you paid us in the past 12 months.
          Keep your own copy of recipes that matter to you.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update these terms. We'll change the date above, and for important changes we'll let you know in the app
          first. If you keep using Grammie after that, the new terms apply.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions: email <EmailLink subject="Question about the terms" />. See also our{" "}
          <InlineLink href="/privacy">privacy policy</InlineLink>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
