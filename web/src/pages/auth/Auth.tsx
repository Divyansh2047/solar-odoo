import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { acceptInviteSchema, forgotSchema, loginSchema, resetSchema, signupSchema, verifyEmailSchema } from '@arka/shared';
import { api, ApiError } from '../../lib/api';
import { applyServerError, FormError, TextField, useZodForm } from '../../components/form';
import { Button, Callout } from '../../components/ui';
import { DemoButton } from '../../components/DemoButton';

type Mode = 'signin' | 'signup' | 'verify' | 'forgot' | 'invite';

function Side() {
  // a 6×4 module; the lit cells spell out the journey stage count (8 of 24)
  const lit = new Set([0, 7, 8, 13, 15, 20, 22, 23]);
  return (
    <aside className="auth-side" aria-hidden>
      <Link to="/" className="brand" style={{ color: '#fff' }} tabIndex={-1}>
        <span className="brand-mark">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="brand-name">Arka</span>
      </Link>
      <div style={{ display: 'grid', gap: 20 }}>
        <h2>From the first enquiry to the twentieth year.</h2>
        <p>Enquiries that can’t get lost, quotes whose parts list writes itself, serial numbers scanned at dispatch, and warranties that start on their own.</p>
      </div>
      <div className="auth-module">
        {Array.from({ length: 24 }, (_, i) => (
          <i key={i} className={lit.has(i) ? 'lit' : ''} />
        ))}
      </div>
    </aside>
  );
}

function PasswordRules({ value }: { value: string }) {
  const rules = [
    { ok: value.length >= 10, label: 'At least 10 characters' },
    { ok: /[A-Za-z]/.test(value) && /\d/.test(value), label: 'At least one letter and one number' },
    { ok: value.length > 0 && !/^(.)\1+$/.test(value), label: 'Not one character repeated' },
  ];
  return (
    <ul className="pw-rules" aria-label="Password rules">
      {rules.map((r) => (
        <li key={r.label} className={r.ok ? 'ok' : ''}>
          {r.label}
          <span className="sr-only">{r.ok ? ' (met)' : ' (not met yet)'}</span>
        </li>
      ))}
    </ul>
  );
}

function useAfterSignIn() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [params] = useSearchParams();
  return async () => {
    // drop data from any earlier account, then load the new session before leaving this page
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' });
    await qc.refetchQueries({ queryKey: ['session'] });
    const next = params.get('next');
    nav(next && next.startsWith('/app') ? next : '/app', { replace: true });
  };
}

export default function Auth({ mode }: { mode: Mode }) {
  useEffect(() => {
    document.title = { signin: 'Sign in', signup: 'Create your workspace', verify: 'Confirm your email', forgot: 'Reset your password', invite: 'Join your team' }[mode] + ' · Arka';
  }, [mode]);
  return (
    <div className="auth">
      <Side />
      <main className="auth-panel" id="main">
        <div className="auth-card">
          <Link to="/" className="brand mobile-only" style={{ color: 'var(--ink)', padding: 0 }}>
            <span className="brand-mark" style={{ background: 'var(--frame)' }}>
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="brand-name">Arka</span>
          </Link>
          {mode === 'signin' && <SignIn />}
          {mode === 'signup' && <SignUp />}
          {mode === 'verify' && <Verify />}
          {mode === 'forgot' && <Forgot />}
          {mode === 'invite' && <Invite />}
        </div>
      </main>
    </div>
  );
}

function DemoFirst() {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <DemoButton label="Try the live demo instead" className="btn-block-wrap" />
      <span className="muted" style={{ fontSize: 13 }}>
        A private copy of SunPower Solutions with three months of history. No sign‑up needed.
      </span>
    </div>
  );
}

function SignIn() {
  const form = useZodForm(loginSchema, { email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  const done = useAfterSignIn();
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await api.post('/api/auth/login', v);
      await done();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'email_unverified') {
        sessionStorage.setItem('arka-verify', JSON.stringify({ email: v.email, masked: e.data.email, devCode: e.data.devCode }));
        nav('/verify');
        return;
      }
      setError(applyServerError(form, e));
    }
  });
  return (
    <>
      <div>
        <h1>Sign in</h1>
        <p className="sub">Welcome back. Your crew’s day is waiting.</p>
      </div>
      <DemoFirst />
      <div className="auth-or">or with your account</div>
      <form onSubmit={submit} noValidate className="stack">
        <FormError message={error} />
        <TextField form={form as never} name="email" label="Email" type="email" autoComplete="username" inputMode="email" />
        <TextField form={form as never} name="password" label="Password" type="password" autoComplete="current-password" />
        <Button type="submit" variant="dark" size="lg" busy={form.formState.isSubmitting} block>
          Sign in
        </Button>
      </form>
      <p className="row between">
        <Link to="/forgot">Forgot your password?</Link>
        <Link to="/signup">Create a workspace</Link>
      </p>
    </>
  );
}

