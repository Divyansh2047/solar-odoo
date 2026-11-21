import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Copy } from '@phosphor-icons/react';
import { ROLES, ROLE_LABEL, formatDateTime, formatINR, inviteSchema, paiseToRupeesString, profileSchema, relativeTime, rupees, settingsSchema, changePasswordSchema, type Role } from '@arka/shared';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';
import { shownEmail } from '../../lib/demo';
import { Button, Callout, Chip, ErrorBlock, PageHead, Panel, Seg, SkeletonRows } from '../../components/ui';
import { DataTable } from '../../components/table';
import { Dialog, useToast } from '../../components/overlay';
import { applyServerError, CheckField, FormError, SelectField, TextField, useZodForm } from '../../components/form';

type Tab = 'team' | 'company' | 'me' | 'audit';

export default function Settings() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>(can('team.manage') ? 'team' : 'me');
  useEffect(() => {
    document.title = 'Team and settings · Arka';
  }, []);
  return (
    <div className="page">
      <PageHead title="Team and settings" lead="People, roles and company details." />
      <Seg
        label="Section"
        variant="tabs"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'team', label: 'Team' },
          ...(can('settings.manage') ? [{ value: 'company' as Tab, label: 'Company' }, { value: 'audit' as Tab, label: 'Change log' }] : []),
          { value: 'me', label: 'My account' },
        ]}
      />
      {tab === 'team' && <Team />}
      {tab === 'company' && <Company />}
      {tab === 'me' && <MyAccount />}
      {tab === 'audit' && <Audit />}
    </div>
  );
}

interface Person {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  status: 'invited' | 'active' | 'disabled';
  hourly_cost_paise: number | null;
  last_seen_at: string | null;
}

