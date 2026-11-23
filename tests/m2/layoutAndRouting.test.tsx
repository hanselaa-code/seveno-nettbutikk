import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App';
import { AiAssistantWidget } from '../../src/components/ai/AiAssistantWidget';
import { Footer } from '../../src/components/layout/Footer';
import { Header } from '../../src/components/layout/Header';
import type { IAiAssistantService } from '../../src/services/ai/types';

describe('Layout, Header, Footer & SPA Routing (M2)', () => {
  it('renders Header with Seveno logo (object-cover object-center), desktop nav links, and cart badge', () => {
    const onCartClick = vi.fn();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Header cartCount={4} onCartClick={onCartClick} />
      </MemoryRouter>,
    );

    const logo = screen.getByAltText('Seveno logo');
    expect(logo).toHaveAttribute('src', '/images/seveno-logo.jpg');
    expect(logo.className).toContain('object-cover');
    expect(logo.className).toContain('object-center');

    const nav = screen.getByRole('navigation', { name: 'Hovedmeny' });
    expect(within(nav).getByRole('link', { name: 'Hjem' })).toHaveAttribute('href', '/');
    expect(within(nav).getByRole('link', { name: 'Alle' })).toHaveAttribute(
      'href',
      '/kategori/alle',
    );
    expect(within(nav).getByRole('link', { name: 'Seveno living' })).toHaveAttribute(
      'href',
      '/kategori/seveno-living',
    );
    expect(within(nav).getByRole('link', { name: 'Seveno home' })).toHaveAttribute(
      'href',
      '/kategori/seveno-home',
    );
    expect(within(nav).getByRole('link', { name: 'Seveno outdoor' })).toHaveAttribute(
      'href',
      '/kategori/seveno-outdoor',
    );
    expect(within(nav).getByRole('link', { name: 'Kontakt' })).toHaveAttribute('href', '/kontakt');
    expect(within(nav).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');

    expect(screen.getByTestId('cart-badge')).toHaveTextContent('4');
    fireEvent.click(screen.getByRole('button', { name: /Handlekurv \(4 varer\)/i }));
    expect(onCartClick).toHaveBeenCalledTimes(1);
  });

  it('toggles mobile menu drawer and closes on Escape, close button, and route navigation', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <Header />
        <Routes>
          <Route path="*" element={<div data-testid="route-marker">Ok</div>} />
        </Routes>
      </MemoryRouter>,
    );

    const trigger = screen.getByRole('button', { name: 'Åpne meny' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog', { name: 'Mobilmeny' })).not.toBeInTheDocument();

    // Open and close via Escape
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Mobilmeny' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Mobilmeny' })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Open and close via close button
    await user.click(trigger);
    const closeBtn = screen.getByRole('button', { name: 'Lukk meny' });
    await user.click(closeBtn);
    expect(screen.queryByRole('dialog', { name: 'Mobilmeny' })).not.toBeInTheDocument();

    // Open and close via route navigation
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Mobilmeny' });
    await user.click(within(dialog).getByRole('link', { name: 'Kontakt' }));
    expect(screen.queryByRole('dialog', { name: 'Mobilmeny' })).not.toBeInTheDocument();
  });

  it('renders Footer with motto, category links, and customer service links', () => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );

    expect(
      screen.getByText('Nordisk form og funksjon — skapt for varige rom.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Alle produkter' })).toHaveAttribute(
      'href',
      '/kategori/alle',
    );
    expect(screen.getByRole('link', { name: 'Seveno living' })).toHaveAttribute(
      'href',
      '/kategori/seveno-living',
    );
    expect(screen.getByRole('link', { name: 'Seveno home' })).toHaveAttribute(
      'href',
      '/kategori/seveno-home',
    );
    expect(screen.getByRole('link', { name: 'Seveno outdoor' })).toHaveAttribute(
      'href',
      '/kategori/seveno-outdoor',
    );
    expect(screen.getByRole('link', { name: 'Kontakt oss' })).toHaveAttribute('href', '/kontakt');
    expect(screen.getByRole('link', { name: 'Utsjekk' })).toHaveAttribute('href', '/utsjekk');
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
  });

  it('updates live Cart badge in Header when clicking "Legg i handlekurv" on HomePage', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('cart-badge')).toHaveTextContent('0');
    const addButtons = screen.getAllByRole('button', { name: /Legg i handlekurv/i });
    expect(addButtons.length).toBeGreaterThanOrEqual(3);

    await user.click(addButtons[0]);
    expect(screen.getByTestId('cart-badge')).toHaveTextContent('1');

    await user.click(addButtons[1]);
    expect(screen.getByTestId('cart-badge')).toHaveTextContent('2');
  });

  it('routes /kategori, /kontakt, /utsjekk, /admin, and unknown * 404 fallback cleanly', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/kategori']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Alle produkter', level: 1 })).toBeInTheDocument();
    unmount();

    const contactRender = render(
      <MemoryRouter initialEntries={['/kontakt']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Kontakt oss', level: 1 })).toBeInTheDocument();
    contactRender.unmount();

    const checkoutRender = render(
      <MemoryRouter initialEntries={['/utsjekk']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Utsjekk', level: 1 })).toBeInTheDocument();
    checkoutRender.unmount();

    const adminRender = render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Administrasjon', level: 1 })).toBeInTheDocument();
    adminRender.unmount();

    render(
      <MemoryRouter initialEntries={['/ukjent-sti-som-ikke-finnes']}>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('heading', { name: '404 — Fant ikke siden', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tilbake til forsiden' })).toHaveAttribute('href', '/');
  });

  it('closes only Header mobile menu on first Escape and keeps AiAssistantWidget open until second Escape', async () => {
    const user = userEvent.setup();
    const mockAiService: IAiAssistantService = {
      isConfigured: () => true,
      sendMessage: vi.fn(),
    };

    render(
      <MemoryRouter initialEntries={['/']}>
        <Header />
        <AiAssistantWidget aiService={mockAiService} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Spør Seveno AI' }));
    expect(screen.getByRole('dialog', { name: 'Seveno AI-hjelpebot' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Åpne meny' }));
    expect(screen.getByRole('dialog', { name: 'Mobilmeny' })).toBeInTheDocument();

    // First Escape closes only Mobilmeny
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Mobilmeny' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Seveno AI-hjelpebot' })).toBeInTheDocument();

    // Second Escape closes Seveno AI-hjelpebot
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Seveno AI-hjelpebot' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spør Seveno AI' })).toHaveFocus();
  });
});
