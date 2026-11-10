import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";

import { useAuthStore } from "@/stores/auth-store";
import AppShell from "@/components/layout/AppShell";
import RequireModule from "@/components/auth/RequireModule";
import RouteError from "@/components/layout/RouteError";
import LoginPage from "@/pages/login";

type PageModule = { default: React.ComponentType };

/**
 * Each page is its own chunk, loaded when its route is first visited, so the
 * sign-in screen does not download the whole workspace.
 */
const page = (load: () => Promise<PageModule>): Pick<RouteObject, "lazy"> => ({
  lazy: () => load().then((m) => ({ Component: m.default })),
});

/** "/" sends a signed-in user to the workspace and everyone else to sign-in. */
function RootRoute() {
  const token = useAuthStore((s) => s.token);
  return <Navigate to={token ? "/dashboard" : "/login"} replace />;
}

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    // Pages load lazily; render nothing while the first one arrives.
    hydrateFallbackElement: null,
    children: [
      { path: "/", element: <RootRoute /> },
      { path: "/login", element: <LoginPage /> },
      // Public self-service password reset. Requesting the link happens on the
      // sign-in screen; the link lands here.
      { path: "/reset-password", ...page(() => import("@/pages/reset-password")) },
      {
        element: <AppShell />,
        children: [
          { path: "/dashboard", ...page(() => import("@/pages/dashboard")) },
          { path: "/profile", ...page(() => import("@/pages/profile")) },
          // Every area below is gated at the route by the module or governance capability the
          // user's role grants, so typing the URL does not load it (nav.ts only hides the
          // links). The API enforces the same keys per endpoint.
          {
            element: <RequireModule module="audience" />,
            children: [
              { path: "/contacts", ...page(() => import("@/pages/contacts")) },
              { path: "/contacts/:id", ...page(() => import("@/pages/contact-detail")) },
              { path: "/lists", ...page(() => import("@/pages/lists")) },
              { path: "/segments", ...page(() => import("@/pages/segments")) },
              { path: "/segments/new", ...page(() => import("@/pages/segment-editor")) },
              { path: "/segments/:id", ...page(() => import("@/pages/segment-editor")) },
              { path: "/forms", ...page(() => import("@/pages/forms")) },
              { path: "/import", ...page(() => import("@/pages/import")) },
            ],
          },
          {
            element: <RequireModule module="templates" />,
            children: [
              { path: "/templates", ...page(() => import("@/pages/templates")) },
              { path: "/templates/new", ...page(() => import("@/pages/template-editor")) },
              { path: "/templates/:id", ...page(() => import("@/pages/template-editor")) },
            ],
          },
          {
            element: <RequireModule module="campaigns" />,
            children: [
              { path: "/campaigns", ...page(() => import("@/pages/campaigns")) },
              // One route element for new and existing drafts so the composer keeps its state
              // when the first save swaps "new" for the real id in the address.
              { path: "/campaigns/new", element: <Navigate to="/campaigns/new/edit" replace /> },
              { path: "/campaigns/:id/edit", ...page(() => import("@/pages/campaign-composer")) },
              { path: "/campaigns/:id", ...page(() => import("@/pages/campaign-report")) },
            ],
          },
          {
            element: <RequireModule module="channels" />,
            children: [
              { path: "/domains", ...page(() => import("@/pages/domains")) },
              { path: "/domains/:id", ...page(() => import("@/pages/domain-detail")) },
              { path: "/senders", ...page(() => import("@/pages/senders")) },
            ],
          },
          {
            element: <RequireModule module="email" />,
            children: [
              { path: "/messages", ...page(() => import("@/pages/messages")) },
              { path: "/messages/:id", ...page(() => import("@/pages/message-detail")) },
              { path: "/suppressions", ...page(() => import("@/pages/suppressions")) },
              { path: "/reputation", ...page(() => import("@/pages/reputation")) },
            ],
          },
          {
            element: <RequireModule module="audit" />,
            children: [{ path: "/audit", ...page(() => import("@/pages/audit")) }],
          },
          {
            element: <RequireModule module="team" />,
            children: [{ path: "/team", ...page(() => import("@/pages/team")) }],
          },
          {
            element: <RequireModule module="settings" />,
            children: [{ path: "/settings", ...page(() => import("@/pages/settings")) }],
          },
      { path: "*", ...page(() => import("@/pages/not-found")) },
        ],
      },
    ],
  },
]);