function SignUp() {
  const form = useZodForm(signupSchema, { companyName: '', name: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();
  const pw = form.watch('password') ?? '';
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await api.post<{ email: string; resendIn: number; devCode?: string }>('/api/auth/signup', v);
      sessionStorage.setItem('arka-verify', JSON.stringify({ email: v.email, masked: r.email, devCode: r.devCode }));
      nav('/verify');
    } catch (e) {
      setError(applyServerError(form, e));
    }
  });
  return (
    <>
      <div>
        <h1>Create your workspace</h1>
        <p className="sub">One workspace for your company. Invite your team after.</p>
      </div>
      <DemoFirst />
      <div className="auth-or">or set up your own</div>
      <form onSubmit={submit} noValidate className="stack">
        <FormError message={error} />
        <TextField form={form as never} name="companyName" label="Company name" autoComplete="organization" placeholder="SunPower Solutions" />
        <TextField form={form as never} name="name" label="Your name" autoComplete="name" />
        <TextField form={form as never} name="email" label="Work email" type="email" autoComplete="email" inputMode="email" />
        <TextField form={form as never} name="phone" label="Mobile" optional type="tel" autoComplete="tel" inputMode="tel" prefix="+91" placeholder="98250 12345" />
        <TextField form={form as never} name="password" label="Password" type="password" autoComplete="new-password" />
        <PasswordRules value={pw} />
        <TextField form={form as never} name="confirmPassword" label="Type it again" type="password" autoComplete="new-password" />
        <Button type="submit" variant="dark" size="lg" busy={form.formState.isSubmitting} block>
          Create workspace
        </Button>
      </form>
      <p>
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </>
  );
}

function Verify() {
  const stored = useMemo(() => {
    try {
      return JSON.parse(sessionStorage.getItem('arka-verify') ?? 'null') as { email: string; masked: string; devCode?: string } | null;
    } catch {
      return null;
    }
  }, []);
  const form = useZodForm(verifyEmailSchema, { email: stored?.email ?? '', code: '' });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState(stored?.devCode);
  const [wait, setWait] = useState(60);
  const done = useAfterSignIn();
  useEffect(() => {
    if (wait <= 0) return;
    const t = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  if (!stored) {
    return (
      <>
        <h1>Confirm your email</h1>
        <Callout>Sign in first and we’ll send a fresh code.</Callout>
        <Link to="/signin">Go to sign in</Link>
      </>
    );
  }
  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await api.post('/api/auth/verify-email', v);
      sessionStorage.removeItem('arka-verify');
      await done();
    } catch (e) {
      setError(applyServerError(form, e));
    }
  });
  return (
    <>
      <div>
        <h1>Check your email</h1>
        <p className="sub">
          We sent a 6-digit code to <b>{stored.masked}</b>. It works for 10 minutes.
        </p>
      </div>
      {devCode && <Callout tone="warn">Development mode: your code is <b className="mono">{devCode}</b>.</Callout>}
      {info && <Callout tone="good">{info}</Callout>}
      <form onSubmit={submit} noValidate className="stack">
        <FormError message={error} />
        <TextField form={form as never} name="code" label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="otp-field" placeholder="••••••" />
        <Button type="submit" variant="dark" size="lg" busy={form.formState.isSubmitting} block>
          Confirm email
        </Button>
      </form>
      <p>
        Didn’t get it?{' '}
        <button
          className="link-btn"
          disabled={wait > 0}
          onClick={async () => {
            setError(null);
            try {
              const r = await api.post<{ devCode?: string }>('/api/auth/resend', { email: stored.email });
              setDevCode(r.devCode);
              setInfo('A new code is on its way. Older codes no longer work.');
              setWait(60);
            } catch (e) {
              setError(e instanceof ApiError ? e.message : 'Couldn’t send a code.');
            }
          }}
        >
          {wait > 0 ? `Send a new code in ${wait} s` : 'Send a new code'}
        </button>
      </p>
    </>
  );
}

