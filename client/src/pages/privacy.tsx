import { EmailLink, InlineLink, LegalPage, LegalSection, List } from "@/components/legal-page";

// Privacy policy for grammie.ai and the Grammie iPhone/iPad app. Written from
// what the code actually does; update it (and the date) when that changes:
// a new outside service, a new kind of data, or analytics.
export const PRIVACY_EFFECTIVE_DATE = "November 21, 2026";

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy" effective={PRIVACY_EFFECTIVE_DATE}>
      <p>
        Grammie (the website at grammie.ai and the Grammie app for iPhone and iPad) helps you save family recipes,
        make cookbooks and plan meals. It's run by Daniel Hawvermale, an individual based in Puerto Rico ("we", "us").
        This page explains, in plain words, what information Grammie keeps, why, who else sees it, and how to delete it.
      </p>
      <p>
        <strong>The short version:</strong> we keep what you put into Grammie so we can show it back to you. We don't
        sell your information, we don't show ads, and we don't use tracking or advertising cookies. You can delete your
        account and everything in it at any time from <InlineLink href="/settings">Me</InlineLink>.
      </p>

      <LegalSection title="What we collect">
        <List>
          <li>
            <strong>Your account.</strong> Your name, email address and profile picture. Sign-in is handled by Clerk, our
            sign-in provider. If you sign in with Google or Apple, they share your name and email with us (with Apple you
            can choose to hide your email). If you use a password, Clerk keeps it; we never see it.
          </li>
          <li>
            <strong>What you add.</strong> Recipes, notes and stories, photos of recipe cards and dishes, cookbooks,
            meal plans, meal-prep plans, your grocery list, your pantry (including pantry photos you scan), and parties
            you host or join, with the names guests give and what they're bringing.
          </li>
          <li>
            <strong>Your food profile.</strong> Allergies, diets, foods you like or avoid, household size and cooking
            skill, if you choose to fill them in. We use these only to tailor suggestions and warnings in Grammie.
          </li>
          <li>
            <strong>Links you import.</strong> When you add a recipe from a web page or a social media post (for example
            Instagram, TikTok or YouTube), we fetch that page or post to read the recipe.
          </li>
          <li>
            <strong>Purchases.</strong> If you buy credits or a printed book, we keep a record of the purchase (what,
            when, how much). Card details go straight to Stripe or Apple; we never see your full card number.
          </li>
          <li>
            <strong>Printed books.</strong> The shipping name, address, phone number and email you enter for the order.
          </li>
          <li>
            <strong>Technical information.</strong> Like most websites, our servers record basic request details (such as
            your IP address, device and browser type, and error messages) to keep the service running and secure.
          </li>
        </List>
      </LegalSection>

      <LegalSection title="Using Grammie without an account">
        <p>
          You can add a few recipes, or join a party, without making an account. Grammie then gives your device a random
          code, kept on the device, so it can find your recipes again. To stop misuse we store a scrambled (hashed)
          version of your internet address, not the address itself. If you later make an account, those recipes move into
          it. Party guests only give the name they want the host to see.
        </p>
      </LegalSection>

      <LegalSection title="How we use it">
        <List>
          <li>To run Grammie: store your recipes, show them to you, and keep your cookbooks, plans and lists in sync across your devices.</li>
          <li>To read and tidy up recipes with AI (see below), and to suggest meals that fit your food profile.</li>
          <li>To print and ship books you order, and to handle payments, refunds and credits.</li>
          <li>To answer you when you contact us, and to keep Grammie secure and working.</li>
        </List>
        <p>We don't sell your information, use it for advertising, or share it with data brokers.</p>
      </LegalSection>

      <LegalSection title="AI processing">
        <p>
          Grammie uses Google's Gemini AI service to read recipe photos and handwriting, pull recipes out of web pages and
          posts, fill in details like tags and nutrition estimates, make dish pictures, scan pantry photos, build meal-prep
          plans and answer questions in the Grammie chat. To do that, the text and photos involved (and, for suggestions,
          your food profile) are sent to Google for processing. We use Google's paid service, and under Google's terms for
          it, Google doesn't use this content to train its AI models. Some older features can use OpenAI's service as a
          backup in the same way.
        </p>
        <p>AI results are labeled in the app and you can always edit them.</p>
      </LegalSection>

      <LegalSection title="Who else sees your information">
        <p>We share information only with the services that help run Grammie, and only what each one needs:</p>
        <List>
          <li><strong>Clerk</strong>: sign-in and account management.</li>
          <li><strong>Railway</strong>: hosts our servers and database.</li>
          <li><strong>Google (Gemini)</strong> and, as a backup, <strong>OpenAI</strong>: AI processing, as described above.</li>
          <li><strong>Stripe</strong>: card payments for credits and printed books.</li>
          <li><strong>Apple</strong>: in-app purchases in the iPhone and iPad app, and Sign in with Apple.</li>
          <li><strong>Lulu</strong>: prints and ships your book; it receives the book files and your shipping details.</li>
          <li>
            <strong>Instacart</strong>: if you choose to shop your grocery list with Instacart, we send the item names to
            Instacart to build your cart. What happens on Instacart is covered by Instacart's own privacy policy.
          </li>
          <li>
            <strong>Social media readers</strong> (Apify and ScrapeCreators): for some Instagram and TikTok links, these
            services fetch the public post for us. They receive the link, not your account details.
          </li>
          <li>
            <strong>AI assistants you connect.</strong> If you connect Grammie to an AI assistant from Me, that assistant
            can read and add recipes in your account until you disconnect it.
          </li>
        </List>
        <p>
          <strong>Other Grammie users</strong> see what you choose to share: recipes and cookbooks you make public, your
          public profile, cookbooks, meal plans and grocery lists you share, and parties you invite people to. You can make
          recipes and cookbooks private, and change the default in Me.
        </p>
        <p>
          We may also share information if the law requires it, or to protect people's safety or Grammie's security.
        </p>
      </LegalSection>

      <LegalSection title="Cookies and storage on your device">
        <p>
          Grammie uses only what it needs to work: Clerk's sign-in cookies keep you signed in, and your device stores a
          few settings (like dark mode, text size, tips you've closed, and the guest code above). There are no advertising
          or analytics trackers.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it, and deleting it">
        <p>
          We keep your information for as long as you have an account. Anything you delete in Grammie is removed.
        </p>
        <p>
          <strong>To delete your account</strong>, go to <InlineLink href="/settings">Me</InlineLink> and choose
          "Delete my account". This permanently removes your account and everything in it: your recipes and photos,
          cookbooks, meal and prep plans, grocery list, pantry, parties you host, credits and your sign-in. If a printed
          book is still on its way, you can delete your account once it's delivered. If you can't sign in, email us and
          we'll delete it for you.
        </p>
        <p>
          A few things are kept elsewhere, as the law or the service requires: Stripe, Apple and Lulu keep their own
          records of payments and orders, and copies in our database backups and server logs are overwritten after a short
          time.
        </p>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <p>
          You can see and change your information in Grammie at any time, and delete any of it. You can also email us to
          ask for a copy of your information, to correct it, or to delete it, and we'll answer within 30 days. Depending on
          where you live (for example California or the European Union), you may have more rights under local law; we'll
          honor them.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Information travels over encrypted connections, sign-in is handled by Clerk, and access to our systems is
          limited. No service can promise perfect security, so please tell us right away if you notice anything wrong.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          Grammie is not meant for children under 13, and we don't knowingly collect information from them. If you think a
          child under 13 has given us information, email us and we'll delete it.
        </p>
      </LegalSection>

      <LegalSection title="Where your information is processed">
        <p>
          Grammie and the services above mostly run in the United States, so your information may be stored and processed
          there.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>
          If we change this policy we'll update the date at the top, and for important changes we'll let you know in the
          app first.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions or requests: email <EmailLink subject="Privacy question" />. Grammie is run by Daniel Hawvermale,
          Puerto Rico.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
