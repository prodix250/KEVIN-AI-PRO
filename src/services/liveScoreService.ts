/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isCapacitorApkRuntime } from './geminiService';

export type FootballRegion = 'europe' | 'africa';
export type MatchStatusState = 'in' | 'pre' | 'post';

export interface LiveMatchEvent {
  minute: string;
  type: 'goal' | 'penalty' | 'own_goal' | 'yellow_card' | 'red_card';
  teamId: string;
  teamName: string;
  playerName: string;
}

export interface LiveMatchTeam {
  id: string;
  name: string;
  shortName: string;
  logo?: string;
  score: number | null;
  winner?: boolean;
}

export interface LiveMatchItem {
  id: string;
  eventId?: string;
  leagueSlug: string;
  leagueName: string;
  leagueLogo?: string;
  region: FootballRegion;
  countryLabel: string;
  dateIso: string;
  statusState: MatchStatusState;
  statusDetail: string;
  clock?: string;
  venue?: string;
  homeTeam: LiveMatchTeam;
  awayTeam: LiveMatchTeam;
  events: LiveMatchEvent[];
}

export interface MatchStatEntry {
  name: string;
  label: string;
  value: string;
}

export interface MatchLineupPlayer {
  id: string;
  name: string;
  jersey: string;
  position: string;
  starter: boolean;
  subbedIn?: boolean;
  subbedOut?: boolean;
}

export interface MatchLineup {
  teamId: string;
  teamName: string;
  homeAway: 'home' | 'away';
  formation?: string;
  isPossibleLineup?: boolean;
  coach?: string;
  players: MatchLineupPlayer[];
}

export interface TeamLastFiveEntry {
  teamId: string;
  teamName: string;
  teamLogo?: string;
  games: Array<{
    id: string;
    date: string;
    score: string;
    result: string;
    opponent: string;
    opponentLogo?: string;
    homeAway: string;
    leagueName: string;
  }>;
}

export interface StandingRow {
  rank: number;
  teamId: string;
  teamName: string;
  teamLogo?: string;
  played: string;
  wins: string;
  draws: string;
  losses: string;
  goalsFor: string;
  goalsAgainst: string;
  goalDiff: string;
  points: string;
  note?: string;
}

export interface LeagueStandingsResponse {
  leagueSlug: string;
  leagueName: string;
  standings: StandingRow[];
  updatedAt: number;
}

export interface LiveMatchDetail {
  eventId: string;
  leagueSlug: string;
  venue?: string;
  venueCity?: string;
  attendance?: number;
  referee?: string;
  odds?: {
    provider: string;
    details?: string;
    overUnder?: number;
    homeMoneyLine?: number;
    awayMoneyLine?: number;
    drawMoneyLine?: number;
  };
  stats: {
    homeTeamId: string;
    awayTeamId: string;
    home: MatchStatEntry[];
    away: MatchStatEntry[];
  };
  isPossibleLineup?: boolean;
  rosters: MatchLineup[];
  lastFiveGames: TeamLastFiveEntry[];
  standings: StandingRow[];
  news: Array<{
    headline: string;
    published: string;
    link?: string;
  }>;
  updatedAt: number;
}

export interface TeamRosterPlayer {
  id: string;
  name: string;
  shortName: string;
  jersey: string;
  position: string;
  positionAbbr: string;
  age?: number;
  height?: string;
  nationality?: string;
  flagUrl?: string;
  appearances: string;
  goals: string;
  assists: string;
  yellowCards: string;
  redCards: string;
}

export interface TeamScheduleMatch {
  id: string;
  eventId: string;
  leagueSlug: string;
  dateIso: string;
  competitionName: string;
  statusState: MatchStatusState;
  statusDetail: string;
  venue?: string;
  homeTeam: LiveMatchTeam;
  awayTeam: LiveMatchTeam;
}

export interface TeamFullProfile {
  team: {
    id: string;
    name: string;
    shortName: string;
    logo?: string;
    color?: string;
    leagueSlug: string;
    leagueName: string;
    standingSummary?: string;
    recordSummary?: string;
    coach?: string;
    venue?: string;
    stats: {
      gamesPlayed: string;
      wins: string;
      draws: string;
      losses: string;
      points: string;
      goalsFor: string;
      goalsAgainst: string;
      goalDiff: string;
      homeRecord: string;
      awayRecord: string;
    };
    nextEvent?: {
      id: string;
      name: string;
      dateIso: string;
      venue?: string;
    };
  };
  roster: TeamRosterPlayer[];
  schedule: TeamScheduleMatch[];
  standings: StandingRow[];
  updatedAt: number;
}

export interface LiveScoreLeagueConfig {
  slug: string;
  name: string;
  region: FootballRegion;
  countryLabel: string;
  continentalCup?: boolean;
}

