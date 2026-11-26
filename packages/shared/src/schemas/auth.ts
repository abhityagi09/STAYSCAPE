import { z } from 'zod';
import { emailSchema, personNameSchema, phoneSchema } from './common';

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const PASSWORD_RULES = [
  {
    id: 'length',
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (v: string) => v.length >= PASSWORD_MIN_LENGTH,
  },
  { id: 'lower', label: 'One lowercase letter', test: (v: string) => /[a-z]/.test(v) },
  { id: 'upper', label: 'One uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { id: 'digit', label: 'One number', test: (v: string) => /\d/.test(v) },
] as const;

export const passwordSchema = z
  .string({ message: 'Password is required' })
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer`)
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/\d/, 'Password must include a number');

/** Optional phone: empty strings from forms are treated as "not provided". */
const optionalPhone = z
  .union([phoneSchema, z.literal('')])
  .optional()
  .transform((value) => (value ? value : undefined));

export const registerSchema = z.strictObject({
  firstName: personNameSchema('First name'),
  lastName: personNameSchema('Last name'),
  email: emailSchema,
  phone: optionalPhone,
  password: passwordSchema,
  acceptTerms: z.boolean().refine((value) => value, 'You must accept the terms to continue'),
});
export type RegisterInput = z.input<typeof registerSchema>;
export type RegisterPayload = z.output<typeof registerSchema>;

/** Frontend-only extension: confirm password never leaves the browser. */
export const registerFormSchema = registerSchema
  .extend({ confirmPassword: z.string().min(1, 'Please confirm your password') })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type RegisterFormValues = z.input<typeof registerFormSchema>;

export const loginSchema = z.strictObject({
  email: emailSchema,
  // Do not apply strength rules on login: legacy or admin-set passwords must still authenticate.
  password: z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.input<typeof loginSchema>;

export const forgotPasswordSchema = z.strictObject({ email: emailSchema });
export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

const tokenSchema = z
  .string({ message: 'Token is required' })
  .trim()
  .min(20, 'This link is invalid')
  .max(200, 'This link is invalid')
  .regex(/^[A-Za-z0-9_-]+$/, 'This link is invalid');

export const resetPasswordSchema = z.strictObject({ token: tokenSchema, password: passwordSchema });
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export const resetPasswordFormSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordFormValues = z.input<typeof resetPasswordFormSchema>;

export const verifyEmailSchema = z.strictObject({ token: tokenSchema });
export type VerifyEmailInput = z.input<typeof verifyEmailSchema>;

export const resendVerificationSchema = z.strictObject({ email: emailSchema });
export type ResendVerificationInput = z.input<typeof resendVerificationSchema>;

export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1, 'Current password is required').max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Please confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });
export type ChangePasswordFormValues = z.input<typeof changePasswordFormSchema>;

/** Self-service account deletion: re-authenticate and type DELETE to confirm. */
export const deleteAccountSchema = z.strictObject({
  password: z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH),
  confirm: z.literal('DELETE', { error: 'Type DELETE to confirm' }),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
