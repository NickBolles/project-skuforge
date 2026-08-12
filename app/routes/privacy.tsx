import { MarketingChrome, marketingStyles as styles } from "../components/MarketingChrome";
import {
  APP_NAME,
  LEGAL_ENTITY,
  PRIVACY_LAST_UPDATED,
  SUPPORT_EMAIL,
} from "../config/brand";

export const meta = () => [
  { title: `Privacy policy — ${APP_NAME}` },
  {
    name: "description",
    content: `How ${APP_NAME} collects, stores, and deletes Shopify merchant data.`,
  },
];

export default function Privacy() {
  return (
    <MarketingChrome>
      <h1 className={styles.title}>Privacy policy</h1>
      <p className={styles.lede}>
        What {APP_NAME} stores, why, and how to get it deleted.
      </p>
      <p className={styles.meta}>Last updated {PRIVACY_LAST_UPDATED}</p>

      <div className={styles.callout}>
        <p>
          <strong>{APP_NAME} does not collect your customers&rsquo; personal
          information.</strong> The app reads and writes product catalog data —
          SKUs, barcodes, product and variant identifiers. It never requests
          access to orders, customers, or payment data, and its Shopify
          permissions (<code>read_products</code>, <code>write_products</code>)
          do not grant it.
        </p>
      </div>

      <section className={styles.section}>
        <h2>Who we are</h2>
        <p>
          {LEGAL_ENTITY} operates {APP_NAME}, a Shopify app that generates and
          validates SKUs and barcodes. For anything in this policy, contact{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>

      <section className={styles.section}>
        <h2>What we store</h2>

        <h3>Store and installation data</h3>
        <ul>
          <li>
            Your <strong>myshopify.com domain</strong> and the Shopify access
            token issued when you install the app. The token is what lets the app
            read and write your catalog; it is deleted when you uninstall.
          </li>
          <li>
            Your <strong>subscription tier</strong> (Free, Pro, or Premium) and
            when it last changed, so paid features can be unlocked.
          </li>
          <li>
            Your <strong>app settings</strong>, such as whether SKUs are
            generated automatically for new products.
          </li>
        </ul>

        <h3>Catalog data</h3>
        <ul>
          <li>
            <strong>SKU rules</strong> you define — the pattern, its
            configuration, and which rule is the default.
          </li>
          <li>
            <strong>Sequence counters</strong>, so generated SKUs stay unique
            across runs.
          </li>
          <li>
            <strong>Generation jobs and their items</strong>: the product and
            variant identifiers targeted, the SKU or barcode proposed for each,
            and the outcome. This history is what makes the uniqueness guarantee
            auditable.
          </li>
          <li>
            <strong>Duplicate scan results</strong>: the identifiers of variants
            with duplicate or malformed SKUs, and whether each finding was fixed.
          </li>
          <li>
            <strong>Label templates</strong> you save.
          </li>
          <li>
            <strong>Webhook receipts</strong> — the identifier and topic of
            webhooks Shopify sends, used to guarantee each is processed exactly
            once.
          </li>
        </ul>

        <h3>What we never store</h3>
        <ul>
          <li>Customer names, email addresses, or any customer records.</li>
          <li>Orders, carts, checkouts, or fulfillment data.</li>
          <li>Payment details. Billing is handled entirely by Shopify.</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>How we use it</h2>
        <p>
          Solely to operate the app for your store: generating and validating
          SKUs and barcodes, scanning your catalog for duplicates, producing
          label PDFs, importing and exporting CSVs, and enforcing your plan&rsquo;s
          limits. We do not sell your data, share it with advertisers, or use it
          to train machine-learning models.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Who else sees it</h2>
        <ul>
          <li>
            <strong>Shopify</strong> — the source and destination of all catalog
            data, and the processor for billing.
          </li>
          <li>
            <strong>Our hosting provider</strong> — the app and its PostgreSQL
            database run on a private server. Data is not replicated to any
            third-party analytics or marketing service.
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>How long we keep it</h2>
        <p>
          Catalog, job, and scan data is retained while the app is installed, so
          your history and uniqueness guarantees stay intact between sessions.
        </p>
        <p>
          <strong>When you uninstall</strong>, the app immediately deletes your
          access token and session, releases any running job locks, cancels
          in-flight jobs, and deactivates your rules. Remaining records are
          retained briefly so that reinstalling restores your configuration.
        </p>
        <p>
          <strong>On a data-erasure request</strong> — either the{" "}
          <code>shop/redact</code> webhook Shopify sends 48 hours after
          uninstall, or a direct request to us — every record associated with
          your store is permanently deleted: rules, counters, jobs and job items,
          scans and findings, label templates, webhook receipts, sessions, and
          the store record itself.
        </p>
      </section>

      <section className={styles.section}>
        <h2>GDPR and CCPA requests</h2>
        <p>
          {APP_NAME} implements Shopify&rsquo;s three mandatory privacy webhooks.
          Because the app stores no customer personal information, a{" "}
          <code>customers/data_request</code> returns no customer data and a{" "}
          <code>customers/redact</code> has no customer records to erase — both
          are recorded so the response is auditable.{" "}
          <code>shop/redact</code> performs the full deletion described above.
        </p>
        <p>
          To request access to, correction of, or erasure of your store&rsquo;s
          data at any time, email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We respond
          within 30 days.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Security</h2>
        <p>
          All traffic is served over HTTPS. Shopify access tokens are stored in a
          database that is not publicly reachable, and every webhook is verified
          against Shopify&rsquo;s HMAC signature before it is processed. Access
          to production systems is limited to the app&rsquo;s operators.
        </p>
      </section>

      <section className={styles.section}>
        <h2>Changes</h2>
        <p>
          If this policy changes materially, we will update the date at the top
          of this page and notify installed merchants.
        </p>
      </section>
    </MarketingChrome>
  );
}
