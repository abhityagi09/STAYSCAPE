/**
 * Reads messages captured by the local Mailpit server (the configured test email service).
 * https://mailpit.axllent.org/docs/api-v1/
 */
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

interface MailpitSummary {
  ID: string;
  Subject: string;
  To: Array<{ Address: string }>;
  Created: string;
}

async function search(to: string): Promise<MailpitSummary[]> {
  const url = `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Mailpit search failed: ${response.status}`);
  const body = (await response.json()) as { messages: MailpitSummary[] };
  return body.messages ?? [];
}

/** Wait for an email to `to` whose subject matches, then return the first link in its text. */
export async function waitForEmailLink(
  to: string,
  subject: RegExp,
  pathPattern: RegExp,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = (await search(to)).filter((message) => subject.test(message.Subject));
    for (const message of messages) {
      const detail = (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
      ).json()) as { Text: string };
      const link = detail.Text.match(/https?:\/\/\S+/g)?.find((candidate) =>
        pathPattern.test(candidate),
      );
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No email matching ${subject} arrived for ${to} within ${timeoutMs}ms`);
}

export async function mailpitAvailable(): Promise<boolean> {
  try {
    return (await fetch(`${MAILPIT_URL}/api/v1/info`)).ok;
  } catch {
    return false;
  }
}
