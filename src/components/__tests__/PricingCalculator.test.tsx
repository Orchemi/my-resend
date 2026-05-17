/**
 * Component tests for PricingCalculator.
 *
 * The hosted-tier UI was removed alongside the waitlist surface — this
 * fork only operates as self-hosted, so the comparison shrinks to:
 * Resend vs Self-Hosted vs Best Savings.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PricingCalculator from '../PricingCalculator';

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

// @ts-expect-error - Mock localStorage for testing
global.localStorage = localStorageMock;

describe('PricingCalculator', () => {
  beforeEach(() => {
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.clear.mockClear();

    localStorageMock.getItem.mockReturnValue(null);

    jest.clearAllMocks();
  });

  it('renders the three cost cards', () => {
    render(<PricingCalculator />);

    expect(screen.getByText('Resend')).toBeInTheDocument();
    expect(screen.getByText('Self-Hosted')).toBeInTheDocument();
    expect(screen.getByText('Best Savings')).toBeInTheDocument();
  });

  it('does not render a hosted-tier card or detail block', () => {
    render(<PricingCalculator />);

    expect(screen.queryByText(/^Hosted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hosted Version:/)).not.toBeInTheDocument();
  });

  it('renders without any waitlist surface', () => {
    render(<PricingCalculator />);

    expect(screen.queryByText(/get early access to hosted version/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/join the waitlist/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/on waitlist/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('waitlist-signup')).not.toBeInTheDocument();
  });

  it('renders in embeddable mode without hosted-tier or waitlist surfaces', () => {
    render(<PricingCalculator embeddable={true} />);

    expect(screen.getByText('Resend')).toBeInTheDocument();
    expect(screen.getByText('Self-Hosted')).toBeInTheDocument();

    expect(screen.queryByText(/^Hosted/)).not.toBeInTheDocument();
    expect(screen.queryByText(/get early access to hosted version/i)).not.toBeInTheDocument();
  });
});
