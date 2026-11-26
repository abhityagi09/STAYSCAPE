import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
  personNameSchema,
  phoneSchema,
  type UserDto,
} from '@stayscape/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ImageUploader,
  Input,
  useToast,
} from '@/components/ui';
import { errorMessage } from '@/lib/api/errors';
import { applyServerErrors } from '@/lib/forms';
import { useUpdateProfile, useUploadAvatar } from '../api';
import { tr } from '@/lib/tr';

const profileFormSchema = z.object({
  firstName: personNameSchema('First name'),
  lastName: personNameSchema('Last name'),
  phone: z.union([phoneSchema, z.literal('')]),
});
type ProfileFormValues = z.infer<typeof profileFormSchema>;

export function AvatarCard({ user }: { user: UserDto }) {
  const upload = useUploadAvatar();
  const { toast } = useToast();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr('Profile photo')}</CardTitle>
        <CardDescription>
          {tr('Shown to properties you book with and on reviews you write.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ImageUploader
          label={tr('Upload a new photo')}
          currentUrl={user.avatarUrl}
          accept={AVATAR_MIME_TYPES}
          maxBytes={AVATAR_MAX_BYTES}
          uploading={upload.isPending}
          onUpload={async (file) => {
            try {
              await upload.mutateAsync(file);
              toast({ title: tr('Profile photo updated'), variant: 'success' });
            } catch (error) {
              throw new Error(errorMessage(error));
            }
          }}
        />
      </CardContent>
    </Card>
  );
}

export function ProfileForm({ user }: { user: UserDto }) {
  const update = useUpdateProfile();
  const { toast } = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    values: { firstName: user.firstName, lastName: user.lastName, phone: user.phone ?? '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const updated = await update.mutateAsync({
        firstName: values.firstName,
        lastName: values.lastName,
        phone: values.phone === '' ? null : values.phone,
      });
      reset({
        firstName: updated.firstName,
        lastName: updated.lastName,
        phone: updated.phone ?? '',
      });
      toast({ title: tr('Profile saved'), variant: 'success' });
    } catch (error) {
      setFormError(applyServerErrors(error, setError, ['firstName', 'lastName', 'phone']));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr('Personal details')}</CardTitle>
        <CardDescription>
          {tr('Use the name that appears on your ID — properties may check it at arrival.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <div className="grid gap-5 sm:grid-cols-2">
            <Input
              label={tr('First name')}
              autoComplete="given-name"
              required
              error={errors.firstName?.message}
              {...register('firstName')}
            />
            <Input
              label={tr('Last name')}
              autoComplete="family-name"
              required
              error={errors.lastName?.message}
              {...register('lastName')}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Input
              label={tr('Email')}
              type="email"
              value={user.email}
              readOnly
              disabled
              hint={tr('Contact support to change the email on your account.')}
            />
            <div>
              {user.emailVerified ? (
                <Badge tone="success">{tr('Verified')}</Badge>
              ) : (
                <Badge tone="warning">{tr('Not verified')}</Badge>
              )}
            </div>
          </div>
          <Input
            label={tr('Mobile number')}
            type="tel"
            autoComplete="tel"
            optionalLabel
            placeholder="+919876543210"
            error={errors.phone?.message}
            {...register('phone', { setValueAs: (v: string) => v.replace(/[\s-]/g, '') })}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={!isDirty || isSubmitting} onClick={() => reset()}>
              {tr('Discard')}
            </Button>
            <Button type="submit" disabled={!isDirty} loading={isSubmitting} loadingText="Saving…">
              {tr('Save changes')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
