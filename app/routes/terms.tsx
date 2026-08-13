import { MarketingChrome, marketingStyles as styles } from "../components/MarketingChrome";
import { PLAN_PRICES, FREE_VARIANT_LIMIT } from "../core/constants";
import {
  APP_NAME,
  GOVERNING_LAW,
  LEGAL_ENTITY,
  SUPPORT_EMAIL,
  TERMS_LAST_UPDATED,
} from "../config/brand";

export const meta = () => [
  { title: `Terms of Service — ${APP_NAME}` },
  {
    name: "description",
    content: `The terms governing use of ${APP_NAME}, including plans, billing, and the limits of what the app guarantees.`,
  },
];

export default function Terms() {
  return (
    <MarketingChrome>
      <h1 className={styles.title}>Terms of Service</h1>
      <p className={styles.lede}>
        Last updated {TERMS_LAST_UPDATED}. These terms are between you (the
        merchant operating the Shopify store on which {APP_NAME} is installed)
        and {LEGAL_ENTITY}. Installing the app means you accept them.
      </p>

      <section className={styles.section}>
        <h2>1. What the service does</h2>
        <p>
          {APP_NAME} generates SKUs and internal barcodes for the variants in
          your Shopify catalog, scans that catalog for duplicate and malformed
          identifiers, and — on paid plans — prints labels and imports or
          exports CSV. It reads and writes product data in your store using the{" "}
          <code>read_products</code> and <code>write_products</code> scopes you
          grant at install.
        </p>
      </section>

      <section className={styles.section}>
        <h2>2. Plans and billing</h2>
        <p>
          Billing runs entirely through Shopify&rsquo;s Billing API. Charges
          appear on your Shopify invoice; we never see or store your payment
          details.
        </p>
        <ul>
          <li>
            <strong>Free</strong> — manual generation for stores up to{" "}
            {FREE_VARIANT_LIMIT} variants. No charge.
          </li>
          <li>
            <strong>Pro</strong> — ${PLAN_PRICES.pro} USD per 30-day period.
            Unlimited variants, automatic generation for new products, and
            duplicate scanning.
          </li>
          <li>
            <strong>Premium</strong> — ${PLAN_PRICES.premium} USD per 30-day
            period. Adds label printing and CSV workflows.
          </li>
        </ul>
        <p>
          Paid plans are recurring subscriptions that renew every 30 days until
          cancelled. You approve the charge in Shopify before it takes effect.
          Cancel by downgrading to Free on the app&rsquo;s Billing page or by
          uninstalling the app; Shopify determines any proration or refund under
          its own terms. Prices may change on 30 days&rsquo; notice, and a change
          takes effect only at your next renewal.
        </p>
      </section>

      <section className={styles.section}>
        <h2>3. Barcodes are internal, not GS1</h2>
        <div className={styles.callout}>
          <p>
            <strong>
              {APP_NAME} generates internal Code 128 barcodes, not GS1-issued
              UPC or EAN identifiers.
            </strong>{" "}
            They are suitable for your own in-store and warehouse scanning. They
            are not valid for Amazon or for most retail distributors, which
            require numbers licensed from GS1. You are responsible for obtaining
            GS1 identifiers if your sales channels require them.
          </p>
        </div>
      </section>

      <section className={styles.section}>
        <h2>4. Changes the app makes to your catalog</h2>
        <p>
          Generation only fills variants whose SKU or barcode is empty, and the
          app refuses to overwrite a non-empty barcode. Bulk edits you make in
          the editor, and fixes you apply from a scan finding, change data at
          your direction. Every job records which variants it touched and what it
          wrote.
        </p>
        <p>
          You remain responsible for your catalog. Review a preview before
          running a job against a live store, and keep your own backups —
          Shopify, not {APP_NAME}, is the system of record for your products.
        </p>
      </section>

      <section className={styles.section}>
        <h2>5. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>
            use the app to write identifiers you are not entitled to use,
            including GS1 numbers licensed to someone else;
          </li>
          <li>
            attempt to access another merchant&rsquo;s data, or to circumvent
            plan entitlements or the rate limits the app applies;
          </li>
          <li>
            resell or redistribute the service, or use it to operate a competing
            product;
          </li>
          <li>
            probe, scan, or load-test the service without our written
            permission.
          </li>
        </ul>
        <p>
          We may suspend an installation that is causing harm to the service or
          to Shopify&rsquo;s API, and will tell you why.
        </p>
      </section>

      <section className={styles.section}>
        <h2>6. Your data</h2>
        <p>
          What we store, why, and how to have it deleted is set out in the{" "}
          <a href="/privacy">privacy policy</a>, which forms part of these terms.
          You keep all rights in your catalog data. We process it only to provide
          the service.
        </p>
      </section>

      <section className={styles.section}>
        <h2>7. Availability</h2>
        <p>
          We do not offer a contractual uptime guarantee. The app depends on
          Shopify&rsquo;s Admin API, and interruptions there will interrupt the
          service. Scheduled maintenance is announced in-app where practical.
        </p>
      </section>

      <section className={styles.section}>
        <h2>8. Warranty disclaimer</h2>
        <p>
          The service is provided &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo;, without warranties of any kind, whether express or
          implied, including implied warranties of merchantability, fitness for a
          particular purpose, and non-infringement. We do not warrant that the
          service will be uninterrupted or error-free.
        </p>
      </section>

      <section className={styles.section}>
        <h2>9. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, {LEGAL_ENTITY} is not liable
          for indirect, incidental, special, consequential, or punitive damages,
          or for lost profits, lost revenue, or lost or corrupted data. Our total
          aggregate liability arising out of or relating to the service is
          limited to the amount you paid us for the service in the twelve months
          before the event giving rise to the claim.
        </p>
        <p>
          Nothing here limits liability that cannot be limited under applicable
          law.
        </p>
      </section>

      <section className={styles.section}>
        <h2>10. Termination</h2>
        <p>
          You may stop using the service at any time by uninstalling the app from
          your Shopify admin. We may terminate or suspend access for a material
          breach of these terms. On termination, your data is deleted as
          described in the <a href="/privacy">privacy policy</a>.
        </p>
      </section>

      <section className={styles.section}>
        <h2>11. Changes to these terms</h2>
        <p>
          We may update these terms. Material changes will be announced in-app or
          by email to the store contact before they take effect, and the
          &ldquo;last updated&rdquo; date above will change. Continuing to use
          the service after that date means you accept the revised terms.
        </p>
      </section>

      <section className={styles.section}>
        <h2>12. Governing law</h2>
        <p>
          These terms are governed by the laws of {GOVERNING_LAW}, without regard
          to its conflict-of-laws rules.
        </p>
      </section>

      <section className={styles.section}>
        <h2>13. Contact</h2>
        <p>
          Questions about these terms:{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>
    </MarketingChrome>
  );
}
