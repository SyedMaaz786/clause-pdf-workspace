import { HttpError, runtime } from './runtime';
export const emailReady = () => Boolean(runtime().RESEND_API_KEY && runtime().EMAIL_FROM && runtime().APP_URL);
export async function sendEmail(to: string, subject: string, text: string) {
  const e = runtime();
  if (!emailReady()) throw new HttpError(503, 'Email delivery is not configured. You can still copy and share a secure link.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: e.EMAIL_FROM, to: [to], subject, text }), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new HttpError(502, 'The email could not be delivered. Please try again.');
}
