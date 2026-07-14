// Shared: local leaderboard + streaks (localStorage), one store per game.
// This is the prototype stand-in for a real backend. The shape mirrors what
// the future service will store per player: all-time best, per-week best
// (one bucket per weekly generated level), per-day best, and a consecutive
// day play-streak. Swapping this for an API client later means implementing
// the same recordRun/summary contract against a server.

import { weekId, todayId } from './rng.js';

export function createScoreStore(gameId) {
  const KEY = `${gameId}.scores.v1`;

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  }

  function save(data) {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch { /* private mode etc. — play on without persistence */ }
  }

  function recordRun(score) {
    const data = load();
    const week = weekId();
    const day = todayId();

    data.allTimeBest = Math.max(data.allTimeBest || 0, score);

    data.weeks = data.weeks || {};
    const w = data.weeks[week] || { best: 0, runs: 0 };
    const newWeekBest = score > w.best;
    w.best = Math.max(w.best, score);
    w.runs += 1;
    data.weeks[week] = w;

    data.days = data.days || {};
    const prevDayBest = data.days[day] || 0;
    data.days[day] = Math.max(prevDayBest, score);

    // Consecutive-day play streak.
    if (data.lastPlayDay !== day) {
      const yesterday = todayId(new Date(Date.now() - 86400000));
      data.streak = data.lastPlayDay === yesterday ? (data.streak || 0) + 1 : 1;
      data.lastPlayDay = day;
    }

    save(data);
    return {
      score,
      allTimeBest: data.allTimeBest,
      isAllTimeBest: score >= data.allTimeBest && score > 0,
      weekBest: w.best,
      isWeekBest: newWeekBest,
      weekRuns: w.runs,
      dayBest: data.days[day],
      isDayBest: score > prevDayBest,
      streak: data.streak || 1,
    };
  }

  function summary() {
    const data = load();
    const w = (data.weeks || {})[weekId()] || { best: 0, runs: 0 };
    return {
      allTimeBest: data.allTimeBest || 0,
      weekBest: w.best,
      weekRuns: w.runs,
      dayBest: (data.days || {})[todayId()] || 0,
      streak: data.streak || 0,
    };
  }

  return { recordRun, summary };
}
