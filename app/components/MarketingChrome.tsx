import type { ReactNode } from "react";
import { APP_NAME, SUPPORT_EMAIL } from "../config/brand";
import styles from "./marketing.module.css";

/**
 * Shared frame for the public, unauthenticated pages. These render outside the
 * Shopify admin iframe, so they cannot use Polaris or App Bridge.
 */
export function MarketingChrome({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <a className={styles.wordmark} href="/">
          {APP_NAME}
        </a>
        <nav className={styles.nav}>
          <a href="/support">Support</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </header>
      {children}
      <footer className={styles.footer}>
        <span>
          © {new Date().getFullYear()} {APP_NAME}
        </span>
        <a href="/privacy">Privacy policy</a>
        <a href="/support">Support</a>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </footer>
    </div>
  );
}

export { styles as marketingStyles };
