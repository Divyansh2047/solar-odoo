import { StrictMode, Suspense, lazy, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation, useRouteError, Link } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/pages.css';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider } from './components/overlay';
import { ApiError } from './lib/api';
import { AppShell } from './layout/AppShell';
import { SkeletonRows } from './components/ui';

const Landing = lazy(() => import('./pages/landing/Landing'));
const Auth = lazy(() => import('./pages/auth/Auth'));
const Enquire = lazy(() => import('./pages/public/Enquire'));
const QuotePublic = lazy(() => import('./pages/public/QuotePublic'));
const InvoicePublic = lazy(() => import('./pages/public/InvoicePublic'));
const Portal = lazy(() => import('./pages/public/Portal'));
const SharedReport = lazy(() => import('./pages/public/SharedReport'));
const Home = lazy(() => import('./pages/app/Home'));
const Enquiries = lazy(() => import('./pages/app/Enquiries'));
const EnquiryDetail = lazy(() => import('./pages/app/EnquiryDetail'));
const Surveys = lazy(() => import('./pages/app/Surveys'));
const SurveyDetail = lazy(() => import('./pages/app/SurveyDetail'));
const Quotes = lazy(() => import('./pages/app/Quotes'));
const QuoteDetail = lazy(() => import('./pages/app/QuoteDetail'));
const Jobs = lazy(() => import('./pages/app/Jobs'));
const JobDetail = lazy(() => import('./pages/app/JobDetail'));
const Warehouse = lazy(() => import('./pages/app/Warehouse'));
const PickList = lazy(() => import('./pages/app/PickList'));
const Schedule = lazy(() => import('./pages/app/Schedule'));
const Service = lazy(() => import('./pages/app/Service'));
const TicketDetail = lazy(() => import('./pages/app/TicketDetail'));
const Money = lazy(() => import('./pages/app/Money'));
const InvoiceDetail = lazy(() => import('./pages/app/InvoiceDetail'));
const Reports = lazy(() => import('./pages/app/Reports'));
const Catalog = lazy(() => import('./pages/app/Catalog'));
const ProductDetail = lazy(() => import('./pages/app/ProductDetail'));
const Settings = lazy(() => import('./pages/app/Settings'));
const CustomerDetail = lazy(() => import('./pages/app/CustomerDetail'));
const SerialDetail = lazy(() => import('./pages/app/SerialDetail'));
const InstallReport = lazy(() => import('./pages/app/InstallReport'));

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
    },
    mutations: { retry: false },
  },
});

function Page({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="page">
          <SkeletonRows rows={8} />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

function RequireAuth() {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading)
    return (
      <div className="page" aria-busy="true">
        <SkeletonRows rows={8} />
      </div>
    );
  if (!me) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <AppShell />;
}

function RouteError() {
  const err = useRouteError() as Error | undefined;
  return (
    <div className="public">
      <div />
      <div className="public-main" role="alert" style={{ display: 'grid', gap: 12, alignContent: 'center' }}>
        <h1>This page didn’t open</h1>
        <p className="muted">{err?.message ?? 'Something went wrong.'}</p>
        <p>
          <Link to="/app">Go to Today</Link> or <button className="link-btn" onClick={() => location.reload()}>reload the page</button>.
        </p>
      </div>
      <div />
    </div>
  );
}

function NotFound() {
  return (
    <div className="page narrow" style={{ paddingTop: 64 }}>
      <h1>Nothing on this roof</h1>
      <p className="muted" style={{ marginTop: 8 }}>
        That page doesn’t exist. <Link to="/app">Go to Today</Link>.
      </p>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <Page><Landing /></Page>, errorElement: <RouteError /> },
  { path: '/signin', element: <Page><Auth mode="signin" /></Page> },
  { path: '/signup', element: <Page><Auth mode="signup" /></Page> },
  { path: '/verify', element: <Page><Auth mode="verify" /></Page> },
  { path: '/forgot', element: <Page><Auth mode="forgot" /></Page> },
  { path: '/invite/:token', element: <Page><Auth mode="invite" /></Page> },
  { path: '/enquire/:key', element: <Page><Enquire /></Page> },
  { path: '/q/:token', element: <Page><QuotePublic /></Page> },
  { path: '/i/:token', element: <Page><InvoicePublic /></Page> },
  { path: '/my/:token', element: <Page><Portal /></Page> },
  { path: '/r/:token', element: <Page><SharedReport /></Page> },
  {
    path: '/app',
    element: <RequireAuth />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Page><Home /></Page> },
      { path: 'enquiries', element: <Page><Enquiries /></Page> },
      { path: 'enquiries/:id', element: <Page><EnquiryDetail /></Page> },
      { path: 'surveys', element: <Page><Surveys /></Page> },
      { path: 'surveys/:id', element: <Page><SurveyDetail /></Page> },
      { path: 'quotes', element: <Page><Quotes /></Page> },
      { path: 'quotes/:id', element: <Page><QuoteDetail /></Page> },
      { path: 'jobs', element: <Page><Jobs /></Page> },
      { path: 'jobs/:id', element: <Page><JobDetail /></Page> },
      { path: 'jobs/:id/install', element: <Page><InstallReport /></Page> },
      { path: 'warehouse', element: <Page><Warehouse /></Page> },
      { path: 'warehouse/pick/:id', element: <Page><PickList /></Page> },
      { path: 'schedule', element: <Page><Schedule /></Page> },
      { path: 'service', element: <Page><Service /></Page> },
      { path: 'service/:id', element: <Page><TicketDetail /></Page> },
      { path: 'money', element: <Page><Money /></Page> },
      { path: 'money/:tab', element: <Page><Money /></Page> },
      { path: 'money/invoices/:id', element: <Page><InvoiceDetail /></Page> },
      { path: 'reports', element: <Page><Reports /></Page> },
      { path: 'catalog', element: <Page><Catalog /></Page> },
      { path: 'catalog/:id', element: <Page><ProductDetail /></Page> },
      { path: 'settings', element: <Page><Settings /></Page> },
      { path: 'customers/:id', element: <Page><CustomerDetail /></Page> },
      { path: 'serials/:id', element: <Page><SerialDetail /></Page> },
      { path: '*', element: <NotFound /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
