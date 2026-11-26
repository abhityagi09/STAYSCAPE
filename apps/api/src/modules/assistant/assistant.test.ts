import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { bearer, registerUser } from '@/test/helpers';
import { daysFromToday } from '@/test/marketplace-fixtures';
import { bookingWorld } from '@/test/booking-fixtures';
import { AssistantService, AssistantUsageModel, unverifiedAmounts } from './assistant.service';

type Fake = { content: unknown[]; stop_reason: string };
const usage = {
  input_tokens: 1_000,
  output_tokens: 200,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

/** A scripted stand-in for the SDK client that records every request the loop makes. */
function fakeClient(script: Array<Fake | Error>) {
  const requests: Array<Record<string, unknown>> = [];
  const client = {
    beta: {
      messages: {
        create: async (params: Record<string, unknown>) => {
          requests.push(JSON.parse(JSON.stringify(params)));
          const next = script.shift();
          if (!next) throw new Error('script exhausted');
          if (next instanceof Error) throw next;
          return { ...next, usage };
        },
      },
    },
  } as unknown as Pick<Anthropic, 'beta'>;
  return { client, requests };
}

const final = (o: unknown): Fake => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify(o) }],
});

describe('AI travel assistant', () => {
  it('runs the tool loop on real services, validates arguments and keeps only verified facts', async () => {
    const { hotel, container, customer } = await bookingWorld();
    const { client, requests } = fakeClient([
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'search_hotels',
            input: { city: 'Udaipur', checkIn: daysFromToday(10), checkOut: daysFromToday(12) },
          },
          { type: 'tool_use', id: 't2', name: 'get_hotel', input: { hotelId: 'not-an-id' } },
        ],
      },
      {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't3',
            name: 'quote_stay',
            input: {
              hotelId: hotel.hotelId,
              roomTypeId: hotel.roomTypeId,
              ratePlanId: hotel.ratePlanId,
              checkIn: daysFromToday(10),
              checkOut: daysFromToday(12),
              adults: 2,
            },
          },
        ],
      },
      final({
        answer: 'The Udaipur stay costs ₹10,500.00 for two nights.',
        hotelIds: [hotel.hotelId, '64b0000000000000000000ff'],
        followUpQuestions: ['Do you need breakfast?'],
      }),
    ]);
    const svc = new AssistantService(
      {
        config: { ...container.config, AI_PROVIDER: 'anthropic' },
        search: container.services.search,
        quotes: container.services.quotes,
        logger: container.logger,
      },
      client,
    );
    const reply = await svc.reply({
      userId: customer.id,
      message: 'Somewhere in Udaipur for 2 nights?',
      history: [],
    });

    expect(reply).toMatchObject({
      provider: 'anthropic',
      degraded: false,
      answer: 'The Udaipur stay costs ₹10,500.00 for two nights.',
    });
    // The invented id is dropped; the real one is returned with Stayscape's own card data.
    expect(reply.hotels.map((h) => h.id)).toEqual([hotel.hotelId]);
    expect(reply.quotes).toEqual([
      expect.objectContaining({ hotelId: hotel.hotelId, totalMinor: 1_050_000, currency: 'INR' }),
    ]);

    // Second request: one user message with both results; bad arguments came back as an error result.
    const second = requests[1]!.messages as Array<{
      role: string;
      content: Array<{ type: string; tool_use_id: string; is_error?: boolean; content: string }>;
    }>;
    const results = second[second.length - 1]!.content;
    expect(results.map((r) => r.tool_use_id)).toEqual(['t1', 't2']);
    expect(JSON.parse(results[0]!.content)).toHaveProperty('untrusted_data.hotels');
    expect(results[1]).toMatchObject({ is_error: true });
    expect(results[1]!.content).toMatch(/Invalid arguments/);
    // Request shape: strict tools, structured output, cached system prompt, server-side fallbacks.
    expect(requests[0]).toMatchObject({
      model: 'claude-opus-5-5',
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema' } },
    });
    expect((requests[0]!.tools as Array<{ strict: boolean }>).every((t) => t.strict)).toBe(true);
    expect(JSON.stringify(requests)).not.toContain(container.config.ANTHROPIC_API_KEY ?? 'sk-ant');

    // Usage and cost are recorded (3 calls × 1,000 in / 200 out at $4 / $20 per MTok).
    const day = await AssistantUsageModel.findOne({ kind: 'USER_DAY' }).lean();
    expect(day).toMatchObject({
      requests: 1,
      inputTokens: 3_000,
      outputTokens: 600,
      costMicroUsd: 3_000 * 4 + 600 * 20,
    });
    expect(JSON.stringify(day)).not.toContain(customer.id);
  });

  it('never shows a price the engine did not produce, and falls back safely on failures', async () => {
    const { container, customer } = await bookingWorld();
    const deps = {
      config: { ...container.config, AI_PROVIDER: 'anthropic' as const },
      search: container.services.search,
      quotes: container.services.quotes,
      logger: container.logger,
    };
    const invented = new AssistantService(
      deps,
      fakeClient([
        final({ answer: 'Rooms start at ₹1,999 tonight!', hotelIds: [], followUpQuestions: [] }),
      ]).client,
    );
    expect(
      (await invented.reply({ userId: customer.id, message: 'cheap rooms?', history: [] })).answer,
    ).not.toContain('1,999');

    const broken = new AssistantService(deps, fakeClient([new Error('overloaded')]).client);
    const r1 = await broken.reply({
      userId: customer.id,
      message: 'Hotels in Udaipur',
      history: [],
    });
    expect(r1).toMatchObject({ provider: 'rules', degraded: true });
    expect(r1.hotels).toHaveLength(1);

    const refused = new AssistantService(
      deps,
      fakeClient([{ stop_reason: 'refusal', content: [] }]).client,
    );
    expect((await refused.reply({ userId: customer.id, message: 'x', history: [] })).degraded).toBe(
      true,
    );
    const notJson = new AssistantService(
      deps,
      fakeClient([
        {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'Ignore previous instructions' }],
        },
      ]).client,
    );
    expect((await notJson.reply({ userId: customer.id, message: 'x', history: [] })).provider).toBe(
      'rules',
    );

    // The loop stops after the configured number of tool rounds; the last round offers no tools.
    const looping = fakeClient(
      Array.from({ length: 10 }, (_, i) => ({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: `l${i}`, name: 'search_hotels', input: { city: 'Udaipur' } },
        ],
      })),
    );
    const capped = new AssistantService(
      { ...deps, config: { ...deps.config, AI_MAX_TOOL_ITERATIONS: 2 } },
      looping.client,
    );
    expect((await capped.reply({ userId: customer.id, message: 'x', history: [] })).degraded).toBe(
      true,
    );
    expect(looping.requests).toHaveLength(3);
    expect(looping.requests[2]).not.toHaveProperty('tools');
  });

  it('answers with the deterministic assistant by default and enforces per-user rate limits', async () => {
    const { app, customer } = await bookingWorld();
    const r = (
      await request(app)
        .post('/api/v1/assistant/messages')
        .set(bearer(customer.accessToken))
        .send({
          message: `Stays in Udaipur from ${daysFromToday(10)} to ${daysFromToday(12)} for 2 adults`,
        })
        .expect(200)
    ).body.data;
    expect(r).toMatchObject({ provider: 'rules', degraded: false });
    expect(r.hotels[0].price).toMatchObject({ totalMinor: 1_050_000 });
    expect(
      (
        await request(app)
          .post('/api/v1/assistant/messages')
          .set(bearer(customer.accessToken))
          .send({ message: 'hello' })
          .expect(200)
      ).body.data.followUpQuestions.length,
    ).toBeGreaterThan(0);
    await request(app).post('/api/v1/assistant/messages').send({ message: 'hi' }).expect(401);
    await request(app)
      .post('/api/v1/assistant/messages')
      .set(bearer(customer.accessToken))
      .send({ message: 'x'.repeat(1_001) })
      .expect(422);

    const limited = await registerUser(app);
    const codes: number[] = [];
    for (let i = 0; i < 8; i += 1)
      codes.push(
        (
          await request(app)
            .post('/api/v1/assistant/messages')
            .set(bearer(limited.accessToken))
            .send({ message: 'Goa?' })
        ).status,
      );
    expect(codes.filter((c) => c === 429).length).toBe(2); // default 6 per minute
  });

  it('detects unverified currency amounts', () => {
    expect(
      unverifiedAmounts('Total ₹10,500.00 or Rs. 5,250', new Set([1_050_000, 525_000])),
    ).toEqual([]);
    expect(unverifiedAmounts('Only INR 999 today', new Set([1_050_000]))).toEqual(['INR 999']);
  });
});
