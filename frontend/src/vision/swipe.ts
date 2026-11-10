/**
 * Detects a quick sideways wave of the hand. Pure logic (time in ms, x in screen units 0..1),
 * so it is unit tested.
 */
export class SwipeDetector {
  private history: { t: number; x: number }[] = [];
  private cooldownUntil = 0;

  constructor(
    /** how far the hand must travel (share of the screen width) */
    private readonly distance = 0.22,
    /** ... within this many milliseconds */
    private readonly window = 300,
    /** pause after a swipe, so one wave counts once */
    private readonly cooldown = 700,
  ) {}

  /** Feed the hand position every frame (null = no hand). Returns 1 = right, -1 = left, 0 = nothing. */
  push(t: number, x: number | null): -1 | 0 | 1 {
    if (x === null) {
      this.history = [];
      return 0;
    }
    this.history.push({ t, x });
    while (this.history.length && t - this.history[0].t > this.window) this.history.shift();
    if (t < this.cooldownUntil) return 0;
    const dx = x - this.history[0].x;
    if (Math.abs(dx) < this.distance) return 0;
    this.cooldownUntil = t + this.cooldown;
    this.history = [];
    return dx > 0 ? 1 : -1;
  }
}
