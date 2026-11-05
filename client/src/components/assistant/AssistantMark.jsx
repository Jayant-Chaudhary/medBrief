/**
 * The MedBrief Assistant Mark:
 * Features a cute expressive face in the center, encircled by MedBrief's
 * teal, emerald, and warm gold brand contour and subtle logo emblem.
 */
import React from 'react';

export default function AssistantMark({ size = 32, sparkle = true }) {
  return (
    <span
      className="assistant-mark relative inline-flex items-center justify-center select-none"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* Background MedBrief logo watermark */}
      <img
        src="/logo-mark.png"
        alt=""
        draggable="false"
        className="assistant-mark__silver absolute inset-0 h-full w-full object-contain opacity-20 filter blur-[0.3px]"
      />

      {/* SVG Cute Face & MedBrief-Styled Badge */}
      <svg
        viewBox="0 0 48 48"
        className="relative z-10 h-full w-full drop-shadow-sm transition-transform duration-200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <linearGradient id="medbriefFaceBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#14b8a6" />
            <stop offset="55%" stopColor="#0f766e" />
            <stop offset="100%" stopColor="#042f2e" />
          </linearGradient>
          <linearGradient id="medbriefRing" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fef08a" />
            <stop offset="45%" stopColor="#2dd4bf" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>
          <linearGradient id="eyePupil" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#0f172a" />
            <stop offset="100%" stopColor="#022c22" />
          </linearGradient>
        </defs>

        {/* Outer badge contour matching MedBrief colors */}
        <circle
          cx="24"
          cy="24"
          r="21.5"
          fill="url(#medbriefFaceBg)"
          stroke="url(#medbriefRing)"
          strokeWidth="2"
        />

        {/* Golden medical cross / star accent at top */}
        <path
          d="M24 6.5 L24 9.5 M22.5 8 L25.5 8"
          stroke="#fef08a"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.95"
        />

        {/* Cute Face in Center */}
        {/* Left Eye with Catchlights */}
        <g>
          <ellipse cx="17.5" cy="22.5" rx="3.3" ry="4.2" fill="#ffffff" />
          <ellipse cx="17.5" cy="22.5" rx="2.6" ry="3.4" fill="url(#eyePupil)" />
          {/* Main sparkle catchlight */}
          <circle cx="16.3" cy="20.8" r="1.3" fill="#ffffff" />
          <circle cx="18.6" cy="23.9" r="0.65" fill="#ffffff" />
        </g>

        {/* Right Eye with Catchlights */}
        <g>
          <ellipse cx="30.5" cy="22.5" rx="3.3" ry="4.2" fill="#ffffff" />
          <ellipse cx="30.5" cy="22.5" rx="2.6" ry="3.4" fill="url(#eyePupil)" />
          {/* Main sparkle catchlight */}
          <circle cx="29.3" cy="20.8" r="1.3" fill="#ffffff" />
          <circle cx="31.6" cy="23.9" r="0.65" fill="#ffffff" />
        </g>

        {/* Rosy Blush Cheeks */}
        <ellipse cx="13" cy="27" rx="3.2" ry="1.6" fill="#fda4af" opacity="0.85" />
        <ellipse cx="35" cy="27" rx="3.2" ry="1.6" fill="#fda4af" opacity="0.85" />

        {/* Cute Smile */}
        <path
          d="M20.5 27.2 Q24 32.2 27.5 27.2"
          stroke="#ffffff"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />

        {/* Ambient sparkle stars if sparkle is enabled */}
        {sparkle && (
          <>
            <circle cx="9" cy="13" r="1" fill="#fef08a" opacity="0.8" />
            <circle cx="39" cy="14" r="1.2" fill="#fef08a" opacity="0.8" />
          </>
        )}
      </svg>
    </span>
  );
}
