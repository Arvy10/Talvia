import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import AuthClient from './AuthClient';

afterEach(cleanup);

describe('AuthClient navigation', () => {
  it('switches form mode without navigating to a second authentication page', () => {
    window.history.replaceState({}, '', '/login?mode=signup');
    render(<AuthClient mode="signup" />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Se connecter' })[0]);

    expect(screen.getByRole('heading', { name: 'Bon retour parmi nous' })).toBeTruthy();
    expect(`${window.location.pathname}${window.location.search}`).toBe('/login?mode=signup');
  });
});
