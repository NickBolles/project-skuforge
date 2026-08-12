import { MarketingChrome, marketingStyles as styles } from "../components/MarketingChrome";
import { APP_NAME, SUPPORT_EMAIL, SUPPORT_RESPONSE_TIME } from "../config/brand";

export const meta = () => [
  { title: `Support — ${APP_NAME}` },
  {
    name: "description",
    content: `Get help with ${APP_NAME}: SKU generation, barcode generation, duplicate scanning, label printing, and CSV import.`,
  },
];

export default function Support() {
  return (
    <MarketingChrome>
      <h1 className={styles.title}>Support</h1>
      <p className={styles.lede}>
        Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> and
        we&rsquo;ll reply within {SUPPORT_RESPONSE_TIME}.
      </p>

      <div className={styles.callout}>
        <p>
          <strong>To help us help you faster,</strong> include your{" "}
          <code>.myshopify.com</code> domain, what you expected to happen, and —
          if a job or scan is involved — the job or scan ID from the URL.
        </p>
      </div>

      <section className={styles.section}>
        <h2>Common questions</h2>

        <h3>Will {APP_NAME} overwrite SKUs or barcodes I already have?</h3>
        <p>
          No. Generation only fills variants whose SKU or barcode is empty, and
          the app refuses to overwrite a non-empty barcode. Bulk edits you make
          yourself in the editor are the only way to change an existing value.
        </p>

        <h3>Are the barcodes real UPC or EAN numbers?</h3>
        <p>
          No, and this matters. {APP_NAME} generates <strong>internal Code 128
          barcodes</strong>. They scan correctly on your own equipment and are
          ideal for in-store and warehouse use. They are <em>not</em> GS1-issued
          UPC or EAN identifiers. If you sell on Amazon, or through most retail
          distributors, you need GS1-issued numbers — buy them from{" "}
          <a href="https://www.gs1.org/" rel="noreferrer noopener" target="_blank">
            GS1
          </a>{" "}
          and enter them yourself. Any app that implies otherwise is misleading
          you.
        </p>

        <h3>Can it really guarantee no duplicate SKUs?</h3>
        <p>
          Within your store, yes. Every catalog-writing job takes an exclusive
          per-store lock, re-checks each proposed SKU against live Shopify data
          immediately before writing, and runs a verification scan after
          finishing. If anything slipped, the job reports{" "}
          <code>completed with findings</code> rather than claiming success.
        </p>

        <h3>Why does the scan say my SKUs are malformed?</h3>
        <p>
          Malformed detection is measured against your default SKU rule. If you
          have not created a rule yet, a generic pattern is used, which may flag
          SKUs that are fine for your business. Create a rule that matches how
          your SKUs actually look, then re-scan.
        </p>

        <h3>What happens to my data if I uninstall?</h3>
        <p>
          Your access token and session are deleted immediately, and running jobs
          are cancelled. Shopify then sends an erasure request 48 hours later,
          at which point every record for your store is permanently deleted. See
          the <a href="/privacy">privacy policy</a> for the full list.
        </p>

        <h3>Which features need a paid plan?</h3>
        <ul>
          <li>
            <strong>Free</strong> — manual generation for stores up to 50
            variants.
          </li>
          <li>
            <strong>Pro</strong> — unlimited variants, automatic generation for
            new products, and duplicate scanning.
          </li>
          <li>
            <strong>Premium</strong> — label printing, CSV import and export, and
            priority support.
          </li>
        </ul>

        <h3>How do I cancel?</h3>
        <p>
          Uninstall the app from your Shopify admin, or downgrade to Free from
          the app&rsquo;s Billing page. Shopify handles the proration.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Reporting a problem with your catalog</h2>
        <p>
          If {APP_NAME} wrote something to your catalog that you did not expect,
          tell us immediately at{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the job
          ID. Every job records exactly which variants it touched and what it
          wrote, so we can tell you precisely what changed.
        </p>
      </section>
    </MarketingChrome>
  );
}
