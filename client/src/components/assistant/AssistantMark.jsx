/**
 * Chatbot Face encircled by MedBrief's signature blue and green rounded rectangles.
 */
import React from 'react';

export default function AssistantMark({ size = 34 }) {
  return (
    <span
      className="assistant-mark relative inline-flex items-center justify-center select-none pointer-events-none"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 54 54"
        className="h-full w-full drop-shadow-md transition-transform duration-200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* MedBrief Blue Gradient Rectangle */}
          <linearGradient id="mbBlueCard" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="#0284c7" />
          </linearGradient>

          {/* MedBrief Green Gradient Rectangle */}
          <linearGradient id="mbGreenCard" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#059669" />
          </linearGradient>

          {/* Chatbot Screen Gradient */}
          <linearGradient id="botFaceBg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#f8fafc" />
          </linearGradient>
        </defs>

        {/* MedBrief Blue Rounded Rectangle (Back Layer, tilted) */}
        <rect
          x="6.5"
          y="6.5"
          width="37"
          height="37"
          rx="11"
          transform="rotate(-7 25 25)"
          fill="url(#mbBlueCard)"
          opacity="0.95"
        />

        {/* MedBrief Green/Teal Rounded Rectangle (Mid Layer, tilted opposite) */}
        <rect
          x="10.5"
          y="7.5"
          width="37"
          height="37"
          rx="11"
          transform="rotate(7 29 26)"
          fill="url(#mbGreenCard)"
          opacity="0.95"
        />

        {/* Central Bot Container Housing */}
        <rect
          x="9"
          y="9"
          width="36"
          height="36"
          rx="12"
          fill="#091427"
          stroke="#38bdf8"
          strokeWidth="1.5"
        />

        {/* Top Antenna */}
        <path
          d="M27 12.5 L27 15"
          stroke="#38bdf8"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="27" cy="11.5" r="2.2" fill="#38bdf8" />

        {/* Chatbot Side Ears / Headphones */}
        <rect x="11.5" y="21" width="3" height="7.5" rx="1.5" fill="#38bdf8" />
        <rect x="39.5" y="21" width="3" height="7.5" rx="1.5" fill="#34d399" />

        {/* Normal Chatbot Face Screen */}
        <rect
          x="14.5"
          y="15.5"
          width="25"
          height="21.5"
          rx="6"
          fill="url(#botFaceBg)"
          stroke="#cbd5e1"
          strokeWidth="1"
        />

        {/* Normal Chatbot Eyes */}
        <ellipse cx="21" cy="24.5" rx="2.4" ry="3" fill="#0f172a" />
        <ellipse cx="33" cy="24.5" rx="2.4" ry="3" fill="#0f172a" />

        {/* Eye Catchlights (Friendly sparkle) */}
        <circle cx="20.3" cy="23.4" r="0.8" fill="#38bdf8" />
        <circle cx="32.3" cy="23.4" r="0.8" fill="#38bdf8" />

        {/* Normal Chatbot Smile */}
        <path
          d="M22.5 29.5 Q27 33.5 31.5 29.5"
          stroke="#0f172a"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </span>
  );
}