export const LIVE_SCORE_LEAGUES: LiveScoreLeagueConfig[] = [
  // Europe
  { slug: 'uefa.champions', name: 'UEFA Champions League', region: 'europe', countryLabel: 'Europe', continentalCup: true },
  { slug: 'uefa.europa', name: 'UEFA Europa League', region: 'europe', countryLabel: 'Europe', continentalCup: true },
  { slug: 'uefa.europa.conf', name: 'UEFA Conference League', region: 'europe', countryLabel: 'Europe', continentalCup: true },
  { slug: 'eng.1', name: 'Premier League', region: 'europe', countryLabel: 'England' },
  { slug: 'esp.1', name: 'LaLiga', region: 'europe', countryLabel: 'Spain' },
  { slug: 'ita.1', name: 'Serie A', region: 'europe', countryLabel: 'Italy' },
  { slug: 'ger.1', name: 'Bundesliga', region: 'europe', countryLabel: 'Germany' },
  { slug: 'fra.1', name: 'Ligue 1', region: 'europe', countryLabel: 'France' },
  { slug: 'por.1', name: 'Liga Portugal', region: 'europe', countryLabel: 'Portugal' },
  { slug: 'ned.1', name: 'Eredivisie', region: 'europe', countryLabel: 'Netherlands' },
  { slug: 'bel.1', name: 'Belgian Pro League', region: 'europe', countryLabel: 'Belgium' },
  { slug: 'tur.1', name: 'Turkish Super Lig', region: 'europe', countryLabel: 'Turkey' },
  // Africa
  { slug: 'caf.champions', name: 'CAF Champions League', region: 'africa', countryLabel: 'Africa', continentalCup: true },
  { slug: 'caf.confed', name: 'CAF Confederation Cup', region: 'africa', countryLabel: 'Africa', continentalCup: true },
  { slug: 'caf.nations', name: 'Africa Cup of Nations', region: 'africa', countryLabel: 'Africa', continentalCup: true },
  { slug: 'caf.nations_qual', name: 'AFCON Qualifiers', region: 'africa', countryLabel: 'Africa', continentalCup: true },
  { slug: 'fifa.worldq.caf', name: 'CAF World Cup Qualifiers', region: 'africa', countryLabel: 'Africa', continentalCup: true },
  { slug: 'rsa.1', name: 'South African Premiership', region: 'africa', countryLabel: 'South Africa' },
  { slug: 'nga.1', name: 'Nigeria Premier League', region: 'africa', countryLabel: 'Nigeria' },
  { slug: 'ken.1', name: 'Kenyan Premier League', region: 'africa', countryLabel: 'Kenya' },
  { slug: 'gha.1', name: 'Ghana Premier League', region: 'africa', countryLabel: 'Ghana' },
  { slug: 'uga.1', name: 'Uganda Premier League', region: 'africa', countryLabel: 'Uganda' },
];

export interface LiveScoreResponse {
  matches: LiveMatchItem[];
  updatedAt: number;
}

const LIVE_SCORE_CACHE_KEY = 'izi_ai_live_scores_cache_v1';

