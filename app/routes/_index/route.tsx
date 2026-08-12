import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { MarketingChrome, marketingStyles as styles } from "../../components/MarketingChrome";
import { APP_NAME } from "../../config/brand";
import { login } from "../../shopify.server";

export const meta = () => [
  { title: `${APP_NAME} — SKU & barcode manager for Shopify` },
  {
    name: "description",
    content:
      "Generate, validate, and print every SKU and barcode in your Shopify store — with a hard guarantee against duplicates.",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <MarketingChrome>
      <h1 className={styles.title}>
        Every SKU and barcode in your store — without spreadsheets
      </h1>
      <p className={styles.lede}>
        {APP_NAME} generates SKUs and barcodes from rules you define, scans your
        catalog for duplicates, and prints scannable labels. Uniqueness is
        guaranteed store-wide, not hoped for.
      </p>

      {showForm && (
        <Form className={styles.loginForm} method="post" action="/auth/login">
          <label className={styles.label}>
            <span>Shop domain</span>
            <input
              className={styles.input}
              type="text"
              name="shop"
              placeholder="my-shop-domain.myshopify.com"
            />
            <span className={styles.hint}>e.g. my-shop-domain.myshopify.com</span>
          </label>
          <button className={styles.button} type="submit">
            Install
          </button>
        </Form>
      )}

      <ul className={styles.features}>
        <li>
          <strong>Rule-based generation.</strong> Build a pattern from vendor,
          product type, options, and a sequence, then preview it against your
          real catalog before a single write.
        </li>
        <li>
          <strong>Duplicates caught, not created.</strong> Every write takes an
          exclusive lock, re-checks live Shopify data, and runs a verification
          scan afterward. Existing duplicates get a one-click fix.
        </li>
        <li>
          <strong>Honest barcodes.</strong> Internal Code 128 barcodes for your
          own scanners — clearly labeled as such, never passed off as GS1 UPC or
          EAN codes you&rsquo;d need for Amazon.
        </li>
        <li>
          <strong>Labels that fit the sheet.</strong> Vector PDFs for Avery
          sheets and Dymo/Zebra thermal printers, with the geometry verified
          down to the millimeter.
        </li>
        <li>
          <strong>CSV without the burn.</strong> Export, edit, and re-import with
          validation that catches duplicates <em>before</em> they reach Shopify.
        </li>
      </ul>
    </MarketingChrome>
  );
}
