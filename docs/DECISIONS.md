# Engineering decisions

## Phase 0 scaffold

- Vendored the official `Shopify/shopify-app-template-react-router` template at commit `2d32d3fcde353e1788b78134b05ffe3c81ef311e` on 2026-07-20. Direct `git clone` was used instead of `shopify app init` so the scaffold remains reproducible without Shopify Partner credentials.
- Retained the template's Polaris web components and React Router 7 structure.
- Mock auth is explicit opt-in and non-production only. The Phase 0 shorthand that called it a default is superseded by the reviewed fail-closed invariant in section 1.4 and PLAN_REVIEW B3.
- Added the schema housekeeping called out in PLAN_REVIEW: `Shop.uninstalledAt`, the `LabelTemplate` relation/index, and the `WebhookEvent.shopId` index. No later-phase behavior was implemented.
- The template's `typecheck` script runs `tsc --noEmit` directly. Phase 0 routes use public React Router argument types and do not depend on generated route modules; the build remains the authoritative route-manifest check.
- `dev:mock` disables Vite dependency pre-optimization. The mock route is deliberately small, and this prevents native optimizer assumptions from becoming a credential-free development prerequisite; normal Shopify development retains the template optimization settings.
