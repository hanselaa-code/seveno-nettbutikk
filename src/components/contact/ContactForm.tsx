import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ValidationError, validateContactMessageInput } from '../../lib/validators';
import { getContactRepository } from '../../repositories/contactRepository';
import type { IContactRepository } from '../../repositories/contactRepository';
import { FirestoreNetworkError } from '../../repositories/firestoreUtils';
import type { ContactMessage, CreateContactMessageInput } from '../../types/domain';

export interface ContactFormProps {
  contactRepo?: IContactRepository;
  onSubmitMessage?: (input: CreateContactMessageInput) => Promise<ContactMessage>;
}

export function ContactForm({ contactRepo, onSubmitMessage }: ContactFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submittingRef = useRef(false);

  const clearFieldError = (field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (submittingRef.current) {
      return;
    }

    setSubmitError(null);
    setSubmittedMessage(null);

    const validation = validateContactMessageInput({ name, email, subject, message });
    if (!validation.valid || !validation.value) {
      setFieldErrors(validation.errors);
      return;
    }

    setFieldErrors({});
    submittingRef.current = true;
    setSubmitting(true);

    try {
      if (onSubmitMessage) {
        await onSubmitMessage(validation.value);
      } else if (contactRepo) {
        await contactRepo.create(validation.value);
      } else {
        await getContactRepository().create(validation.value);
      }

      setName('');
      setEmail('');
      setSubject('');
      setMessage('');
      setFieldErrors({});
      setSubmittedMessage('Takk for din henvendelse! Vi svarer deg så snart som mulig.');
    } catch (error) {
      if (error instanceof ValidationError) {
        setFieldErrors(error.errors);
      } else if (error instanceof FirestoreNetworkError) {
        setSubmitError(error.message);
      } else {
        setSubmitError(
          'Vi klarte ikke å sende henvendelsen akkurat nå. Vennligst prøv igjen om litt.',
        );
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const inputBaseClass =
    'mt-1.5 w-full rounded-md border bg-canvas px-3.5 py-2.5 text-sm text-espresso placeholder:text-taupe/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze';

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="rounded-xl border border-sand bg-ivory p-6 shadow-nordic sm:p-8"
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="contact-name" className="block text-sm font-medium text-espresso">
            Fullt navn
          </label>
          <input
            id="contact-name"
            name="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearFieldError('name');
            }}
            aria-invalid={Boolean(fieldErrors.name)}
            aria-describedby={fieldErrors.name ? 'contact-name-error' : undefined}
            placeholder="Ola Nordmann"
            className={`${inputBaseClass} ${fieldErrors.name ? 'border-error' : 'border-sand'}`}
          />
          {fieldErrors.name && (
            <p id="contact-name-error" role="alert" className="mt-1.5 text-xs font-medium text-error">
              {fieldErrors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="contact-email" className="block text-sm font-medium text-espresso">
            E-postadresse
          </label>
          <input
            id="contact-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearFieldError('email');
            }}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? 'contact-email-error' : undefined}
            placeholder="ola@eksempel.no"
            className={`${inputBaseClass} ${fieldErrors.email ? 'border-error' : 'border-sand'}`}
          />
          {fieldErrors.email && (
            <p id="contact-email-error" role="alert" className="mt-1.5 text-xs font-medium text-error">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="contact-subject" className="block text-sm font-medium text-espresso">
            Emne
          </label>
          <input
            id="contact-subject"
            name="subject"
            type="text"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              clearFieldError('subject');
            }}
            aria-invalid={Boolean(fieldErrors.subject)}
            aria-describedby={fieldErrors.subject ? 'contact-subject-error' : undefined}
            placeholder="Spørsmål om produkt eller levering"
            className={`${inputBaseClass} ${fieldErrors.subject ? 'border-error' : 'border-sand'}`}
          />
          {fieldErrors.subject && (
            <p
              id="contact-subject-error"
              role="alert"
              className="mt-1.5 text-xs font-medium text-error"
            >
              {fieldErrors.subject}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="contact-message" className="block text-sm font-medium text-espresso">
            Melding
          </label>
          <textarea
            id="contact-message"
            name="message"
            rows={5}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              clearFieldError('message');
            }}
            aria-invalid={Boolean(fieldErrors.message)}
            aria-describedby={fieldErrors.message ? 'contact-message-error' : undefined}
            placeholder="Skriv din melding her..."
            className={`${inputBaseClass} ${fieldErrors.message ? 'border-error' : 'border-sand'}`}
          />
          {fieldErrors.message && (
            <p
              id="contact-message-error"
              role="alert"
              className="mt-1.5 text-xs font-medium text-error"
            >
              {fieldErrors.message}
            </p>
          )}
        </div>

        {submitError && (
          <div
            role="alert"
            className="rounded-md border border-error/30 bg-canvas px-4 py-3 text-sm font-medium text-error"
          >
            {submitError}
          </div>
        )}

        {submittedMessage && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-md border border-success/30 bg-canvas px-4 py-3 text-sm font-medium text-success"
          >
            {submittedMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-md bg-bronze px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-bronze-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {submitting ? 'Sender henvendelse ...' : 'Send henvendelse'}
        </button>
      </div>
    </form>
  );
}
