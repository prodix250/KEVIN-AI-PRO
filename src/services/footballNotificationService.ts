/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  LiveMatchItem,
  fetchRealFootballScores,
  getCachedFootballScores,
} from './liveScoreService';
import { playNewsNotificationSound, isCapacitorApkRuntime } from './geminiService';

export interface FavoritesState {
  matches: string[];
  teams: string[];
}

export interface FootballNotification {
  id: string;
  type: 'goal' | 'penalty' | 'red_card' | 'kickoff' | 'fulltime';
  title: string;
  message: string;
  timestamp: number;
  matchId: string;
}

const FAVORITES_STORAGE_KEY = 'izi_ai_football_favorites_v2';
const NOTIFICATION_HISTORY_KEY = 'izi_ai_football_notifs_history_v1';

export function getFavorites(): FavoritesState {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return { matches: [], teams: [] };
    const parsed = JSON.parse(raw);
    return {
      matches: Array.isArray(parsed?.matches) ? parsed.matches : [],
      teams: Array.isArray(parsed?.teams) ? parsed.teams : [],
    };
  } catch {
    return { matches: [], teams: [] };
  }
}

export function saveFavorites(favs: FavoritesState): void {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favs));
  } catch {
    // ignore
  }
}

export function toggleFavoriteMatch(matchId: string): FavoritesState {
  const current = getFavorites();
  const exists = current.matches.includes(matchId);
  const next: FavoritesState = {
    ...current,
    matches: exists
      ? current.matches.filter((id) => id !== matchId)
      : [...current.matches, matchId],
  };
  saveFavorites(next);
  requestNotificationPermission();
  return next;
}

export function toggleFavoriteTeam(teamId: string): FavoritesState {
  if (!teamId) return getFavorites();
  const current = getFavorites();
  const exists = current.teams.includes(teamId);
  const next: FavoritesState = {
    ...current,
    teams: exists
      ? current.teams.filter((id) => id !== teamId)
      : [...current.teams, teamId],
  };
  saveFavorites(next);
  requestNotificationPermission();
  return next;
}

export function requestNotificationPermission(): void {
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }
}

interface MatchSnapshot {
  statusState: 'in' | 'pre' | 'post';
  homeScore: number | null;
  awayScore: number | null;
  clock?: string;
  eventKeys: Set<string>;
}

const matchSnapshots = new Map<string, MatchSnapshot>();
const firedNotificationKeys = new Set<string>();