function Team() {
  const q = useQuery({ queryKey: ['team'], queryFn: () => api.get<{ people: Person[] }>('/api/team') });
  const { can, me } = useSession();
  const [invite, setInvite] = useState(false);
  const [edit, setEdit] = useState<Person | null>(null);
  const manage = can('team.manage');
  return (
    <Panel title={`${q.data?.people.length ?? ''} people`} actions={manage && <Button variant="primary" icon={<Plus size={18} />} onClick={() => setInvite(true)}>Invite someone</Button>}>
      {q.isLoading ? (
        <SkeletonRows />
      ) : (
        <DataTable
          rows={q.data?.people ?? []}
          rowKey={(r) => r.id}
          columns={[
            { header: 'Name', cell: (r) => (<><span className="cell-main">{r.name}{r.id === me?.id ? ' (you)' : ''}</span><div className="cell-sub">{shownEmail(r.email, me?.companyKind === 'demo')}</div></>) },
            { header: 'Role', cell: (r) => ROLE_LABEL[r.role] },
            { header: 'Status', cell: (r) => <Chip tone={r.status === 'active' ? 'good' : r.status === 'invited' ? 'warn' : 'neutral'}>{r.status === 'active' ? 'Active' : r.status === 'invited' ? 'Invited' : 'Switched off'}</Chip> },
            { header: 'Cost per hour', className: 'r', cell: (r) => (r.role === 'technician' && r.hourly_cost_paise !== null ? formatINR(r.hourly_cost_paise) : '—') },
            { header: 'Last seen', cell: (r) => (r.last_seen_at ? relativeTime(r.last_seen_at) : <span className="muted">Never</span>) },
            ...(manage ? [{ header: '', cell: (r: Person) => r.id !== me?.id && <Button size="sm" onClick={() => setEdit(r)}>Change</Button> }] : []),
          ]}
          card={(r) => ({ title: r.name, right: <span>{ROLE_LABEL[r.role]}</span>, meta: [shownEmail(r.email, me?.companyKind === 'demo')], extra: manage && r.id !== me?.id ? <Button size="sm" onClick={() => setEdit(r)}>Change</Button> : undefined })}
        />
      )}
      {invite && <InviteDialog onClose={() => setInvite(false)} />}
      {edit && <EditPerson person={edit} onClose={() => setEdit(null)} />}
    </Panel>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const schema = inviteSchema.safeExtend({ hourlyCostPaise: rupees().optional() }) as unknown as typeof inviteSchema;
  const form = useZodForm(schema, { name: '', email: '', phone: '', role: 'technician', hourlyCostPaise: '' as never });
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const role = form.watch('role');
  return (
    <Dialog open onClose={onClose} title="Invite someone" description="They get an email with a link to set their password. The link works for 72 hours.">
      {link ? (
        <div className="stack">
          <Callout tone="good">Invitation created. In a demo no email is sent, so share this link yourself:</Callout>
          <input className="input mono" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <div className="form-actions">
            <Button
              icon={<Copy size={16} />}
              onClick={async () => {
                await navigator.clipboard?.writeText(link).catch(() => {});
                toast('Invitation link copied.');
              }}
            >
              Copy
            </Button>
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          noValidate
          className="stack"
          onSubmit={form.handleSubmit(async (v) => {
            setError(null);
            try {
              const r = await api.post<{ id: number; inviteUrl?: string }>('/api/team/invite', v);
              void qc.invalidateQueries({ queryKey: ['team'] });
              if (r.inviteUrl) setLink(r.inviteUrl);
              else {
                toast(`Invitation sent to ${v.email}.`);
                onClose();
              }
            } catch (e) {
              setError(applyServerError(form, e));
            }
          })}
        >
          <FormError message={error} />
          <div className="form-grid">
            <TextField form={form as never} name="name" label="Name" />
            <TextField form={form as never} name="email" label="Email" type="email" />
            <SelectField form={form as never} name="role" label="Role" options={ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
            <TextField form={form as never} name="phone" label="Mobile" optional type="tel" prefix="+91" />
            {role === 'technician' && <TextField form={form as never} name="hourlyCostPaise" label="Cost per hour" prefix="₹" inputMode="decimal" hint="Used for job profit and pay." />}
          </div>
          <div className="form-actions">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
              Send invitation
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

function EditPerson({ person, onClose }: { person: Person; onClose: () => void }) {
  const [role, setRole] = useState<Role>(person.role);
  const [cost, setCost] = useState(person.hourly_cost_paise !== null ? paiseToRupeesString(person.hourly_cost_paise) : '0');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/team/${person.id}`, patch);
      toast('Saved. A role change signs them out everywhere.');
      void qc.invalidateQueries({ queryKey: ['team'] });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={onClose} title={`Change ${person.name}`}>
      {error && <div className="form-error">{error}</div>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ep-role">Role</label>
          <select id="ep-role" className="select" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ep-cost">Cost per hour</label>
          <div className="input-affix">
            <span className="affix">₹</span>
            <input id="ep-cost" className="input num" value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="form-actions">
        {person.status !== 'invited' &&
          (person.status === 'disabled' ? (
            <Button busy={busy} onClick={() => save({ active: true })}>
              Switch back on
            </Button>
          ) : (
            <Button variant="danger" busy={busy} onClick={() => save({ active: false })}>
              Switch off
            </Button>
          ))}
        <Button variant="primary" busy={busy} onClick={() => save({ role, hourlyCostPaise: Math.round(Number(cost) * 100) })}>
          Save
        </Button>
      </div>
    </Dialog>
  );
}

function Company() {
  const q = useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ company: Record<string, unknown> }>('/api/settings') });
  if (q.isLoading) return <SkeletonRows />;
  if (q.isError) return <ErrorBlock error={q.error} />;
  return <CompanyForm c={q.data!.company} />;
}

function CompanyForm({ c }: { c: Record<string, unknown> }) {
  const schema = settingsSchema.safeExtend({
    labourRatePaise: rupees(),
    subsidySlab1PerKwPaise: rupees(),
    subsidySlab2PerKwPaise: rupees(),
    subsidyCapPaise: rupees(),
  }) as unknown as typeof settingsSchema;
  const r = (k: string) => paiseToRupeesString(Number(c[k] ?? 0));
  const form = useZodForm(schema, {
    name: String(c.name ?? ''),
    phone: (c.phone as string | null)?.replace('+91', '') ?? '',
    email: (c.email as string) ?? '',
    address: (c.address as string) ?? '',
    gstin: (c.gstin as string) ?? '',
    advancePercent: c.advance_percent as never,
    labourRatePaise: r('labour_rate_paise') as never,
    slaFirstCallMinutes: c.sla_first_call_minutes as never,
    quoteValidityDays: c.quote_validity_days as never,
    subsidyEnabled: Boolean(c.subsidy_enabled),
    subsidySlab1PerKwPaise: r('subsidy_slab1_per_kw_paise') as never,
    subsidySlab2PerKwPaise: r('subsidy_slab2_per_kw_paise') as never,
    subsidyCapPaise: r('subsidy_cap_paise') as never,
  });
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  return (
    <form
      noValidate
      className="stack"
      onSubmit={form.handleSubmit(async (v) => {
        setError(null);
        try {
          await api.put('/api/settings', v);
          toast('Company settings saved.');
          void qc.invalidateQueries({ queryKey: ['settings'] });
          void qc.invalidateQueries({ queryKey: ['session'] });
        } catch (e) {
          setError(applyServerError(form, e));
        }
      })}
    >
      <FormError message={error} />
      <Panel title="Company">
        <div className="panel-body form-grid">
          <TextField form={form as never} name="name" label="Company name" />
          <TextField form={form as never} name="gstin" label="GSTIN" optional className="mono" />
          <TextField form={form as never} name="phone" label="Phone" optional prefix="+91" />
          <TextField form={form as never} name="email" label="Email" optional type="email" />
          <TextField form={form as never} name="address" label="Address" optional className="span-2" />
        </div>
      </Panel>
      <Panel title="How work runs">
        <div className="panel-body form-grid">
          <TextField form={form as never} name="slaFirstCallMinutes" label="Call new enquiries within" suffix="minutes" inputMode="numeric" hint="Older uncalled enquiries turn red." />
          <TextField form={form as never} name="advancePercent" label="Advance to confirm an order" suffix="%" inputMode="numeric" />
          <TextField form={form as never} name="quoteValidityDays" label="Quotes are valid for" suffix="days" inputMode="numeric" />
          <TextField form={form as never} name="labourRatePaise" label="Labour rate billed out of warranty" prefix="₹" suffix="/ hour" inputMode="decimal" />
        </div>
      </Panel>
      <Panel title="Subsidy scheme (PM Surya Ghar)">
        <div className="panel-body form-grid">
          <CheckField form={form as never} name="subsidyEnabled" label="Show the subsidy on quotes for on-grid homes" className="span-2" />
          <TextField form={form as never} name="subsidySlab1PerKwPaise" label="Per kW for the first 2 kW" prefix="₹" inputMode="decimal" />
          <TextField form={form as never} name="subsidySlab2PerKwPaise" label="Per kW for the 3rd kW" prefix="₹" inputMode="decimal" />
          <TextField form={form as never} name="subsidyCapPaise" label="Maximum per home" prefix="₹" inputMode="decimal" />
        </div>
      </Panel>
      <div className="form-actions">
        <Button type="submit" variant="primary" busy={form.formState.isSubmitting}>
          Save settings
        </Button>
      </div>
    </form>
  );
}

function MyAccount() {
  const { me, refresh } = useSession();
  const pf = useZodForm(profileSchema, { name: me?.name ?? '', phone: '' });
  const pw = useZodForm(changePasswordSchema, { currentPassword: '', password: '', confirmPassword: '' });
  const [e1, setE1] = useState<string | null>(null);
  const [e2, setE2] = useState<string | null>(null);
  const toast = useToast();
  return (
    <div className="split even">
      <Panel title="Profile">
        <form
          noValidate
          className="panel-body stack"
          onSubmit={pf.handleSubmit(async (v) => {
            setE1(null);
            try {
              await api.patch('/api/auth/me', v);
              toast('Profile saved.');
              await refresh();
            } catch (e) {
              setE1(applyServerError(pf, e));
            }
          })}
        >
          <FormError message={e1} />
          <TextField form={pf as never} name="name" label="Name" />
          <TextField form={pf as never} name="phone" label="Mobile" optional prefix="+91" />
          <p className="muted" style={{ fontSize: 14 }}>
            Email: {shownEmail(me?.email, me?.companyKind === 'demo')}
          </p>
          <div className="form-actions">
            <Button type="submit" variant="primary" busy={pf.formState.isSubmitting}>
              Save
            </Button>
          </div>
        </form>
      </Panel>
      <Panel title="Password">
        <form
          noValidate
          className="panel-body stack"
          onSubmit={pw.handleSubmit(async (v) => {
            setE2(null);
            try {
              await api.post('/api/auth/password', v);
              toast('Password changed. Other devices were signed out.');
              pw.reset();
            } catch (e) {
              setE2(applyServerError(pw, e));
            }
          })}
        >
          <FormError message={e2} />
          <TextField form={pw as never} name="currentPassword" label="Current password" type="password" autoComplete="current-password" />
          <TextField form={pw as never} name="password" label="New password" type="password" autoComplete="new-password" hint="10+ characters with a letter and a number." />
          <TextField form={pw as never} name="confirmPassword" label="Type it again" type="password" autoComplete="new-password" />
          <div className="form-actions">
            <Button
              onClick={async () => {
                await api.post('/api/auth/logout-all');
                location.href = '/signin';
              }}
            >
              Sign out everywhere
            </Button>
            <Button type="submit" variant="primary" busy={pw.formState.isSubmitting}>
              Change password
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

function Audit() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => api.get<{ entries: { id: number; action: string; entity: string; entity_id: number | null; detail: unknown; created_at: string; actor: string | null }[] }>('/api/audit') });
  return (
    <Panel title="Who changed settings, prices and roles">
      {q.isLoading ? (
        <SkeletonRows />
      ) : (
        <table className="table">
          <tbody>
            {q.data?.entries.map((e) => (
              <tr key={e.id}>
                <td className="nowrap">{formatDateTime(e.created_at)}</td>
                <td>{e.actor ?? 'System'}</td>
                <td>
                  {e.action.replace('.', ' ')}
                  <div className="cell-sub mono">{e.detail ? JSON.stringify(e.detail).slice(0, 140) : ''}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
