import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import VerificationPending from '../pages/clinician/VerificationPending.jsx';
import { profileService } from '../services/profileService.js';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({
  useAuthContext: () => ({
    logout: vi.fn(),
    refreshProfile: vi.fn(),
  }),
}));

vi.mock('../services/profileService', () => ({
  profileService: {
    getProfile: vi.fn(),
  },
}));

describe('VerificationPending Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders pending status and hides demo button by default during loading or when canSelfVerify is false', () => {
    profileService.getProfile.mockResolvedValue({ canSelfVerify: false });
    const html = renderToStaticMarkup(<VerificationPending />);

    expect(html).toContain('Verification Pending');
    expect(html).toContain('Your medical credentials are currently being verified');
    expect(html).toContain('Sign Out');
    // Button is hidden when canSelfVerify is false
    expect(html).not.toContain('Verify my account (demo)');
  });
});
