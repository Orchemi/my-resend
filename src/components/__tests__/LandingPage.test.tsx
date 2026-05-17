import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import LandingPage from '../LandingPage';

// Mock Next.js Link component
jest.mock('next/link', () => {
  return function MockLink({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

describe('LandingPage', () => {

  it('renders pricing discovery elements in hero section', () => {
    render(<LandingPage />);

    // "See Pricing" button still exists; pricing page is kept as a generic
    // cost-comparison tool even with the waitlist surface removed.
    expect(screen.getByRole('link', { name: /see pricing/i })).toBeInTheDocument();

    // Hosted-version teaser block was removed in #38 — no longer a thing.
    expect(screen.queryByText(/hosted version coming soon/i)).not.toBeInTheDocument();
  });

  it('renders the cost savings teaser in the benefits section', () => {
    render(<LandingPage />);

    // First benefit card still carries the "Quick Example" cost teaser.
    expect(screen.getByText(/quick example:/i)).toBeInTheDocument();
    expect(screen.getByText(/100k emails\/month/i)).toBeInTheDocument();

    // The "Hosted Version:" / "Even Faster:" hosted-tier teaser boxes were
    // removed alongside the waitlist surface.
    expect(screen.queryByText(/hosted version:/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/even faster:/i)).not.toBeInTheDocument();

    // "Calculate your savings" still appears in the first benefit card.
    const savingsLinks = screen.getAllByText(/calculate your savings/i);
    expect(savingsLinks.length).toBeGreaterThan(0);
  });

  it('has proper navigation links to pricing page', () => {
    render(<LandingPage />);
    
    // Check that pricing links point to /pricing
    const pricingLinks = screen.getAllByRole('link', { name: /pricing/i });
    pricingLinks.forEach(link => {
      expect(link).toHaveAttribute('href', '/pricing');
    });
  });

  it('has correct CTA flow directing new operators to the admin area', () => {
    render(<LandingPage />);

    // Primary "Get Started" CTAs (header + hero + bottom CTA section) route
    // to /admin — the admin route itself handles the auth gate and bounces
    // unauthenticated visitors to /admin/login.
    const getStartedLinks = screen.getAllByRole('link', { name: /get started/i });
    expect(getStartedLinks.length).toBeGreaterThanOrEqual(2);
    getStartedLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', '/admin');
    });

    expect(screen.getByRole('link', { name: /see pricing/i })).toHaveAttribute('href', '/pricing');

    expect(screen.queryByRole('link', { name: /^login$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /login here/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view on github/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /join waitlist/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/hosted version coming soon/i)).not.toBeInTheDocument();

    expect(screen.getByText(/alternative to resend/i)).toBeInTheDocument();
    expect(screen.getByText(/100% api compatible/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view documentation/i })).toBeInTheDocument();
  });
});