const resetStep2 = resetSchema;

function Forgot() {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [masked, setMasked] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const f1 = useZodForm(forgotSchema, { email: '' });
  const f2 = useZodForm(resetStep2, { email: '', code: '', password: '', confirmPassword: '' });
  const done = useAfterSignIn();
  const pw = f2.watch('password') ?? '';
  if (step === 1) {
    return (
      <>
        <div>
          <h1>Reset your password</h1>
          <p className="sub">We’ll email you a 6-digit code.</p>
        </div>
        <form
          noValidate
          className="stack"
          onSubmit={f1.handleSubmit(async (v) => {
            setError(null);
            try {
              const r = await api.post<{ email: string; devCode?: string }>('/api/auth/forgot', v);
              setEmail(v.email);
              setMasked(r.email);
              setDevCode(r.devCode);
              f2.reset({ email: v.email, code: '', password: '', confirmPassword: '' });
              setStep(2);
            } catch (e) {
              setError(applyServerError(f1, e));
            }
          })}
        >
          <FormError message={error} />
          <TextField form={f1 as never} name="email" label="Email" type="email" autoComplete="username" inputMode="email" />
          <Button type="submit" variant="dark" size="lg" busy={f1.formState.isSubmitting} block>
            Send the code
          </Button>
        </form>
        <Link to="/signin">Back to sign in</Link>
      </>
    );
  }
  return (
    <>
      <div>
        <h1>Choose a new password</h1>
        <p className="sub">If an account exists for {masked}, a code is on its way.</p>
      </div>
      {devCode && <Callout tone="warn">Development mode: your code is <b className="mono">{devCode}</b>.</Callout>}
      <form
        noValidate
        className="stack"
        onSubmit={f2.handleSubmit(async (v) => {
          setError(null);
          try {
            await api.post('/api/auth/reset', { ...v, email });
            await done();
          } catch (e) {
            setError(applyServerError(f2, e));
          }
        })}
      >
        <FormError message={error} />
        <TextField form={f2 as never} name="code" label="Code from the email" inputMode="numeric" autoComplete="one-time-code" maxLength={6} />
        <TextField form={f2 as never} name="password" label="New password" type="password" autoComplete="new-password" />
        <PasswordRules value={pw} />
        <TextField form={f2 as never} name="confirmPassword" label="Type it again" type="password" autoComplete="new-password" />
        <Button type="submit" variant="dark" size="lg" busy={f2.formState.isSubmitting} block>
          Save and sign in
        </Button>
      </form>
      <button className="link-btn" onClick={() => setStep(1)}>
        Use a different email
      </button>
    </>
  );
}

function Invite() {
  const { token = '' } = useParams();
  const info = useQuery({ queryKey: ['invite', token], queryFn: () => api.get<{ name: string; email: string; company: string }>(`/api/auth/invite/${token}`), retry: false });
  const form = useZodForm(acceptInviteSchema, { token, password: '', confirmPassword: '' });
  const [error, setError] = useState<string | null>(null);
  const done = useAfterSignIn();
  const pw = form.watch('password') ?? '';
  if (info.isLoading) return <p className="muted">Checking your invitation…</p>;
  if (info.isError)
    return (
      <>
        <h1>This invitation has expired</h1>
        <Callout tone="warn">{info.error instanceof ApiError ? info.error.message : 'Ask your director for a new invitation.'}</Callout>
        <Link to="/signin">Go to sign in</Link>
      </>
    );
  return (
    <>
      <div>
        <h1>Join {info.data!.company}</h1>
        <p className="sub">
          Hello {info.data!.name.split(' ')[0]}. Set a password for {info.data!.email} to start.
        </p>
      </div>
      <form
        noValidate
        className="stack"
        onSubmit={form.handleSubmit(async (v) => {
          setError(null);
          try {
            await api.post('/api/auth/invite/accept', v);
            await done();
          } catch (e) {
            setError(applyServerError(form, e));
          }
        })}
      >
        <FormError message={error} />
        <TextField form={form as never} name="password" label="Password" type="password" autoComplete="new-password" />
        <PasswordRules value={pw} />
        <TextField form={form as never} name="confirmPassword" label="Type it again" type="password" autoComplete="new-password" />
        <Button type="submit" variant="dark" size="lg" busy={form.formState.isSubmitting} block>
          Join the team
        </Button>
      </form>
    </>
  );
}

