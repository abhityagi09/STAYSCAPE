import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Check, CircleAlert, Clock, Download, FileUp, Trash2 } from 'lucide-react';
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_LABELS,
  DOCUMENT_MAX_BYTES,
  PARTNER_DOCUMENT_LABELS,
  PARTNER_DOCUMENT_TYPES,
  PARTNER_EDITABLE_STATUSES,
  REQUIRED_PARTNER_DOCUMENTS,
  addressSchema,
  partnerBusinessSchema,
  partnerTaxSchema,
  settlementAccountInputSchema,
  emailSchema,
  phoneSchema,
  type PartnerApplicationDto,
  type PartnerDocumentType,
} from '@stayscape/shared';
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  Input,
  PageHeader,
  PageSpinner,
  Select,
  useToast,
} from '@/components/ui';
import { useAuth } from '@/features/auth/use-auth';
import { errorMessage, normalizeApiError } from '@/lib/api/errors';
import { applyServerErrors } from '@/lib/forms';
import { cn } from '@/lib/cn';
import { partnerApi, useApplication, useApplicationMutation } from '../api';
import { tr, trf } from '@/lib/tr';

const STEPS = [
  'Business',
  'Address & contact',
  'Registration & tax',
  'Documents',
  'Settlement account',
  'Review & submit',
] as const;

const contactFormSchema = z.object({
  businessAddress: addressSchema,
  contactDetails: z.object({
    email: emailSchema,
    phone: phoneSchema,
    website: z.union([z.url('Enter a valid URL'), z.literal('')]),
  }),
});

function StatusPanel({ app }: { app: PartnerApplicationDto }) {
  const map = {
    REGISTERED: {
      tone: 'info' as const,
      title: tr('Application in progress'),
      body: tr('Complete every step and submit for review. Your progress is saved as you go.'),
    },
    DOCUMENTS_PENDING: {
      tone: 'warning' as const,
      title: tr('More information needed'),
      body: app.rejectionReason ?? 'Update the requested documents and resubmit.',
    },
    UNDER_REVIEW: {
      tone: 'info' as const,
      title: tr('Under review'),
      body: tr(
        'Our verification team is reviewing your application. You will be notified of the decision.',
      ),
    },
    APPROVED: {
      tone: 'success' as const,
      title: tr('Approved'),
      body: tr('Your partner account is active. You can now add properties.'),
    },
    REJECTED: {
      tone: 'danger' as const,
      title: tr('Not approved'),
      body: trf('{0} You can update your application and resubmit.', [
        app.rejectionReason ?? 'See the reason from our team.',
      ]),
    },
    SUSPENDED: {
      tone: 'danger' as const,
      title: tr('Suspended'),
      body: app.rejectionReason ?? 'Contact support.',
    },
  }[app.verificationStatus];
  return (
    <Alert
      tone={map.tone}
      title={map.title}
      action={
        app.verificationStatus === 'APPROVED' ? (
          <ButtonLink to="/partner/properties" size="sm">
            {tr('Manage properties')}
          </ButtonLink>
        ) : undefined
      }
    >
      {map.body}
    </Alert>
  );
}

