/**
 * StarRating — interactive 1–5 star rating widget.
 *
 * Features:
 *  - Hover preview (highlights stars up to the hovered position)
 *  - Optimistic display: shows `value` immediately; debounces `onRate` by 500 ms
 *    so rapid clicks don't flood the API.
 *  - Accessible: each star is a button with an aria-label.
 */

import { useState, useRef, useCallback } from 'react';

interface StarRatingProps {
  value: number | null; // current persisted rating
  onRate: (rating: number) => void;
  size?: number; // font size in px, defaults to 20
}

export function StarRating({ value, onRate, size = 20 }: StarRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // What to visually display: hovered position takes precedence
  const display = hovered ?? value ?? 0;

  const handleClick = useCallback(
    (star: number) => {
      // Clear any pending debounced call
      if (debounceRef.current) clearTimeout(debounceRef.current);

      // Debounce the actual API write by 500 ms
      debounceRef.current = setTimeout(() => {
        onRate(star);
      }, 500);
    },
    [onRate]
  );

  return (
    <div
      className="star-rating"
      style={{ fontSize: size }}
      onMouseLeave={() => setHovered(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          className={`star ${star <= display ? 'filled' : 'empty'}`}
          onClick={() => handleClick(star)}
          onMouseEnter={() => setHovered(star)}
          aria-label={`Rate ${star} star${star > 1 ? 's' : ''}`}
          type="button"
        >
          ★
        </button>
      ))}
    </div>
  );
}