export function checkFootballFavoriteNotifications(
  matches: LiveMatchItem[],
  onNotification: (notif: FootballNotification) => void
): void {
  const favs = getFavorites();
  if (favs.matches.length === 0 && favs.teams.length === 0) return;

  for (const match of matches) {
    const isFavMatch = favs.matches.includes(match.id);
    const isHomeFav = favs.teams.includes(match.homeTeam.id);
    const isAwayFav = favs.teams.includes(match.awayTeam.id);

    if (!isFavMatch && !isHomeFav && !isAwayFav) continue;

    const prev = matchSnapshots.get(match.id);
    const currentEventKeys = new Set<string>(
      match.events.map((e) => `${e.type}:${e.minute}:${e.playerName}:${e.teamId}`)
    );

    if (!prev) {
      // Seed first snapshot
      matchSnapshots.set(match.id, {
        statusState: match.statusState,
        homeScore: match.homeTeam.score,
        awayScore: match.awayTeam.score,
        clock: match.clock,
        eventKeys: currentEventKeys,
      });
      continue;
    }

    const fire = (
      type: FootballNotification['type'],
      title: string,
      message: string,
      dedupKey: string
    ) => {
      if (firedNotificationKeys.has(dedupKey)) return;
      firedNotificationKeys.add(dedupKey);

      const notif: FootballNotification = {
        id: `${match.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        title,
        message,
        timestamp: Date.now(),
        matchId: match.id,
      };

      try {
        playNewsNotificationSound();
      } catch {}

      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(title, {
            body: message,
            icon: match.homeTeam.logo || match.awayTeam.logo || '/logo.png',
          });
        } catch {}
      }

      if (isCapacitorApkRuntime() && typeof window !== 'undefined') {
        try {
          const bridge = (window as any).KevinAgentBridge;
          if (bridge?.showNotification) {
            bridge.showNotification(title, message);
          }
        } catch {}
      }

      onNotification(notif);
    };

    // 1. Kickoff notification
    if (prev.statusState === 'pre' && match.statusState === 'in') {
      fire(
        'kickoff',
        `⚽ Umukino watangiye: ${match.homeTeam.name} vs ${match.awayTeam.name}`,
        `Umukino wa ${match.leagueName} uratangiye ubu ku kibuga!`,
        `kickoff:${match.id}`
      );
    }

    // 2. Goal / Penalty notifications
    const homeScorePrev = prev.homeScore ?? 0;
    const homeScoreCurr = match.homeTeam.score ?? 0;
    const awayScorePrev = prev.awayScore ?? 0;
    const awayScoreCurr = match.awayTeam.score ?? 0;

    if (match.statusState === 'in') {
      if (homeScoreCurr > homeScorePrev) {
        const goalEv = match.events.find(
          (e) => (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal') && !prev.eventKeys.has(`${e.type}:${e.minute}:${e.playerName}:${e.teamId}`)
        );
        const scorer = goalEv?.playerName || match.homeTeam.name;
        const isPen = goalEv?.type === 'penalty';
        fire(
          isPen ? 'penalty' : 'goal',
          `⚽ GOAL! ${scorer} (${match.homeTeam.name})`,
          `${match.homeTeam.name} ${homeScoreCurr} - ${awayScoreCurr} ${match.awayTeam.name} (${match.clock || goalEv?.minute || ''})`,
          `goal:${match.id}:home:${homeScoreCurr}`
        );
      }

      if (awayScoreCurr > awayScorePrev) {
        const goalEv = match.events.find(
          (e) => (e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal') && !prev.eventKeys.has(`${e.type}:${e.minute}:${e.playerName}:${e.teamId}`)
        );
        const scorer = goalEv?.playerName || match.awayTeam.name;
        const isPen = goalEv?.type === 'penalty';
        fire(
          isPen ? 'penalty' : 'goal',
          `⚽ GOAL! ${scorer} (${match.awayTeam.name})`,
          `${match.homeTeam.name} ${homeScoreCurr} - ${awayScoreCurr} ${match.awayTeam.name} (${match.clock || goalEv?.minute || ''})`,
          `goal:${match.id}:away:${awayScoreCurr}`
        );
      }

      // 3. Red card notifications
      for (const ev of match.events) {
        if (ev.type === 'red_card') {
          const evKey = `red_card:${ev.minute}:${ev.playerName}:${ev.teamId}`;
          if (!prev.eventKeys.has(evKey)) {
            fire(
              'red_card',
              `🟥 Red Card: ${ev.playerName}`,
              `${ev.playerName} (${ev.teamName || 'Team'}) yahawe ikarita itukura (${ev.minute}) muri ${match.homeTeam.name} vs ${match.awayTeam.name}!`,
              `red:${match.id}:${ev.playerName}:${ev.minute}`
            );
          }
        }
      }
    }

    // 4. Endgame / Full time notification
    if (prev.statusState === 'in' && match.statusState === 'post') {
      fire(
        'fulltime',
        `🏁 Umukino urarangiye: ${match.homeTeam.name} ${homeScoreCurr} - ${awayScoreCurr} ${match.awayTeam.name}`,
        `Umukino wa ${match.leagueName} urarangiye! Reba ibitego n'imibare yose muri Live Score.`,
        `fulltime:${match.id}`
      );
    }

    // Update snapshot
    matchSnapshots.set(match.id, {
      statusState: match.statusState,
      homeScore: match.homeTeam.score,
      awayScore: match.awayTeam.score,
      clock: match.clock,
      eventKeys: currentEventKeys,
    });
  }
}

export function startFootballNotificationWatcher(
  onNotification: (notif: FootballNotification) => void
): () => void {
  let active = true;

  const poll = async () => {
    if (!active) return;
    try {
      const res = await fetchRealFootballScores(false);
      if (res && Array.isArray(res.matches)) {
        checkFootballFavoriteNotifications(res.matches, onNotification);
      }
    } catch {
      // ignore
    }
  };

  // Immediate check with cache if available
  const cached = getCachedFootballScores();
  if (cached?.matches) {
    checkFootballFavoriteNotifications(cached.matches, onNotification);
  }

  const intervalId = window.setInterval(poll, 25_000);
  return () => {
    active = false;
    window.clearInterval(intervalId);
  };
}
