import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';

describe('Seveno App Shell', () => {
  it('viser Seveno-logo og de tre startproduktene på norsk', () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByAltText('Seveno logo')).toBeInTheDocument();
    expect(screen.getByText('Army sekk')).toBeInTheDocument();
    expect(screen.getByText('Akryl gjennomsiktig skobeholder')).toBeInTheDocument();
    expect(screen.getByText('Pergola')).toBeInTheDocument();
  });
});