function StepHeader({ title, description }: { title: string; description: string }) {
  return (
    <CardHeader>
      <CardTitle as="h2">{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}

function BusinessStep({
  app,
  onSaved,
}: {
  app: PartnerApplicationDto | null;
  onSaved: () => void;
}) {
  const save = useApplicationMutation(partnerApi.saveDraft);
  const { register, handleSubmit, setError, formState } = useForm({
    resolver: zodResolver(partnerBusinessSchema),
    values: {
      businessName: app?.business.businessName ?? '',
      businessType: app?.business.businessType ?? 'PRIVATE_LIMITED',
      ownerName: app?.business.ownerName ?? '',
    },
  });
  const [error, setFormError] = useState<string | null>(null);
  return (
    <form
      noValidate
      onSubmit={handleSubmit(async (business) => {
        try {
          await save.mutateAsync({ business });
          onSaved();
        } catch (e) {
          setFormError(applyServerErrors(e, setError, []));
        }
      })}
      className="flex flex-col gap-5"
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <Input
        label={tr('Owner / authorised signatory name')}
        required
        error={formState.errors.ownerName?.message}
        {...register('ownerName')}
      />
      <Input
        label={tr('Registered business name')}
        required
        error={formState.errors.businessName?.message}
        {...register('businessName')}
      />
      <Select
        label={tr('Business type')}
        required
        options={BUSINESS_TYPES.map((t) => ({ value: t, label: tr(BUSINESS_TYPE_LABELS[t]) }))}
        {...register('businessType')}
      />
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          {tr('Save and continue')}
        </Button>
      </div>
    </form>
  );
}

function ContactStep({ app, onSaved }: { app: PartnerApplicationDto | null; onSaved: () => void }) {
  const save = useApplicationMutation(partnerApi.saveDraft);
  const a = app?.contact.businessAddress ?? {};
  const c = app?.contact.contactDetails ?? {};
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(contactFormSchema),
    values: {
      businessAddress: {
        line1: a.line1 ?? '',
        line2: a.line2 ?? '',
        city: a.city ?? '',
        state: a.state ?? '',
        postalCode: a.postalCode ?? '',
        country: a.country ?? 'IN',
      },
      contactDetails: { email: c.email ?? '', phone: c.phone ?? '', website: c.website ?? '' },
    },
  });
  const e = formState.errors;
  return (
    <form
      noValidate
      onSubmit={handleSubmit(async (contact) => {
        await save.mutateAsync({ contact });
        onSaved();
      })}
      className="grid gap-5 sm:grid-cols-2"
    >
      {save.error && (
        <Alert tone="danger" className="sm:col-span-2">
          {errorMessage(save.error)}
        </Alert>
      )}
      <Input
        label={tr('Address line 1')}
        required
        containerClassName="sm:col-span-2"
        error={e.businessAddress?.line1?.message}
        {...register('businessAddress.line1')}
      />
      <Input
        label={tr('Address line 2')}
        optionalLabel
        containerClassName="sm:col-span-2"
        {...register('businessAddress.line2')}
      />
      <Input
        label={tr('City')}
        required
        error={e.businessAddress?.city?.message}
        {...register('businessAddress.city')}
      />
      <Input
        label={tr('State')}
        required
        error={e.businessAddress?.state?.message}
        {...register('businessAddress.state')}
      />
      <Input
        label={tr('Postal code')}
        required
        error={e.businessAddress?.postalCode?.message}
        {...register('businessAddress.postalCode')}
      />
      <Input
        label={tr('Country code')}
        required
        hint={tr('2 letters, e.g. IN')}
        error={e.businessAddress?.country?.message}
        {...register('businessAddress.country')}
      />
      <Input
        label={tr('Business email')}
        type="email"
        required
        error={e.contactDetails?.email?.message}
        {...register('contactDetails.email')}
      />
      <Input
        label={tr('Business phone')}
        type="tel"
        required
        hint={tr('International format')}
        error={e.contactDetails?.phone?.message}
        {...register('contactDetails.phone')}
      />
      <Input
        label={tr('Website')}
        optionalLabel
        containerClassName="sm:col-span-2"
        error={e.contactDetails?.website?.message}
        {...register('contactDetails.website')}
      />
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" loading={save.isPending}>
          {tr('Save and continue')}
        </Button>
      </div>
    </form>
  );
}

