import type { QuoteDto } from '@stayscape/shared';
import { formatMinorUnits } from '@stayscape/shared';
import { Accordion } from '@/components/ui';

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const day = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00Z`));

/** Every line that makes up a quote — the total is always fully explained. */
export function PriceBreakdown({ quote }: { quote: QuoteDto }) {
  const money = (v: number) => formatMinorUnits(v, quote.currency);
  const { totals } = quote;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="flex flex-col gap-1.5">
        <div className="flex justify-between">
          <dt>
            {quote.rooms} room{quote.rooms === 1 ? '' : 's'} × {quote.nights} night
            {quote.nights === 1 ? '' : 's'}
          </dt>
          <dd className="tabular-nums">{money(totals.roomChargesMinor)}</dd>
        </div>
        {totals.discountsMinor !== 0 && (
          <div className="flex justify-between text-success">
            <dt>Discounts</dt>
            <dd className="tabular-nums">{money(totals.discountsMinor)}</dd>
          </div>
        )}
        {quote.taxes.map((t) => (
          <div key={t.label} className="flex justify-between text-fg-muted">
            <dt>{t.label}</dt>
            <dd className="tabular-nums">{money(t.amountMinor)}</dd>
          </div>
        ))}
        {quote.fees.map((f) => (
          <div key={f.label} className="flex justify-between text-fg-muted">
            <dt>{f.label}</dt>
            <dd className="tabular-nums">{money(f.amountMinor)}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{money(totals.totalMinor)}</dd>
        </div>
      </dl>
      <Accordion
        className="text-xs"
        items={[
          {
            id: 'nightly',
            title: 'Night-by-night breakdown',
            content: (
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Nightly prices</caption>
                <thead>
                  <tr className="text-fg-subtle">
                    <th scope="col" className="py-1 font-medium">
                      Night
                    </th>
                    <th scope="col" className="py-1 font-medium">
                      Room rate
                    </th>
                    <th scope="col" className="py-1 text-right font-medium">
                      All rooms
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {quote.nightly.map((n) => (
                    <tr key={n.date} className="border-t border-border align-top">
                      <td className="py-1.5">{day(n.date)}</td>
                      <td className="py-1.5">
                        {money(n.baseMinor)}
                        {n.adjustments.map((a) => (
                          <span key={a.label} className="block text-fg-subtle">
                            {a.label}: {a.amountMinor >= 0 ? '+' : ''}
                            {money(a.amountMinor)}
                          </span>
                        ))}
                        {n.supplementsMinor > 0 && (
                          <span className="block text-fg-subtle">
                            Guests & meals: +{money(n.supplementsMinor)}
                          </span>
                        )}
                        {n.discounts.map((d) => (
                          <span key={d.label} className="block text-success">
                            {d.label}: {money(d.amountMinor)}
                          </span>
                        ))}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{money(n.lineMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ),
          },
        ]}
      />
      <p className="text-xs text-fg-subtle">
        Quote valid until{' '}
        {new Date(quote.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
        Prices are rechecked before booking.
      </p>
    </div>
  );
}
