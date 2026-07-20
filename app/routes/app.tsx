import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { getAppContext } from "../services/context.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await getAppContext(request);
  return {
    apiKey: process.env.SHOPIFY_API_KEY ?? "",
    authMode: context.authMode,
  };
};

export default function AppLayout() {
  const { apiKey, authMode } = useLoaderData<typeof loader>();
  const content = <Outlet />;

  if (authMode === "mock") {
    return <main>{content}</main>;
  }

  return (
    <AppProvider embedded apiKey={apiKey}>
      {content}
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
