/**
 * Component tests for PricingCalculator.
 *
 * The waitlist coupling was removed in #38 — the calculator is now a pure
 * cost-comparison tool (Resend / Self-Hosted / Hosted-as-reference / Best
 * Savings). Hosted prices are kept as a reference data point only; this
 * fork does not operate a hosted service.
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

  it('renders all four cost cards', () => {
    render(<PricingCalculator />);

    expect(screen.getByText('Resend')).toBeInTheDocument();
    expect(screen.getByText('Self-Hosted')).toBeInTheDocument();
    expect(screen.getByText(/Hosted \(reference\)/)).toBeInTheDocument();
    expect(screen.getByText('Best Savings')).toBeInTheDocument();
  });

  it('shows the hosted-tier reference details section', () => {
    render(<PricingCalculator />);

    expect(screen.getByText('Pricing Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Features')).toBeInTheDocument();
  });

  it('renders without any waitlist surface', () => {
    render(<PricingCalculator />);

    expect(screen.queryByText(/get early access to hosted version/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/join the waitlist/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/on waitlist/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('waitlist-signup')).not.toBeInTheDocument();
  });

  it('renders in embeddable mode without waitlist surface', () => {
    render(<PricingCalculator embeddable={true} />);

    expect(screen.getByText('Resend')).toBeInTheDocument();
    expect(screen.getByText('Self-Hosted')).toBeInTheDocument();
    expect(screen.getByText(/Hosted \(reference\)/)).toBeInTheDocument();

    expect(screen.queryByText(/get early access to hosted version/i)).not.toBeInTheDocument();
  });
});