export function getCachedFootballScores(): LiveScoreResponse | null {
  try {
    const raw = localStorage.getItem(LIVE_SCORE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LiveScoreResponse;
    if (!parsed || !Array.isArray(parsed.matches) || parsed.matches.length === 0) return null;
    // Keep cache up to 6 hours so transient failures never blank out the UI
    if (Date.now() - (parsed.updatedAt || 0) > 6 * 3600_000) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveCachedFootballScores(data: LiveScoreResponse): void {
  try {
    if (!data || !Array.isArray(data.matches) || data.matches.length === 0) return;
    localStorage.setItem(LIVE_SCORE_CACHE_KEY, JSON.stringify(data));
  } catch {
    // ignore storage quota errors
  }
}

function getEndpoint(path: string): string {
  const configuredBase = (import.meta as any).env?.VITE_API_BASE_URL?.trim?.() || '';
  if (configuredBase) {
    return `${configuredBase.replace(/\/$/, '')}${path}`;
  }
  return path;
}

function formatDateYYYYMMDD(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kigali',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value || String(d.getUTCFullYear());
  const m = parts.find((p) => p.type === 'month')?.value || String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = parts.find((p) => p.type === 'day')?.value || String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function runWithConcurrency<T>(
  factories: Array<() => Promise<T>>,
  concurrency = 6
): Promise<T[]> {
  const results: T[] = new Array(factories.length);
  let nextIdx = 0;
  const worker = async () => {
    while (true) {
      const idx = nextIdx++;
      if (idx >= factories.length) break;
      results[idx] = await factories[idx]();
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, factories.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function fetchJsonSafe(url: string, timeoutMs = 10_000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractStandingsRowsClient(standingsObj: any): StandingRow[] {
  const groups = Array.isArray(standingsObj?.groups)
    ? standingsObj.groups
    : Array.isArray(standingsObj?.children)
      ? standingsObj.children
      : [];
  const targetGroup = groups[0];
  const entries = Array.isArray(targetGroup?.standings?.entries)
    ? targetGroup.standings.entries
    : Array.isArray(standingsObj?.standings?.entries)
      ? standingsObj.standings.entries
      : [];

  return entries.map((entry: any, idx: number) => {
    const statsMap = new Map<string, string>();
    if (Array.isArray(entry?.stats)) {
      for (const st of entry.stats) {
        if (st?.name) statsMap.set(String(st.name), String(st.displayValue ?? st.value ?? '0'));
      }
    }
    const teamName =
      typeof entry?.team === 'string'
        ? entry.team
        : String(entry?.team?.displayName || entry?.team?.shortDisplayName || entry?.team?.name || 'Team');
    const teamId = String(entry?.id || entry?.team?.id || '');
    const teamLogo = typeof entry?.team === 'object' ? entry.team?.logos?.[0]?.href || entry.team?.logo : undefined;
    return {
      rank: Number(statsMap.get('rank') || entry?.note?.rank || idx + 1),
      teamId,
      teamName,
      teamLogo,
      played: statsMap.get('gamesPlayed') || '0',
      wins: statsMap.get('wins') || '0',
      draws: statsMap.get('ties') || '0',
      losses: statsMap.get('losses') || '0',
      goalsFor: statsMap.get('pointsFor') || '0',
      goalsAgainst: statsMap.get('pointsAgainst') || '0',
      goalDiff: statsMap.get('pointDifferential') || '0',
      points: statsMap.get('points') || '0',
      note: entry?.note?.description || undefined,
    };
  });
}

function parseEspnScoreboardEvents(json: any, league: LiveScoreLeagueConfig): LiveMatchItem[] {
  const events = Array.isArray(json?.events) ? json.events : [];
  const leagueMeta = Array.isArray(json?.leagues) ? json.leagues[0] : null;
  const leagueLogo = leagueMeta?.logos?.[0]?.href || undefined;
  const leagueName = leagueMeta?.name || league.name;
  const now = Date.now();
  const maxPastMs = 5 * 86_400_000;
  const maxFutureMs = 7 * 86_400_000;

  const parsed: LiveMatchItem[] = [];

  for (const ev of events) {
    const comp = ev?.competitions?.[0];
    if (!comp || !Array.isArray(comp.competitors)) continue;

    const stateRaw = String(ev?.status?.type?.state || comp?.status?.type?.state || 'pre').toLowerCase();
    const statusState: MatchStatusState =
      stateRaw === 'in' ? 'in' : stateRaw === 'post' ? 'post' : 'pre';

    const dateIso = String(ev?.date || comp?.date || '');
    const kickoffMs = Date.parse(dateIso);
    if (Number.isFinite(kickoffMs) && statusState !== 'in') {
      if (kickoffMs < now - maxPastMs || kickoffMs > now + maxFutureMs) {
        continue;
      }
    }

    const homeRaw = comp.competitors.find((c: any) => c.homeAway === 'home') || comp.competitors[0];
    const awayRaw = comp.competitors.find((c: any) => c.homeAway === 'away') || comp.competitors[1];
    if (!homeRaw?.team || !awayRaw?.team) continue;

    const parseScore = (raw: any): number | null => {
      if (statusState === 'pre') return null;
      const n = Number(raw?.score);
      return Number.isFinite(n) ? n : 0;
    };

    const teamMap = new Map<string, string>();
    if (homeRaw.team.id) teamMap.set(String(homeRaw.team.id), String(homeRaw.team.displayName || homeRaw.team.name || ''));
    if (awayRaw.team.id) teamMap.set(String(awayRaw.team.id), String(awayRaw.team.displayName || awayRaw.team.name || ''));

    const matchEvents: LiveMatchEvent[] = [];
    if (Array.isArray(comp.details)) {
      for (const d of comp.details) {
        const isGoal = Boolean(d?.scoringPlay);
        const isRed = Boolean(d?.redCard);
        const isYellow = Boolean(d?.yellowCard);
        if (!isGoal && !isRed && !isYellow) continue;
        const player = d?.athletesInvolved?.[0]?.displayName || d?.athletesInvolved?.[0]?.shortName || '';
        const minute = String(d?.clock?.displayValue || '').trim();
        const teamId = String(d?.team?.id || '');
        const evType: LiveMatchEvent['type'] = isGoal
          ? d?.ownGoal
            ? 'own_goal'
            : d?.penaltyKick
              ? 'penalty'
              : 'goal'
          : isRed
            ? 'red_card'
            : 'yellow_card';

        matchEvents.push({
          minute,
          type: evType,
          teamId,
          teamName: teamMap.get(teamId) || '',
          playerName: player || (isGoal ? 'Goal' : isRed ? 'Red Card' : 'Yellow Card'),
        });
      }
    }

    const statusDetail = String(
      ev?.status?.type?.shortDetail ||
        comp?.status?.type?.shortDetail ||
        ev?.status?.displayClock ||
        (statusState === 'pre' ? 'Scheduled' : statusState === 'post' ? 'FT' : 'LIVE')
    ).trim();

    parsed.push({
      id: `${league.slug}:${String(ev.id)}`,
      eventId: String(ev.id),
      leagueSlug: league.slug,
      leagueName,
      leagueLogo,
      region: league.region,
      countryLabel: league.countryLabel,
      dateIso,
      statusState,
      statusDetail,
      clock: ev?.status?.displayClock ? String(ev.status.displayClock) : undefined,
      venue: comp?.venue?.fullName || ev?.venue?.fullName || undefined,
      homeTeam: {
        id: String(homeRaw.team.id || 'home'),
        name: String(homeRaw.team.displayName || homeRaw.team.name || 'Home'),
        shortName: String(homeRaw.team.abbreviation || homeRaw.team.shortDisplayName || homeRaw.team.name || 'HOM'),
        logo: homeRaw.team.logo || undefined,
        score: parseScore(homeRaw),
        winner: Boolean(homeRaw.winner),
      },
      awayTeam: {
        id: String(awayRaw.team.id || 'away'),
        name: String(awayRaw.team.displayName || awayRaw.team.name || 'Away'),
        shortName: String(awayRaw.team.abbreviation || awayRaw.team.shortDisplayName || awayRaw.team.name || 'AWY'),
        logo: awayRaw.team.logo || undefined,
        score: parseScore(awayRaw),
        winner: Boolean(awayRaw.winner),
      },
      events: matchEvents,
    });
  }

  return parsed;
}

export function sortLiveMatches(matches: LiveMatchItem[]): LiveMatchItem[] {
  const rank = (s: MatchStatusState) => (s === 'in' ? 0 : s === 'pre' ? 1 : 2);
  return [...matches].sort((a, b) => {
    const rDiff = rank(a.statusState) - rank(b.statusState);
    if (rDiff !== 0) return rDiff;
    const tA = Date.parse(a.dateIso) || 0;
    const tB = Date.parse(b.dateIso) || 0;
    if (a.statusState === 'pre') return tA - tB;
    return tB - tA;
  });
}

async function fetchDirectFromEspnClient(): Promise<LiveScoreResponse> {
  const yesterday = formatDateYYYYMMDD(-1);
  const today = formatDateYYYYMMDD(0);
  const tomorrow = formatDateYYYYMMDD(1);

  const factories: Array<() => Promise<LiveMatchItem[]>> = [];

  for (const league of LIVE_SCORE_LEAGUES) {
    const dateParams = league.continentalCup
      ? ['', today, tomorrow]
      : ['', today, tomorrow, yesterday];

    for (const dateStr of dateParams) {
      const url = dateStr
        ? `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.slug}/scoreboard?dates=${dateStr}`
        : `https://site.api.espn.com/apis/site/v2/sports/soccer/${league.slug}/scoreboard`;

      factories.push(async () => {
        const json = await fetchJsonSafe(url, 10_000);
        if (!json) return [];
        return parseEspnScoreboardEvents(json, league);
      });
    }
  }

  const settled = await runWithConcurrency(factories, 6);
  const deduped = new Map<string, LiveMatchItem>();
  for (const list of settled) {
    if (!Array.isArray(list)) continue;
    for (const match of list) {
      const existing = deduped.get(match.id);
      if (!existing || match.statusState === 'in' || match.events.length > existing.events.length) {
        deduped.set(match.id, match);
      }
    }
  }

  return {
    matches: sortLiveMatches(Array.from(deduped.values())),
    updatedAt: Date.now(),
  };
}

export async function fetchRealFootballScores(forceRefresh = false): Promise<LiveScoreResponse> {
  const isApk = isCapacitorApkRuntime();

  if (!isApk) {
    const data = await fetchJsonSafe(
      getEndpoint(`/api/live-scores${forceRefresh ? '?refresh=1' : ''}`),
      15_000
    );
    if (data && Array.isArray(data.matches) && data.matches.length > 0) {
      saveCachedFootballScores(data);
      return data;
    }
  }

  const direct = await fetchDirectFromEspnClient();
  if (direct.matches.length > 0) {
    saveCachedFootballScores(direct);
    return direct;
  }

  const cached = getCachedFootballScores();
  if (cached && cached.matches.length > 0) {
    return cached;
  }

  return direct;
}

export async function fetchRealMatchDetail(
  leagueSlug: string,
  eventId: string
): Promise<LiveMatchDetail | null> {
  const isApk = isCapacitorApkRuntime();

  if (!isApk) {
    const data = await fetchJsonSafe(
      getEndpoint(`/api/live-scores/match?league=${encodeURIComponent(leagueSlug)}&eventId=${encodeURIComponent(eventId)}`),
      12_000
    );
    if (data && data.eventId) {
      return data as LiveMatchDetail;
    }
  }

  // Direct ESPN fallback (for APK or offline backend)
  const [sum, leagueStd] = await Promise.all([
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/summary?event=${eventId}`, 10_000),
    fetchJsonSafe(`https://site.api.espn.com/apis/v2/sports/soccer/${leagueSlug}/standings`, 8_000),
  ]);
  if (!sum) return null;

  const boxTeams = Array.isArray(sum?.boxscore?.teams) ? sum.boxscore.teams : [];
  const parseStats = (teamEntry: any): MatchStatEntry[] =>
    (Array.isArray(teamEntry?.statistics) ? teamEntry.statistics : []).map((st: any) => ({
      name: String(st?.name || ''),
      label: String(st?.label || st?.name || ''),
      value: String(st?.displayValue ?? st?.value ?? '0'),
    }));

  const venueObj = sum?.gameInfo?.venue;
  let rosters = (Array.isArray(sum?.rosters) ? sum.rosters : []).map((r: any) => ({
    teamId: String(r?.team?.id || ''),
    teamName: String(r?.team?.displayName || r?.team?.name || ''),
    homeAway: r?.homeAway === 'away' ? 'away' : 'home',
    formation: r?.formation ? String(r.formation) : undefined,
    isPossibleLineup: false,
    coach: Array.isArray(r?.coach) && r.coach[0] ? [r.coach[0].firstName, r.coach[0].lastName].filter(Boolean).join(' ') : undefined,
    players: (Array.isArray(r?.roster) ? r.roster : []).map((p: any) => ({
      id: String(p?.athlete?.id || ''),
      name: String(p?.athlete?.displayName || p?.athlete?.shortName || 'Player'),
      jersey: p?.jersey ? String(p.jersey) : p?.athlete?.jersey ? String(p.athlete.jersey) : '',
      position: String(p?.position?.abbreviation || p?.position?.displayName || ''),
      starter: Boolean(p?.starter),
      subbedIn: Boolean(p?.subbedIn),
      subbedOut: Boolean(p?.subbedOut),
    })),
  }));

  const hasStarters = rosters.some((r: any) => r.players.some((p: any) => p.starter));
  if (!hasStarters) {
    const homeId = String(boxTeams[0]?.team?.id || sum?.header?.competitions?.[0]?.competitors?.[0]?.team?.id || '');
    const awayId = String(boxTeams[1]?.team?.id || sum?.header?.competitions?.[0]?.competitors?.[1]?.team?.id || '');
    const homeName = String(boxTeams[0]?.team?.displayName || sum?.header?.competitions?.[0]?.competitors?.[0]?.team?.displayName || 'Home Team');
    const awayName = String(boxTeams[1]?.team?.displayName || sum?.header?.competitions?.[0]?.competitors?.[1]?.team?.displayName || 'Away Team');

    const [homeRosterRes, awayRosterRes] = await Promise.all([
      homeId ? fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams/${homeId}/roster`, 7000) : null,
      awayId ? fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams/${awayId}/roster`, 7000) : null,
    ]);

    const buildPossibleTeamLineup = (teamId: string, teamName: string, homeAway: 'home' | 'away', rosterData: any): MatchLineup => {
      const athletes: any[] = Array.isArray(rosterData?.athletes) ? rosterData.athletes : [];
      const coachEntry = Array.isArray(rosterData?.coach) ? rosterData.coach[0] : null;
      const coachName = coachEntry ? [coachEntry.firstName, coachEntry.lastName].filter(Boolean).join(' ') : undefined;

      const gks = athletes.filter((a: any) => String(a?.position?.abbreviation || a?.position?.name || '').toUpperCase().startsWith('G'));
      const dfs = athletes.filter((a: any) => String(a?.position?.abbreviation || a?.position?.name || '').toUpperCase().startsWith('D'));
      const mfs = athletes.filter((a: any) => String(a?.position?.abbreviation || a?.position?.name || '').toUpperCase().startsWith('M'));
      const fws = athletes.filter((a: any) => String(a?.position?.abbreviation || a?.position?.name || '').toUpperCase().startsWith('F'));

      const chosenStarters: any[] = [
        ...gks.slice(0, 1),
        ...dfs.slice(0, 4),
        ...mfs.slice(0, 3),
        ...fws.slice(0, 3),
      ];

      const remainingPool = athletes.filter((a: any) => !chosenStarters.includes(a));
      while (chosenStarters.length < 11 && remainingPool.length > 0) {
        chosenStarters.push(remainingPool.shift());
      }

      const bench = athletes.filter((a: any) => !chosenStarters.includes(a));

      return {
        teamId,
        teamName,
        homeAway,
        formation: '4-3-3 (Possible Lineup)',
        isPossibleLineup: true,
        coach: coachName,
        players: [
          ...chosenStarters.map((a: any) => ({
            id: String(a?.id || ''),
            name: String(a?.displayName || a?.fullName || 'Player'),
            jersey: a?.jersey ? String(a.jersey) : '',
            position: String(a?.position?.abbreviation || a?.position?.displayName || 'Starter'),
            starter: true,
            subbedIn: false,
            subbedOut: false,
          })),
          ...bench.map((a: any) => ({
            id: String(a?.id || ''),
            name: String(a?.displayName || a?.fullName || 'Player'),
            jersey: a?.jersey ? String(a.jersey) : '',
            position: String(a?.position?.abbreviation || a?.position?.displayName || 'Sub'),
            starter: false,
            subbedIn: false,
            subbedOut: false,
          })),
        ],
      };
    };

    rosters = [
      buildPossibleTeamLineup(homeId, homeName, 'home', homeRosterRes),
      buildPossibleTeamLineup(awayId, awayName, 'away', awayRosterRes),
    ];
  }

  return {
    eventId,
    leagueSlug,
    venue: venueObj?.fullName ? String(venueObj.fullName) : undefined,
    venueCity: venueObj?.address?.city
      ? `${venueObj.address.city}${venueObj.address.country ? `, ${venueObj.address.country}` : ''}`
      : undefined,
    attendance: typeof sum?.gameInfo?.attendance === 'number' ? sum.gameInfo.attendance : undefined,
    referee: sum?.gameInfo?.officials?.[0]?.fullName || sum?.gameInfo?.officials?.[0]?.displayName || undefined,
    odds:
      Array.isArray(sum?.odds) && sum.odds[0]
        ? {
            provider: String(sum.odds[0]?.provider?.name || 'Odds'),
            details: sum.odds[0]?.details ? String(sum.odds[0].details) : undefined,
            overUnder: sum.odds[0]?.overUnder ?? undefined,
            homeMoneyLine: sum.odds[0]?.homeTeamOdds?.moneyLine ?? undefined,
            awayMoneyLine: sum.odds[0]?.awayTeamOdds?.moneyLine ?? undefined,
            drawMoneyLine: sum.odds[0]?.drawOdds?.moneyLine ?? undefined,
          }
        : undefined,
    stats: {
      homeTeamId: String(boxTeams[0]?.team?.id || ''),
      awayTeamId: String(boxTeams[1]?.team?.id || ''),
      home: parseStats(boxTeams[0]),
      away: parseStats(boxTeams[1]),
    },
    isPossibleLineup: !hasStarters,
    rosters,
    lastFiveGames: (Array.isArray(sum?.lastFiveGames) ? sum.lastFiveGames : []).map((lf: any) => ({
      teamId: String(lf?.team?.id || ''),
      teamName: String(lf?.team?.displayName || lf?.team?.name || ''),
      teamLogo: lf?.team?.logo || undefined,
      games: (Array.isArray(lf?.events) ? lf.events : []).map((g: any) => ({
        id: String(g?.id || ''),
        date: String(g?.gameDate || ''),
        score: String(g?.score || ''),
        result: String(g?.gameResult || ''),
        opponent: String(g?.opponent?.displayName || g?.opponent?.shortDisplayName || g?.opponent?.abbreviation || ''),
        opponentLogo: g?.opponent?.logo || undefined,
        homeAway: String(g?.atVs || ''),
        leagueName: String(g?.leagueAbbreviation || g?.leagueName || ''),
      })),
    })),
    standings: extractStandingsRowsClient(sum?.standings || leagueStd),
    news: (Array.isArray(sum?.news?.articles) ? sum.news.articles : []).slice(0, 4).map((a: any) => ({
      headline: String(a?.headline || ''),
      published: String(a?.published || ''),
      link: a?.links?.web?.href || undefined,
    })),
    updatedAt: Date.now(),
  };
}

export async function fetchRealLeagueStandings(
  leagueSlug: string
): Promise<LeagueStandingsResponse> {
  const isApk = isCapacitorApkRuntime();
  if (!isApk) {
    const data = await fetchJsonSafe(
      getEndpoint(`/api/live-scores/standings?league=${encodeURIComponent(leagueSlug)}`),
      10_000
    );
    if (data && Array.isArray(data.standings)) {
      return data as LeagueStandingsResponse;
    }
  }

  // Direct ESPN fallback
  const raw = await fetchJsonSafe(
    `https://site.api.espn.com/apis/v2/sports/soccer/${leagueSlug}/standings`,
    8000
  );
  const rows = extractStandingsRowsClient(raw);
  return {
    leagueSlug,
    leagueName: String(raw?.name || leagueSlug),
    standings: rows,
    updatedAt: Date.now(),
  };
}

export function buildLiveFootballPromptContext(query = ''): string {
  const cached = getCachedFootballScores();
  if (!cached || !cached.matches || cached.matches.length === 0) return '';
  const liveMatches = cached.matches.filter((m) => m.statusState === 'in');
  const postMatches = cached.matches.filter((m) => m.statusState === 'post').slice(0, 15);
  const preMatches = cached.matches.filter((m) => m.statusState === 'pre').slice(0, 10);

  const lines: string[] = ['[REAL-TIME FOOTBALL LIVE SCORE & RESULTS DATABASE (DIRECT ACCESS)]:'];
  lines.push('You have complete, direct access to the live score database for European & African football:');
  if (liveMatches.length > 0) {
    lines.push('LIVE MATCHES HAPPENING RIGHT NOW:');
    for (const m of liveMatches) {
      const goals = m.events.filter((e) => e.type === 'goal' || e.type === 'penalty').map((e) => `${e.playerName} ${e.minute}`).join(', ');
      lines.push(`• [LIVE ${m.clock || m.statusDetail}] ${m.homeTeam.name} ${m.homeTeam.score} - ${m.awayTeam.score} ${m.awayTeam.name} (${m.leagueName})${goals ? ` [Goals: ${goals}]` : ''}`);
    }
  } else {
    lines.push('CURRENT LIVE MATCHES: Nta mukino uri kuba LIVE muri aka kanya.');
  }

  if (postMatches.length > 0) {
    lines.push('\nRECENT FINISHED MATCH RESULTS (UKO BYAGENZE):');
    for (const m of postMatches.slice(0, 10)) {
      const goals = m.events.filter((e) => e.type === 'goal' || e.type === 'penalty').map((e) => `${e.playerName} ${e.minute}`).join(', ');
      lines.push(`• [FT] ${m.homeTeam.name} ${m.homeTeam.score} - ${m.awayTeam.score} ${m.awayTeam.name} (${m.leagueName})${goals ? ` [Goals: ${goals}]` : ''}`);
    }
  }

  if (preMatches.length > 0) {
    lines.push('\nUPCOMING SCHEDULED MATCHES:');
    for (const m of preMatches.slice(0, 8)) {
      lines.push(`• ${m.homeTeam.name} vs ${m.awayTeam.name} (${m.leagueName}) - ${m.dateIso}`);
    }
  }

  lines.push('\nWhen the user asks in Kinyarwanda or English about football scores, match results, how a game went ("uko byagenze"), who scored, or upcoming games, use these exact real facts and numbers directly!');
  return lines.join('\n');
}

export async function fetchRealTeamProfile(
  leagueSlug: string,
  teamId: string
): Promise<TeamFullProfile | null> {
  const isApk = isCapacitorApkRuntime();

  if (!isApk) {
    const data = await fetchJsonSafe(
      getEndpoint(`/api/live-scores/team?league=${encodeURIComponent(leagueSlug)}&teamId=${encodeURIComponent(teamId)}`),
      12_000
    );
    if (data && data.team) {
      return data as TeamFullProfile;
    }
  }

  // Direct ESPN fallback
  const [teamRes, rosterRes, scheduleRes, standingsRes] = await Promise.all([
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams/${teamId}`, 10_000),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams/${teamId}/roster`, 10_000),
    fetchJsonSafe(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/teams/${teamId}/schedule`, 10_000),
    fetchJsonSafe(`https://site.api.espn.com/apis/v2/sports/soccer/${leagueSlug}/standings`, 8_000),
  ]);

  const t = teamRes?.team;
  if (!t && !rosterRes && !scheduleRes) return null;

  const recordStats = new Map<string, string>();
  const recordItems = Array.isArray(t?.record?.items) ? t.record.items : [];
  const overallRecord = recordItems[0];
  if (Array.isArray(overallRecord?.stats)) {
    for (const st of overallRecord.stats) {
      if (st?.name) recordStats.set(String(st.name), String(st.displayValue ?? st.value ?? '0'));
    }
  }

  const coachEntry = Array.isArray(rosterRes?.coach) ? rosterRes.coach[0] : null;
  const coachName = coachEntry
    ? [coachEntry.firstName, coachEntry.lastName].filter(Boolean).join(' ').trim() || undefined
    : undefined;

  const standings = extractStandingsRowsClient(standingsRes);
  const standingRow = standings.find((r) => r.teamId === teamId);

  const nextEv =
    Array.isArray(t?.nextEvent) && t.nextEvent[0]
      ? {
          id: String(t.nextEvent[0]?.id || ''),
          name: String(t.nextEvent[0]?.name || ''),
          dateIso: String(t.nextEvent[0]?.date || ''),
          venue: t.nextEvent[0]?.competitions?.[0]?.venue?.fullName || undefined,
        }
      : undefined;

  return {
    team: {
      id: String(t?.id || teamId),
      name: String(t?.displayName || t?.name || 'Team'),
      shortName: String(t?.abbreviation || t?.shortDisplayName || ''),
      logo: t?.logos?.[0]?.href || undefined,
      color: t?.color ? `#${t.color}` : undefined,
      leagueSlug,
      leagueName: String(t?.defaultLeague?.name || scheduleRes?.team?.league?.name || leagueSlug),
      standingSummary: t?.standingSummary ? String(t.standingSummary) : undefined,
      recordSummary: overallRecord?.summary ? String(overallRecord.summary) : undefined,
      coach: coachName,
      venue: t?.venue?.fullName || standingRow?.note || undefined,
      stats: {
        gamesPlayed: recordStats.get('gamesPlayed') || standingRow?.played || '0',
        wins: recordStats.get('wins') || standingRow?.wins || '0',
        draws: recordStats.get('ties') || standingRow?.draws || '0',
        losses: recordStats.get('losses') || standingRow?.losses || '0',
        points: recordStats.get('points') || standingRow?.points || '0',
        goalsFor: recordStats.get('pointsFor') || standingRow?.goalsFor || '0',
        goalsAgainst: recordStats.get('pointsAgainst') || standingRow?.goalsAgainst || '0',
        goalDiff: recordStats.get('pointDifferential') || standingRow?.goalDiff || '0',
        homeRecord: `${recordStats.get('homeWins') || '0'}W-${recordStats.get('homeTies') || '0'}D-${recordStats.get('homeLosses') || '0'}L`,
        awayRecord: `${recordStats.get('awayWins') || '0'}W-${recordStats.get('awayTies') || '0'}D-${recordStats.get('awayLosses') || '0'}L`,
      },
      nextEvent: nextEv,
    },
    roster: (Array.isArray(rosterRes?.athletes) ? rosterRes.athletes : []).map((a: any) => {
      const statValues = new Map<string, string>();
      const cats = Array.isArray(a?.statistics?.splits?.categories) ? a.statistics.splits.categories : [];
      for (const c of cats) {
        for (const st of Array.isArray(c?.stats) ? c.stats : []) {
          if (st?.name) statValues.set(String(st.name), String(st.displayValue ?? st.value ?? '0'));
        }
      }
      return {
        id: String(a?.id || ''),
        name: String(a?.displayName || a?.fullName || 'Player'),
        shortName: String(a?.shortName || a?.displayName || ''),
        jersey: a?.jersey ? String(a.jersey) : '',
        position: String(a?.position?.displayName || a?.position?.name || ''),
        positionAbbr: String(a?.position?.abbreviation || ''),
        age: typeof a?.age === 'number' ? a.age : undefined,
        height: a?.displayHeight ? String(a.displayHeight) : undefined,
        nationality: a?.citizenship ? String(a.citizenship) : undefined,
        flagUrl: a?.flag?.href || undefined,
        appearances: statValues.get('appearances') || '0',
        goals: statValues.get('totalGoals') || statValues.get('goals') || '0',
        assists: statValues.get('goalAssists') || statValues.get('assists') || '0',
        yellowCards: statValues.get('yellowCards') || '0',
        redCards: statValues.get('redCards') || '0',
      };
    }),
    schedule: (Array.isArray(scheduleRes?.events) ? scheduleRes.events : []).map((ev: any) => {
      const comp = ev?.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === 'home') || comp?.competitors?.[0];
      const away = comp?.competitors?.find((c: any) => c.homeAway === 'away') || comp?.competitors?.[1];
      const stateRaw = String(comp?.status?.type?.state || ev?.status?.type?.state || 'pre').toLowerCase();
      const statusState: MatchStatusState = stateRaw === 'in' ? 'in' : stateRaw === 'post' ? 'post' : 'pre';
      const parseScore = (c: any) => {
        if (statusState === 'pre') return null;
        const v = c?.score?.value ?? c?.score?.displayValue ?? c?.score;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      return {
        id: `${leagueSlug}:${String(ev?.id || '')}`,
        eventId: String(ev?.id || ''),
        leagueSlug,
        dateIso: String(ev?.date || comp?.date || ''),
        competitionName: String(ev?.seasonType?.name || ev?.league?.name || t?.defaultLeague?.name || leagueSlug),
        statusState,
        statusDetail: String(comp?.status?.type?.shortDetail || ev?.status?.type?.shortDetail || ''),
        venue: comp?.venue?.fullName || undefined,
        homeTeam: {
          id: String(home?.team?.id || ''),
          name: String(home?.team?.displayName || home?.team?.name || 'Home'),
          shortName: String(home?.team?.abbreviation || 'HOM'),
          logo: home?.team?.logos?.[0]?.href || home?.team?.logo || undefined,
          score: parseScore(home),
          winner: Boolean(home?.winner),
        },
        awayTeam: {
          id: String(away?.team?.id || ''),
          name: String(away?.team?.displayName || away?.team?.name || 'Away'),
          shortName: String(away?.team?.abbreviation || 'AWY'),
          logo: away?.team?.logos?.[0]?.href || away?.team?.logo || undefined,
          score: parseScore(away),
          winner: Boolean(away?.winner),
        },
      };
    }),
    standings,
    updatedAt: Date.now(),
  };
}
