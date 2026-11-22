import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactForm } from '../../src/components/contact/ContactForm';
import { ValidationError } from '../../src/lib/validators';
import { LocalContactRepository } from '../../src/repositories/contactRepository';
import type { IContactRepository } from '../../src/repositories/contactRepository';
import type { ContactMessage } from '../../src/types/domain';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ContactForm & LocalContactRepository (M2)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('validates invalid inputs with Norwegian inline alerts and does not call repository', async () => {
    const user = userEvent.setup();
    const createMock = vi.fn();
    const repo: IContactRepository = {
      create: createMock,
      listAll: vi.fn().mockResolvedValue([]),
    };

    render(<ContactForm contactRepo={repo} />);

    // Submit empty form
    await user.click(screen.getByRole('button', { name: 'Send henvendelse' }));

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByLabelText('Fullt navn')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('E-postadresse')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Emne')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Melding')).toHaveAttribute('aria-invalid', 'true');
    expect(createMock).not.toHaveBeenCalled();

    // Fill invalid email (noValidate ensures custom validator runs)
    await user.type(screen.getByLabelText('Fullt navn'), 'Kari Nordmann');
    await user.type(screen.getByLabelText('E-postadresse'), 'ugyldig-epost');
    await user.type(screen.getByLabelText('Emne'), 'Spørsmål om pergola');
    await user.type(
      screen.getByLabelText('Melding'),
      'Hei, jeg lurer på leveringstid til Bergen.',
    );
    await user.click(screen.getByRole('button', { name: 'Send henvendelse' }));

    expect(screen.getByText('Oppgi en gyldig e-postadresse.')).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('persists valid contact submission via repository, resets form, and shows confirmation', async () => {
    const user = userEvent.setup();
    const localRepo = new LocalContactRepository('test_contact_storage');
    const createSpy = vi.spyOn(localRepo, 'create');

    render(<ContactForm contactRepo={localRepo} />);

    await user.type(screen.getByLabelText('Fullt navn'), '  Henrik Solberg  ');
    await user.type(screen.getByLabelText('E-postadresse'), 'henrik@seveno.no');
    await user.type(screen.getByLabelText('Emne'), 'Leveringstid');
    await user.type(
      screen.getByLabelText('Melding'),
      'Hei! Hvor lang er leveringstiden på Army sekk til Oslo?',
    );

    await user.click(screen.getByRole('button', { name: 'Send henvendelse' }));

    expect(
      await screen.findByText('Takk for din henvendelse! Vi svarer deg så snart som mulig.'),
    ).toBeInTheDocument();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledWith({
      name: 'Henrik Solberg',
      email: 'henrik@seveno.no',
      subject: 'Leveringstid',
      message: 'Hei! Hvor lang er leveringstiden på Army sekk til Oslo?',
    });

    expect(screen.getByLabelText('Fullt navn')).toHaveValue('');
    expect(screen.getByLabelText('E-postadresse')).toHaveValue('');
    expect(screen.getByLabelText('Emne')).toHaveValue('');
    expect(screen.getByLabelText('Melding')).toHaveValue('');

    const stored = await localRepo.listAll();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.status).toBe('new');
    expect(stored[0]?.email).toBe('henrik@seveno.no');
  });

  it('prevents double submission while request is in flight', async () => {
    const user = userEvent.setup();
    const deferred = createDeferred<ContactMessage>();
    const createMock = vi.fn().mockReturnValue(deferred.promise);
    const repo: IContactRepository = {
      create: createMock,
      listAll: vi.fn().mockResolvedValue([]),
    };

    render(<ContactForm contactRepo={repo} />);

    await user.type(screen.getByLabelText('Fullt navn'), 'Ingrid Bakke');
    await user.type(screen.getByLabelText('E-postadresse'), 'ingrid@example.no');
    await user.type(screen.getByLabelText('Emne'), 'Skobeholder');
    await user.type(
      screen.getByLabelText('Melding'),
      'Kan akryl skobeholder stables i fire høyder?',
    );

    const submitButton = screen.getByRole('button', { name: 'Send henvendelse' });
    await user.click(submitButton);

    expect(screen.getByRole('button', { name: 'Sender henvendelse ...' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Sender henvendelse ...' }));
    expect(createMock).toHaveBeenCalledTimes(1);

    deferred.resolve({
      id: 'msg-1',
      name: 'Ingrid Bakke',
      email: 'ingrid@example.no',
      subject: 'Skobeholder',
      message: 'Kan akryl skobeholder stables i fire høyder?',
      status: 'new',
      createdAt: new Date().toISOString(),
    });

    await waitFor(() => {
      expect(
        screen.getByText('Takk for din henvendelse! Vi svarer deg så snart som mulig.'),
      ).toBeInTheDocument();
    });
  });

  it('displays error alert and preserves user input if repository rejects', async () => {
    const user = userEvent.setup();
    const repo: IContactRepository = {
      create: vi.fn().mockRejectedValue(new Error('Network failure')),
      listAll: vi.fn().mockResolvedValue([]),
    };

    render(<ContactForm contactRepo={repo} />);

    await user.type(screen.getByLabelText('Fullt navn'), 'Lars Berg');
    await user.type(screen.getByLabelText('E-postadresse'), 'lars@example.no');
    await user.type(screen.getByLabelText('Emne'), 'Spørsmål');
    await user.type(
      screen.getByLabelText('Melding'),
      'Finnes pergola i andre farger enn sort og antrasitt?',
    );

    await user.click(screen.getByRole('button', { name: 'Send henvendelse' }));

    expect(
      await screen.findByText(
        'Vi klarte ikke å sende henvendelsen akkurat nå. Vennligst prøv igjen om litt.',
      ),
    ).toBeInTheDocument();

    expect(screen.getByLabelText('Fullt navn')).toHaveValue('Lars Berg');
    expect(screen.getByLabelText('Melding')).toHaveValue(
      'Finnes pergola i andre farger enn sort og antrasitt?',
    );
  });

  it('LocalContactRepository throws ValidationError on invalid input', async () => {
    const localRepo = new LocalContactRepository('test_invalid_storage');
    await expect(
      localRepo.create({
        name: 'A',
        email: 'bad',
        subject: 'X',
        message: 'kort',
      }),
    ).rejects.toThrow(ValidationError);
  });
});
