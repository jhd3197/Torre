import { describe, expect, test } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { bodyFor, CursorRook, gaze, tilt } from './CursorRook';

describe('the rook that watches the cursor', () => {
  test('its eyes point at the cursor, easing in close and never leaving the face', () => {
    expect(gaze(0, 0)).toEqual({ x: 0, y: 0 });
    const right = gaze(1000, 0);
    expect(right.x).toBeCloseTo(15);
    expect(right.y).toBeCloseTo(0);
    expect(gaze(150, 0).x).toBeCloseTo(7.5);
    const upLeft = gaze(-500, -500);
    expect(upLeft.x).toBeLessThan(0);
    expect(upLeft.y).toBeLessThan(0);
  });

  test('it leans a little toward the cursor, never more than a few degrees', () => {
    expect(tilt(0)).toBe(0);
    expect(tilt(240)).toBe(2);
    expect(tilt(-5000)).toBe(-6);
  });

  test('its arms reach out when the cursor comes close, and up when it is close above', () => {
    expect(bodyFor(600, 0, 150)).toBe('body');
    expect(bodyFor(80, 20, 150)).toBe('body-reach');
    expect(bodyFor(0, -120, 150)).toBe('body-arms-up');
  });

  test('hovering tickles it, a click boops it, and its own eyes show only on the faceless body', () => {
    const { container } = render(<CursorRook size={120} />);
    const rook = container.querySelector('.cursor-rook')!;
    const frame = () => rook.querySelector('img')!.getAttribute('src');
    expect(frame()).toBe('art/mascot/cursor/body.webp');
    expect(rook.querySelectorAll('ellipse')).toHaveLength(2);

    fireEvent.pointerEnter(rook);
    expect(frame()).toBe('art/mascot/cursor/tickled.webp');
    expect(rook.querySelector('svg')).toBeNull();

    fireEvent.pointerDown(rook);
    expect(frame()).toBe('art/mascot/cursor/boop.webp');
  });
});
