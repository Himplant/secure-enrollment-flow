import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Shield, Loader2 } from "lucide-react";
import { INTL_BUILD_ENABLED } from "@/lib/featureFlags";


// Eagerly load the patient-facing enrollment page (critical path)
import EnrollPage from "./pages/EnrollPage";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Lazy-load admin pages — they share heavy deps (TipTap, Recharts, etc.)
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AdminLogin = lazy(() => import("./pages/AdminLogin"));

const AdminProtectedRoute = lazy(() =>
  import("./components/admin/AdminProtectedRoute").then(m => ({ default: m.AdminProtectedRoute }))
);

// International module — lazy so it adds nothing to the U.S. critical path.
const ConsultationPay = lazy(() => import("./pages/ConsultationPay"));
const ConsultationPending = lazy(() => import("./pages/ConsultationPending"));
const ConsultationSuccess = lazy(() => import("./pages/ConsultationSuccess"));

// Clinic / distributor portal (Phase 3) — also flag-gated.
const PortalLogin = lazy(() => import("./pages/PortalLogin"));
const PortalDashboard = lazy(() => import("./pages/PortalDashboard"));
const PortalPaymentAccount = lazy(() => import("./pages/PortalPaymentAccount"));
const PortalReports = lazy(() => import("./pages/PortalReports"));
const PortalTeam = lazy(() => import("./pages/PortalTeam"));
const PortalSelectWorkspace = lazy(() => import("./pages/PortalSelectWorkspace"));
const PortalProtectedRoute = lazy(() =>
  import("./components/portal/PortalProtectedRoute").then(m => ({ default: m.PortalProtectedRoute }))
);


const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s before refetch
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AdminFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/enroll/:token" element={<EnrollPage />} />
          <Route path="/admin/login" element={
            <Suspense fallback={<AdminFallback />}>
              <AdminLogin />
            </Suspense>
          } />
          <Route path="/admin" element={
            <Suspense fallback={<AdminFallback />}>
              <AdminProtectedRoute>
                <AdminDashboard />
              </AdminProtectedRoute>
            </Suspense>
          } />
          {INTL_BUILD_ENABLED && (
            <>
              <Route path="/consult/:token" element={
                <Suspense fallback={<AdminFallback />}><ConsultationPay /></Suspense>
              } />
              <Route path="/consult/:token/pending" element={
                <Suspense fallback={<AdminFallback />}><ConsultationPending /></Suspense>
              } />
              <Route path="/consult/:token/success" element={
                <Suspense fallback={<AdminFallback />}><ConsultationSuccess /></Suspense>
              } />
              <Route path="/portal/login" element={
                <Suspense fallback={<AdminFallback />}><PortalLogin /></Suspense>
              } />
              <Route path="/portal" element={
                <Suspense fallback={<AdminFallback />}>
                  <PortalProtectedRoute><PortalDashboard /></PortalProtectedRoute>
                </Suspense>
              } />
              <Route path="/portal/payment-account" element={
                <Suspense fallback={<AdminFallback />}>
                  <PortalProtectedRoute><PortalPaymentAccount /></PortalProtectedRoute>
                </Suspense>
              } />
              <Route path="/portal/reports" element={
                <Suspense fallback={<AdminFallback />}>
                  <PortalProtectedRoute><PortalReports /></PortalProtectedRoute>
                </Suspense>
              } />
              <Route path="/portal/team" element={
                <Suspense fallback={<AdminFallback />}>
                  <PortalProtectedRoute><PortalTeam /></PortalProtectedRoute>
                </Suspense>
              } />
              <Route path="/portal/select-workspace" element={
                <Suspense fallback={<AdminFallback />}>
                  <PortalProtectedRoute><PortalSelectWorkspace /></PortalProtectedRoute>
                </Suspense>
              } />
              <Route path="/portal/distributor" element={
                <Suspense fallback={<AdminFallback />}>
                  <PortalProtectedRoute><PortalDashboard /></PortalProtectedRoute>
                </Suspense>
              } />

            </>
          )}
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />

        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
