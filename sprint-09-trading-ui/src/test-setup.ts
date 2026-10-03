/**
 * Runs before every spec. A signed-in tab session now survives a reload (it lives in
 * sessionStorage), so whatever one spec signs in must not still be there for the next: tests
 * otherwise pass or fail depending on which spec happened to run before them.
 */
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
