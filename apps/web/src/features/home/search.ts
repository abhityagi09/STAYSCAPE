import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date');

/** Stay search criteria. Dates are property-local calendar dates (no time zone). */
export const staySearchSchema = z
  .object({
    destination: z.string().trim().min(2, 'Where are you going?').max(80),
    checkIn: isoDate,
    checkOut: isoDate,
    adults: z.number().int().min(1).max(16),
    children: z.number().int().min(0).max(10),
    rooms: z.number().int().min(1).max(8),
  })
  .superRefine((value, ctx) => {
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (value.checkIn < todayIso)
      ctx.addIssue({
        code: 'custom',
        path: ['checkIn'],
        message: 'Check-in cannot be in the past',
      });
    if (value.checkOut <= value.checkIn)
      ctx.addIssue({
        code: 'custom',
        path: ['checkOut'],
        message: 'Check-out must be after check-in',
      });
    const nights = (Date.parse(value.checkOut) - Date.parse(value.checkIn)) / 86_400_000;
    if (nights > 30)
      ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Stays can be up to 30 nights' });
    if (value.rooms > value.adults)
      ctx.addIssue({
        code: 'custom',
        path: ['rooms'],
        message: 'Each room needs at least one adult',
      });
  });

export type StaySearch = z.infer<typeof staySearchSchema>;

export function toSearchParams(search: StaySearch): URLSearchParams {
  return new URLSearchParams({
    destination: search.destination,
    checkIn: search.checkIn,
    checkOut: search.checkOut,
    adults: String(search.adults),
    children: String(search.children),
    rooms: String(search.rooms),
  });
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);
}