function TaxStep({ app, onSaved }: { app: PartnerApplicationDto | null; onSaved: () => void }) {
  const save = useApplicationMutation(partnerApi.saveDraft);
  const { register, handleSubmit, formState } = useForm({
    resolver: zodResolver(partnerTaxSchema),
    values: {
      registrationNumber: app?.tax.registrationNumber ?? '',
      taxDetails: { pan: app?.tax.taxDetails?.pan ?? '', gstin: app?.tax.taxDetails?.gstin ?? '' },
    },
  });
  const e = formState.errors;
  return (
    <form
      noValidate
      onSubmit={handleSubmit(async (tax) => {
        await save.mutateAsync({ tax });
        onSaved();
      })}
      className="flex flex-col gap-5"
    >
      {save.error && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
      <Input
        label={tr('Business registration number')}
        required
        hint={tr('e.g. CIN, LLPIN or Udyam number')}
        error={e.registrationNumber?.message}
        {...register('registrationNumber')}
      />
      <Input
        label="PAN"
        required
        autoCapitalize="characters"
        error={e.taxDetails?.pan?.message}
        {...register('taxDetails.pan')}
      />
      <Input
        label="GSTIN"
        optionalLabel
        autoCapitalize="characters"
        hint={tr('Required if your business is GST-registered')}
        error={e.taxDetails?.gstin?.message}
        {...register('taxDetails.gstin')}
      />
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          {tr('Save and continue')}
        </Button>
      </div>
    </form>
  );
}

function DocumentsStep({
  app,
  editable,
}: {
  app: PartnerApplicationDto | null;
  editable: boolean;
}) {
  const upload = useApplicationMutation(
    ({ type, file }: { type: PartnerDocumentType; file: File }) =>
      partnerApi.uploadDocument(type, file),
  );
  const remove = useApplicationMutation(partnerApi.removeDocument);
  const { toast } = useToast();
  const [busy, setBusy] = useState<PartnerDocumentType | null>(null);
  const download = async (id: string, name: string) => {
    try {
      const res = await partnerApi.downloadDocument(id);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast({ title: tr('Download failed'), description: errorMessage(error), variant: 'error' });
    }
  };
  return (
    <ul className="flex flex-col divide-y divide-border">
      {PARTNER_DOCUMENT_TYPES.map((type) => {
        const doc = app?.documents.find((d) => d.type === type);
        const required = REQUIRED_PARTNER_DOCUMENTS.includes(type);
        return (
          <li
            key={type}
            className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="flex items-center gap-2 text-sm font-medium">
                {tr(PARTNER_DOCUMENT_LABELS[type])}{' '}
                {required ? (
                  <Badge tone="warning">{tr('Required')}</Badge>
                ) : (
                  <Badge>{tr('Optional')}</Badge>
                )}
              </p>
              {doc ? (
                <p className="text-xs text-success">
                  ✓ {doc.fileName} · {(doc.size / 1024).toFixed(0)} {tr('KB')}
                </p>
              ) : (
                <p className="text-xs text-fg-subtle">
                  {tr(
                    'PDF, JPEG or PNG up to 5 MB. Stored privately; visible only to you and our verification team.',
                  )}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {doc && (
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Download className="size-4" aria-hidden="true" />}
                  onClick={() => void download(doc.id, doc.fileName)}
                >
                  {tr('Download')}
                </Button>
              )}
              {doc && editable && (
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<Trash2 className="size-4" aria-hidden="true" />}
                  loading={remove.isPending && remove.variables === doc.id}
                  onClick={() => remove.mutate(doc.id)}
                >
                  {tr('Remove')}
                </Button>
              )}
              {editable && (
                <label
                  className={cn(
                    'inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-border-strong px-4 text-sm font-medium hover:bg-surface-muted',
                    busy === type && 'opacity-60',
                  )}
                >
                  <FileUp className="size-4" aria-hidden="true" />
                  {busy === type ? tr('Uploading…') : doc ? tr('Replace') : tr('Upload')}
                  <input
                    type="file"
                    className="sr-only"
                    accept="application/pdf,image/jpeg,image/png"
                    aria-label={trf('Upload {0}', [PARTNER_DOCUMENT_LABELS[type]])}
                    disabled={busy !== null}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      if (file.size > DOCUMENT_MAX_BYTES)
                        return toast({
                          title: tr('File too large'),
                          description: tr('Documents must be 5 MB or smaller.'),
                          variant: 'error',
                        });
                      setBusy(type);
                      try {
                        await upload.mutateAsync({ type, file });
                        toast({ title: tr('Document uploaded'), variant: 'success' });
                      } catch (error) {
                        toast({
                          title: tr('Upload failed'),
                          description: errorMessage(error),
                          variant: 'error',
                        });
                      } finally {
                        setBusy(null);
                      }
                    }}
                  />
                </label>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SettlementStep({
  app,
  onSaved,
}: {
  app: PartnerApplicationDto | null;
  onSaved: () => void;
}) {
  const save = useApplicationMutation(partnerApi.saveDraft);
  const { register, handleSubmit, formState, reset } = useForm({
    resolver: zodResolver(settlementAccountInputSchema),
    defaultValues: {
      accountHolderName: app?.settlementAccount?.accountHolderName ?? '',
      bankName: app?.settlementAccount?.bankName ?? '',
      ifsc: app?.settlementAccount?.ifsc ?? '',
      accountNumber: '',
    },
  });
  const e = formState.errors;
  return (
    <form
      noValidate
      onSubmit={handleSubmit(async (settlementAccount) => {
        await save.mutateAsync({ settlementAccount });
        reset({ ...settlementAccount, accountNumber: '' });
        onSaved();
      })}
      className="flex flex-col gap-5"
    >
      {app?.settlementAccount && (
        <Alert tone="success">
          {tr('Account ending')} {app.settlementAccount.accountNumberLast4} {tr('saved (reference')}{' '}
          {app.settlementAccount.reference}
          {tr('). Enter details again only to change it.')}
        </Alert>
      )}
      {save.error && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
      <Input
        label={tr('Account holder name')}
        required
        error={e.accountHolderName?.message}
        {...register('accountHolderName')}
      />
      <Input
        label={tr('Bank name')}
        required
        error={e.bankName?.message}
        {...register('bankName')}
      />
      <Input
        label="IFSC"
        required
        autoCapitalize="characters"
        error={e.ifsc?.message}
        {...register('ifsc')}
      />
      <Input
        label={tr('Account number')}
        required
        inputMode="numeric"
        autoComplete="off"
        hint={tr('Encrypted at rest. Only the last 4 digits are ever shown.')}
        error={e.accountNumber?.message}
        {...register('accountNumber')}
      />
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending}>
          {tr('Save and continue')}
        </Button>
      </div>
    </form>
  );
}

export function PartnerOnboardingPage() {
  const application = useApplication();
  const { user } = useAuth();
  const { toast } = useToast();
  const submit = useApplicationMutation(() => partnerApi.submit());
  const [step, setStep] = useState(0);
  const app = application.data ?? null;
  const editable = !app || PARTNER_EDITABLE_STATUSES.includes(app.verificationStatus);
  useEffect(() => {
    if (app && !editable) setStep(5);
  }, [app, editable]);

  if (application.isPending) return <PageSpinner label={tr('Loading your application')} />;
  if (application.isError)
    return (
      <ErrorState
        description={errorMessage(application.error)}
        onRetry={() => void application.refetch()}
      />
    );

  const complete = [
    Boolean(app?.business.businessName && app.business.ownerName && app.business.businessType),
    Boolean(app?.contact.businessAddress?.city && app.contact.contactDetails?.email),
    Boolean(app?.tax.registrationNumber && app.tax.taxDetails?.pan),
    REQUIRED_PARTNER_DOCUMENTS.every((t) => app?.documents.some((d) => d.type === t)),
    Boolean(app?.settlementAccount),
    app ? !PARTNER_EDITABLE_STATUSES.includes(app.verificationStatus) : false,
  ];
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={tr('Partner onboarding')}
        title={tr('Become a STAYSCAPE partner')}
        description={tr(
          'Tell us about your business. Your progress is saved after each step, so you can return any time.',
        )}
      />
      {app && <StatusPanel app={app} />}
      {!user?.emailVerified && (
        <Alert tone="warning">
          {tr('Verify your email address before submitting — we use it for verification updates.')}
        </Alert>
      )}
      <nav aria-label={tr('Onboarding progress')}>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStep(i)}
                aria-current={step === i ? 'step' : undefined}
                className={cn(
                  'flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-colors',
                  step === i
                    ? 'border-primary bg-primary-soft text-primary'
                    : 'border-border hover:bg-surface-muted',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px]',
                    complete[i] ? 'border-success bg-success text-white' : 'border-border-strong',
                  )}
                >
                  {complete[i] ? <Check className="size-3.5" aria-hidden="true" /> : i + 1}
                </span>
                {label}
                <span className="sr-only">
                  {complete[i] ? tr('(complete)') : tr('(incomplete)')}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface-muted"
        role="progressbar"
        aria-label={tr('Application completeness')}
        aria-valuemin={0}
        aria-valuemax={5}
        aria-valuenow={complete.slice(0, 5).filter(Boolean).length}
      >
        <div
          className="h-full bg-primary transition-[width] duration-500"
          style={{ width: `${(complete.slice(0, 5).filter(Boolean).length / 5) * 100}%` }}
        />
      </div>

      <Card>
        {step === 0 && (
          <>
            <StepHeader
              title={tr('Owner and business information')}
              description={tr('As it appears on your registration documents.')}
            />
            <CardContent>
              {editable ? <BusinessStep app={app} onSaved={next} /> : <ReadOnly />}
            </CardContent>
          </>
        )}
        {step === 1 && (
          <>
            <StepHeader
              title={tr('Business address and contact details')}
              description={tr('Where your business is registered and how we can reach you.')}
            />
            <CardContent>
              {editable ? <ContactStep app={app} onSaved={next} /> : <ReadOnly />}
            </CardContent>
          </>
        )}
        {step === 2 && (
          <>
            <StepHeader
              title={tr('Registration and tax information')}
              description={tr('Used to verify your business and issue tax-compliant invoices.')}
            />
            <CardContent>
              {editable ? <TaxStep app={app} onSaved={next} /> : <ReadOnly />}
            </CardContent>
          </>
        )}
        {step === 3 && (
          <>
            <StepHeader
              title={tr('Verification documents')}
              description={tr('Upload clear scans or photos. Required documents are marked.')}
            />
            <CardContent>
              {app ? (
                <DocumentsStep app={app} editable={editable} />
              ) : (
                <Alert tone="info">{tr('Save the business step first.')}</Alert>
              )}
            </CardContent>
          </>
        )}
        {step === 4 && (
          <>
            <StepHeader
              title={tr('Settlement account')}
              description={tr('Where payouts for your bookings will be sent.')}
            />
            <CardContent>
              {editable ? <SettlementStep app={app} onSaved={next} /> : <ReadOnly />}
            </CardContent>
          </>
        )}
        {step === 5 && (
          <>
            <StepHeader
              title={tr('Review and submit')}
              description={tr(
                'Check everything is complete. Our team usually reviews applications within a few working days.',
              )}
            />
            <CardContent className="flex flex-col gap-4">
              {app?.missingRequirements.length ? (
                <Alert tone="warning" title={tr('Still needed')}>
                  <ul className="list-disc pl-5">
                    {app.missingRequirements.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </Alert>
              ) : app ? (
                <Alert tone="success">{tr('All steps are complete.')}</Alert>
              ) : (
                <Alert tone="info">{tr('Start with the business step.')}</Alert>
              )}
              {app && (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-fg-subtle">{tr('Business')}</dt>
                    <dd>{app.business.businessName ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-subtle">{tr('City')}</dt>
                    <dd>{app.contact.businessAddress?.city ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-subtle">{tr('PAN')}</dt>
                    <dd>{app.tax.taxDetails?.pan ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-subtle">{tr('Documents')}</dt>
                    <dd>
                      {app.documents.length} {tr('uploaded')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-subtle">{tr('Settlement account')}</dt>
                    <dd>
                      {app.settlementAccount
                        ? `•••• ${app.settlementAccount.accountNumberLast4}`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-subtle">{tr('Status')}</dt>
                    <dd className="flex items-center gap-1">
                      {app.verificationStatus === 'UNDER_REVIEW' ? (
                        <Clock className="size-4" aria-hidden="true" />
                      ) : app.verificationStatus === 'REJECTED' ? (
                        <CircleAlert className="size-4 text-danger" aria-hidden="true" />
                      ) : null}
                      {app.verificationStatus.replace('_', ' ').toLowerCase()}
                    </dd>
                  </div>
                </dl>
              )}
              {editable && (
                <div className="flex justify-end">
                  <Button
                    disabled={!app || app.missingRequirements.length > 0 || !user?.emailVerified}
                    loading={submit.isPending}
                    onClick={() =>
                      submit.mutate(undefined, {
                        onSuccess: () =>
                          toast({
                            title: tr('Application submitted'),
                            description: tr('We will notify you when it has been reviewed.'),
                            variant: 'success',
                          }),
                        onError: (e) =>
                          toast({
                            title: tr('Could not submit'),
                            description: normalizeApiError(e).message,
                            variant: 'error',
                          }),
                      })
                    }
                  >
                    {tr('Submit for review')}
                  </Button>
                </div>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}

function ReadOnly() {
  return (
    <p className="text-sm text-fg-muted">
      {tr("This application has been submitted and can't be edited while it is reviewed.")}
    </p>
  );
}
