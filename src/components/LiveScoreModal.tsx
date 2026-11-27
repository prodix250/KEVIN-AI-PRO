/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  RefreshCw,
  Search,
  Trophy,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Clock,
  AlertCircle,
  Users,
  BarChart3,
  ListOrdered,
  Shield,
  Calendar,
  ExternalLink,
  Star,
  Activity,
  UserX,
  UserCheck,
} from 'lucide-react';
import {
  FootballRegion,
  LiveMatchDetail,
  LiveMatchItem,
  LiveMatchTeam,
  MatchStatusState,
  StandingRow,
  TeamFullProfile,
  fetchRealFootballScores,
  fetchRealLeagueStandings,
  fetchRealMatchDetail,
  fetchRealTeamProfile,
  getCachedFootballScores,
} from '../services/liveScoreService';
import {
  FavoritesState,
  getFavorites,
  saveFavorites,
  toggleFavoriteMatch as notifToggleMatch,
  toggleFavoriteTeam as notifToggleTeam,
  requestNotificationPermission,
} from '../services/footballNotificationService';

interface LiveScoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type RegionFilter = 'all' | FootballRegion;
type StatusFilter = 'all' | 'favourites' | MatchStatusState | 'standings';
type DayFilter = 'all' | 'yesterday' | 'today' | 'tomorrow';
type MatchTab = 'details' | 'lineups' | 'stats' | 'standings';
type TeamTab = 'overview' | 'matches' | 'squad';

type RightPanelView =
  | { kind: 'match'; match: LiveMatchItem }
  | { kind: 'team'; leagueSlug: string; team: LiveMatchTeam; leagueName?: string; returnMatch?: LiveMatchItem }
  | { kind: 'standings'; leagueSlug?: string };

function TeamCrest({
  name,
  shortName,
  logo,
  size = 'md',
}: {
  name: string;
  shortName: string;
  logo?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [logo]);

  const sizeClass =
    size === 'lg' ? 'w-12 h-12' : size === 'sm' ? 'w-5 h-5' : 'w-6 h-6';

  if (logo && !imgFailed) {
    return (
      <img
        src={logo}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className={`${sizeClass} object-contain shrink-0`}
      />
    );
  }

  const initials = (shortName || name || 'FC').slice(0, 3).toUpperCase();
  const textClass = size === 'lg' ? 'text-xs' : size === 'sm' ? 'text-[9px]' : 'text-[10px]';
  return (
    <span
      className={`${sizeClass} rounded-full bg-slate-100 dark:bg-[#2a3942] border border-slate-200 dark:border-[#3b4a54] ${textClass} font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center shrink-0 tabular-nums`}
    >
      {initials}
    </span>
  );
}

function LeagueCrest({ name, logo }: { name: string; logo?: string }) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [logo]);

  if (logo && !imgFailed) {
    return (
      <img
        src={logo}
        alt={name}
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className="w-5 h-5 object-contain shrink-0"
      />
    );
  }

  return <Trophy size={16} className="text-[#075E54] dark:text-[#00FF88] shrink-0" />;
}

function CountryFlag({ url, alt }: { url?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) return null;
  return (
    <img
      src={url}
      alt={alt || ''}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-4 h-3 object-cover rounded-[2px] shrink-0"
    />
  );
}

function getKigaliDayKey(dateIsoOrOffset: string | number): string {
  const d =
    typeof dateIsoOrOffset === 'number'
      ? new Date(Date.now() + dateIsoOrOffset * 86_400_000)
      : new Date(Date.parse(dateIsoOrOffset));
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Kigali' });
}

function formatKickoffTime(dateIso: string): string {
  const ms = Date.parse(dateIso);
  if (!Number.isFinite(ms)) return '--:--';
  const d = new Date(ms);
  const timeStr = d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Kigali',
  });

  const todayKey = getKigaliDayKey(0);
  const tomorrowKey = getKigaliDayKey(1);
  const yesterdayKey = getKigaliDayKey(-1);
  const matchKey = getKigaliDayKey(dateIso);

  if (matchKey === todayKey) return `${timeStr} · Today`;
  if (matchKey === tomorrowKey) return `${timeStr} · Tomorrow`;
  if (matchKey === yesterdayKey) return `${timeStr} · Yesterday`;

  const dayStr = d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'Africa/Kigali',
  });
  return `${timeStr} · ${dayStr}`;
}

function formatShortTimeOnly(dateIso: string): string {
  const ms = Date.parse(dateIso);
  if (!Number.isFinite(ms)) return '--:--';
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Africa/Kigali',
  });
}

function extractEventId(match: LiveMatchItem): string {
  if (match.eventId) return match.eventId;
  const parts = match.id.split(':');
  return parts[1] || match.id;
}

const POPULAR_SQUADS: Record<
  string,
  {
    coach: string;
    formation: string;
    starters: Array<{ name: string; jersey: string; pos: string }>;
    subs: Array<{ name: string; jersey: string; pos: string }>;
  }
> = {
  chelsea: {
    coach: 'Enzo Maresca',
    formation: '4-2-3-1',
    starters: [
      { name: 'Robert Sánchez', jersey: '1', pos: 'GK' },
      { name: 'Malo Gusto', jersey: '27', pos: 'RB' },
      { name: 'Wesley Fofana', jersey: '29', pos: 'CB' },
      { name: 'Levi Colwill', jersey: '6', pos: 'CB' },
      { name: 'Marc Cucurella', jersey: '3', pos: 'LB' },
      { name: 'Moisés Caicedo', jersey: '25', pos: 'DM' },
      { name: 'Roméo Lavia', jersey: '45', pos: 'DM' },
      { name: 'Noni Madueke', jersey: '11', pos: 'RW' },
      { name: 'Cole Palmer', jersey: '20', pos: 'AM' },
      { name: 'Pedro Neto', jersey: '7', pos: 'LW' },
      { name: 'Nicolas Jackson', jersey: '15', pos: 'ST' },
    ],
    subs: [
      { name: 'Filip Jörgensen', jersey: '12', pos: 'GK' },
      { name: 'Axel Disasi', jersey: '2', pos: 'CB' },
      { name: 'Benoît Badiashile', jersey: '5', pos: 'CB' },
      { name: 'Enzo Fernández', jersey: '8', pos: 'MF' },
      { name: 'Mykhailo Mudryk', jersey: '10', pos: 'FW' },
      { name: 'João Félix', jersey: '14', pos: 'FW' },
      { name: 'Christopher Nkunku', jersey: '18', pos: 'ST' },
    ],
  },
  forest: {
    coach: 'Nuno Espírito Santo',
    formation: '4-2-3-1',
    starters: [
      { name: 'Matz Sels', jersey: '26', pos: 'GK' },
      { name: 'Ola Aina', jersey: '34', pos: 'RB' },
      { name: 'Nikola Milenković', jersey: '31', pos: 'CB' },
      { name: 'Murillo', jersey: '5', pos: 'CB' },
      { name: 'Álex Moreno', jersey: '19', pos: 'LB' },
      { name: 'Ryan Yates', jersey: '22', pos: 'DM' },
      { name: 'Nicolás Domínguez', jersey: '16', pos: 'DM' },
      { name: 'Anthony Elanga', jersey: '21', pos: 'RW' },
      { name: 'Morgan Gibbs-White', jersey: '10', pos: 'AM' },
      { name: 'Callum Hudson-Odoi', jersey: '14', pos: 'LW' },
      { name: 'Chris Wood', jersey: '11', pos: 'ST' },
    ],
    subs: [
      { name: 'Carlos Miguel', jersey: '1', pos: 'GK' },
      { name: 'Willy Boly', jersey: '30', pos: 'DF' },
      { name: 'Neco Williams', jersey: '7', pos: 'DF' },
      { name: 'Elliot Anderson', jersey: '8', pos: 'MF' },
      { name: 'James Ward-Prowse', jersey: '18', pos: 'MF' },
      { name: 'Ramón Sosa', jersey: '24', pos: 'FW' },
      { name: 'Taiwo Awoniyi', jersey: '9', pos: 'ST' },
    ],
  },
  arsenal: {
    coach: 'Mikel Arteta',
    formation: '4-3-3',
    starters: [
      { name: 'David Raya', jersey: '1', pos: 'GK' },
      { name: 'Ben White', jersey: '4', pos: 'RB' },
      { name: 'William Saliba', jersey: '2', pos: 'CB' },
      { name: 'Gabriel Magalhães', jersey: '6', pos: 'CB' },
      { name: 'Jurriën Timber', jersey: '12', pos: 'LB' },
      { name: 'Thomas Partey', jersey: '5', pos: 'DM' },
      { name: 'Declan Rice', jersey: '41', pos: 'CM' },
      { name: 'Martin Ødegaard', jersey: '8', pos: 'AM' },
      { name: 'Bukayo Saka', jersey: '7', pos: 'RW' },
      { name: 'Kai Havertz', jersey: '29', pos: 'ST' },
      { name: 'Gabriel Martinelli', jersey: '11', pos: 'LW' },
    ],
    subs: [
      { name: 'Neto', jersey: '32', pos: 'GK' },
      { name: 'Jakub Kiwior', jersey: '15', pos: 'DF' },
      { name: 'Riccardo Calafiori', jersey: '33', pos: 'DF' },
      { name: 'Mikel Merino', jersey: '23', pos: 'MF' },
      { name: 'Leandro Trossard', jersey: '19', pos: 'FW' },
      { name: 'Gabriel Jesus', jersey: '9', pos: 'ST' },
      { name: 'Raheem Sterling', jersey: '30', pos: 'FW' },
    ],
  },
  manchester_city: {
    coach: 'Pep Guardiola',
    formation: '4-3-3',
    starters: [
      { name: 'Ederson', jersey: '31', pos: 'GK' },
      { name: 'Kyle Walker', jersey: '2', pos: 'RB' },
      { name: 'Rúben Dias', jersey: '3', pos: 'CB' },
      { name: 'Manuel Akanji', jersey: '25', pos: 'CB' },
      { name: 'Joško Gvardiol', jersey: '24', pos: 'LB' },
      { name: 'Mateo Kovačić', jersey: '8', pos: 'DM' },
      { name: 'İlkay Gündoğan', jersey: '19', pos: 'CM' },
      { name: 'Kevin De Bruyne', jersey: '17', pos: 'AM' },
      { name: 'Bernardo Silva', jersey: '20', pos: 'RW' },
      { name: 'Erling Haaland', jersey: '9', pos: 'ST' },
      { name: 'Phil Foden', jersey: '47', pos: 'LW' },
    ],
    subs: [
      { name: 'Stefan Ortega', jersey: '18', pos: 'GK' },
      { name: 'John Stones', jersey: '5', pos: 'DF' },
      { name: 'Nathan Aké', jersey: '6', pos: 'DF' },
      { name: 'Rico Lewis', jersey: '82', pos: 'DF' },
      { name: 'Matheus Nunes', jersey: '27', pos: 'MF' },
      { name: 'Savinho', jersey: '26', pos: 'FW' },
      { name: 'Jack Grealish', jersey: '10', pos: 'FW' },
    ],
  },
  liverpool: {
    coach: 'Arne Slot',
    formation: '4-2-3-1',
    starters: [
      { name: 'Alisson Becker', jersey: '1', pos: 'GK' },
      { name: 'Trent Alexander-Arnold', jersey: '66', pos: 'RB' },
      { name: 'Ibrahima Konaté', jersey: '5', pos: 'CB' },
      { name: 'Virgil van Dijk', jersey: '4', pos: 'CB' },
      { name: 'Andy Robertson', jersey: '26', pos: 'LB' },
      { name: 'Ryan Gravenberch', jersey: '38', pos: 'DM' },
      { name: 'Alexis Mac Allister', jersey: '10', pos: 'CM' },
      { name: 'Dominik Szoboszlai', jersey: '8', pos: 'AM' },
      { name: 'Mohamed Salah', jersey: '11', pos: 'RW' },
      { name: 'Darwin Núñez', jersey: '9', pos: 'ST' },
      { name: 'Luis Díaz', jersey: '7', pos: 'LW' },
    ],
    subs: [
      { name: 'Caoimhín Kelleher', jersey: '62', pos: 'GK' },
      { name: 'Conor Bradley', jersey: '84', pos: 'DF' },
      { name: 'Joe Gomez', jersey: '2', pos: 'DF' },
      { name: 'Wataru Endo', jersey: '3', pos: 'MF' },
      { name: 'Curtis Jones', jersey: '17', pos: 'MF' },
      { name: 'Cody Gakpo', jersey: '18', pos: 'FW' },
      { name: 'Federico Chiesa', jersey: '14', pos: 'FW' },
    ],
  },
  real_madrid: {
    coach: 'Carlo Ancelotti',
    formation: '4-3-3',
    starters: [
      { name: 'Thibaut Courtois', jersey: '1', pos: 'GK' },
      { name: 'Lucas Vázquez', jersey: '17', pos: 'RB' },
      { name: 'Éder Militão', jersey: '3', pos: 'CB' },
      { name: 'Antonio Rüdiger', jersey: '22', pos: 'CB' },
      { name: 'Ferland Mendy', jersey: '23', pos: 'LB' },
      { name: 'Federico Valverde', jersey: '8', pos: 'CM' },
      { name: 'Aurélien Tchouaméni', jersey: '14', pos: 'DM' },
      { name: 'Jude Bellingham', jersey: '5', pos: 'AM' },
      { name: 'Rodrygo', jersey: '11', pos: 'RW' },
      { name: 'Kylian Mbappé', jersey: '9', pos: 'ST' },
      { name: 'Vinícius Júnior', jersey: '7', pos: 'LW' },
    ],
    subs: [
      { name: 'Andriy Lunin', jersey: '13', pos: 'GK' },
      { name: 'Fran García', jersey: '20', pos: 'DF' },
      { name: 'Luka Modrić', jersey: '10', pos: 'MF' },
      { name: 'Eduardo Camavinga', jersey: '6', pos: 'MF' },
      { name: 'Dani Ceballos', jersey: '19', pos: 'MF' },
      { name: 'Arda Güler', jersey: '15', pos: 'FW' },
      { name: 'Endrick', jersey: '16', pos: 'ST' },
    ],
  },
  barcelona: {
    coach: 'Hansi Flick',
    formation: '4-2-3-1',
    starters: [
      { name: 'Iñaki Peña', jersey: '13', pos: 'GK' },
      { name: 'Jules Koundé', jersey: '23', pos: 'RB' },
      { name: 'Pau Cubarsí', jersey: '2', pos: 'CB' },
      { name: 'Iñigo Martínez', jersey: '5', pos: 'CB' },
      { name: 'Alejandro Balde', jersey: '3', pos: 'LB' },
      { name: 'Marc Casadó', jersey: '17', pos: 'DM' },
      { name: 'Pedri', jersey: '8', pos: 'CM' },
      { name: 'Dani Olmo', jersey: '20', pos: 'AM' },
      { name: 'Lamine Yamal', jersey: '19', pos: 'RW' },
      { name: 'Robert Lewandowski', jersey: '9', pos: 'ST' },
      { name: 'Raphinha', jersey: '11', pos: 'LW' },
    ],
    subs: [
      { name: 'Wojciech Szczęsny', jersey: '25', pos: 'GK' },
      { name: 'Héctor Fort', jersey: '32', pos: 'DF' },
      { name: 'Sergi Domínguez', jersey: '36', pos: 'DF' },
      { name: 'Frenkie de Jong', jersey: '21', pos: 'MF' },
      { name: 'Gavi', jersey: '6', pos: 'MF' },
      { name: 'Ansu Fati', jersey: '10', pos: 'FW' },
      { name: 'Pau Víctor', jersey: '18', pos: 'FW' },
    ],
  },
  apr: {
    coach: 'Darko Nović',
    formation: '4-3-3',
    starters: [
      { name: 'Pavelh Ndzila', jersey: '1', pos: 'GK' },
      { name: 'Fitina Omborenga', jersey: '2', pos: 'RB' },
      { name: 'Claude Niyomugabo', jersey: '3', pos: 'LB' },
      { name: 'Prince Buregeya', jersey: '4', pos: 'CB' },
      { name: 'Salomon Bindjeme', jersey: '5', pos: 'CB' },
      { name: 'Taddeo Lwanga', jersey: '6', pos: 'DM' },
      { name: 'Jean Bosco Ruboneka', jersey: '8', pos: 'CM' },
      { name: 'Gilbert Mugisha', jersey: '10', pos: 'AM' },
      { name: 'Mamadou Sy', jersey: '7', pos: 'RW' },
      { name: 'Victor Mbaoma', jersey: '9', pos: 'ST' },
      { name: 'Richmond Lamptey', jersey: '11', pos: 'LW' },
    ],
    subs: [
      { name: 'Pierre Ishimwe', jersey: '16', pos: 'GK' },
      { name: 'Yunusu Nshimiyimana', jersey: '14', pos: 'DF' },
      { name: 'Ismail Nshimirimana', jersey: '18', pos: 'MF' },
      { name: 'Ramadhan Niyibizi', jersey: '20', pos: 'FW' },
      { name: 'Alain Kwitonda', jersey: '22', pos: 'FW' },
    ],
  },
  rayon: {
    coach: 'Roberto Oliveira',
    formation: '4-3-3',
    starters: [
      { name: 'Khadime Ndiaye', jersey: '1', pos: 'GK' },
      { name: 'Ally Serumogo', jersey: '2', pos: 'RB' },
      { name: 'Elie Ganijuru', jersey: '3', pos: 'LB' },
      { name: 'Isaac Mitima', jersey: '4', pos: 'CB' },
      { name: 'Aimable Nsabimana', jersey: '5', pos: 'CB' },
      { name: 'Roger Kanamugire', jersey: '6', pos: 'DM' },
      { name: 'Kevin Muhire', jersey: '8', pos: 'CM' },
      { name: 'Aruna Madjaliwa', jersey: '10', pos: 'AM' },
      { name: 'Charles Bbaale', jersey: '7', pos: 'RW' },
      { name: 'Fall Ngagne', jersey: '9', pos: 'ST' },
      { name: 'Hadji Iraguha', jersey: '11', pos: 'LW' },
    ],
    subs: [
      { name: 'Simon Tamale', jersey: '18', pos: 'GK' },
      { name: 'Didier Bugingo', jersey: '14', pos: 'DF' },
      { name: 'Youssef Rharb', jersey: '17', pos: 'MF' },
      { name: 'Prince Ondongo', jersey: '21', pos: 'FW' },
      { name: 'Paul Gomis', jersey: '25', pos: 'ST' },
    ],
  },
};

function getGuaranteedLineup(
  team: LiveMatchTeam,
  homeAway: 'home' | 'away',
  rosterTeam?: any,
  isPreMatch?: boolean
) {
  const starters = rosterTeam?.players?.filter((p: any) => p.starter) || [];
  const subs = rosterTeam?.players?.filter((p: any) => !p.starter) || [];
  const coach = rosterTeam?.coach;

  if (starters.length >= 11) {
    return {
      formation: rosterTeam?.formation || '4-3-3',
      isOfficial: !rosterTeam?.isPossibleLineup && !isPreMatch,
      coach: coach || undefined,
      starters,
      subs,
    };
  }

  // If rosterTeam has athletes, slice top 11
  const allPlayers = rosterTeam?.players || [];
  if (allPlayers.length >= 11) {
    return {
      formation: rosterTeam?.formation || '4-3-3 (Estimated)',
      isOfficial: false,
      coach: coach || undefined,
      starters: allPlayers.slice(0, 11).map((p: any) => ({ ...p, starter: true })),
      subs: allPlayers.slice(11).map((p: any) => ({ ...p, starter: false })),
    };
  }

  // Known catalog match
  const nameNorm = team.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  for (const [key, squad] of Object.entries(POPULAR_SQUADS)) {
    if (nameNorm.includes(key) || key.includes(nameNorm)) {
      return {
        formation: squad.formation,
        isOfficial: false,
        coach: coach || squad.coach,
        starters: squad.starters.map((p, idx) => ({
          id: `${team.id}-starter-${idx}`,
          name: p.name,
          jersey: p.jersey,
          position: p.pos,
          starter: true,
        })),
        subs: squad.subs.map((p, idx) => ({
          id: `${team.id}-sub-${idx}`,
          name: p.name,
          jersey: p.jersey,
          position: p.pos,
          starter: false,
        })),
      };
    }
  }

  // Realistic dynamic generator
  const genericStarters = [
    { pos: 'GK', jersey: '1' },
    { pos: 'RB', jersey: '2' },
    { pos: 'CB', jersey: '4' },
    { pos: 'CB', jersey: '5' },
    { pos: 'LB', jersey: '3' },
    { pos: 'DM', jersey: '6' },
    { pos: 'CM', jersey: '8' },
    { pos: 'AM', jersey: '10' },
    { pos: 'RW', jersey: '7' },
    { pos: 'ST', jersey: '9' },
    { pos: 'LW', jersey: '11' },
  ];

  const prefix = team.shortName || team.name.slice(0, 3).toUpperCase();
  return {
    formation: '4-3-3 (Possible Lineup)',
    isOfficial: false,
    coach: coach || `${team.name} Head Coach`,
    starters: genericStarters.map((slot, idx) => ({
      id: `${team.id}-starter-${idx}`,
      name: `${prefix} Starter ${slot.jersey}`,
      jersey: slot.jersey,
      position: slot.pos,
      starter: true,
    })),
    subs: [12, 14, 17, 18, 19, 21, 23].map((num, idx) => ({
      id: `${team.id}-sub-${idx}`,
      name: `${prefix} Sub ${num}`,
      jersey: String(num),
      position: idx === 0 ? 'GK' : idx <= 2 ? 'DF' : idx <= 4 ? 'MF' : 'FW',
      starter: false,
    })),
  };
}

export default function LiveScoreModal({ isOpen, onClose }: LiveScoreModalProps) {
  const initialCache = useMemo(() => getCachedFootballScores(), []);
  const [matches, setMatches] = useState<LiveMatchItem[]>(() => initialCache?.matches || []);
  const [updatedAt, setUpdatedAt] = useState<number>(() => initialCache?.updatedAt || 0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [regionFilter, setRegionFilter] = useState<RegionFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [dayFilter, setDayFilter] = useState<DayFilter>('all');
  const [leagueFilter, setLeagueFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Favorites state
  const [favorites, setFavorites] = useState<FavoritesState>(() => getFavorites());

  // Standings state
  const [leagueStandings, setLeagueStandings] = useState<Record<string, StandingRow[]>>({});
  const [standingsLoading, setStandingsLoading] = useState<boolean>(false);

  // Right-pane / drill-down state
  const [rightPanel, setRightPanel] = useState<RightPanelView | null>(null);
  const [mobileShowDetail, setMobileShowDetail] = useState<boolean>(false);

  // Match Detail state
  const [matchTab, setMatchTab] = useState<MatchTab>('details');
  const [matchDetail, setMatchDetail] = useState<LiveMatchDetail | null>(null);
  const [matchDetailLoading, setMatchDetailLoading] = useState<boolean>(false);

  // Team Profile state
  const [teamTab, setTeamTab] = useState<TeamTab>('overview');
  const [teamProfile, setTeamProfile] = useState<TeamFullProfile | null>(null);
  const [teamLoading, setTeamLoading] = useState<boolean>(false);

  const toggleFavoriteMatch = (matchId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const next = notifToggleMatch(matchId);
    setFavorites(next);
  };

  const toggleFavoriteTeam = (teamId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!teamId) return;
    const next = notifToggleTeam(teamId);
    setFavorites(next);
  };

  const loadScores = async (force = false, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetchRealFootballScores(force);
      setMatches((prev) => {
        if (res.matches.length > 0) return res.matches;
        return prev;
      });
      if (res.matches.length > 0 && res.updatedAt) {
        setUpdatedAt(res.updatedAt);
      } else if (res.matches.length === 0 && matches.length === 0) {
        setError('Nta mikino ibonetse kuri server ubu. Kanda Refresh wongere ugerageze.');
      }
    } catch {
      if (matches.length === 0) {
        setError('Ntibyashobotse kubona amakuru ya Live Score ubu. Ongera ugerageze.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadScores(false, matches.length > 0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const intervalId = window.setInterval(() => {
      loadScores(false, true);
    }, 45_000);
    return () => window.clearInterval(intervalId);
  }, [isOpen]);

  const regionMatches = useMemo(() => {
    const yesterdayKey = getKigaliDayKey(-1);
    const todayKey = getKigaliDayKey(0);
    const tomorrowKey = getKigaliDayKey(1);

    return matches.filter((m) => {
      if (regionFilter !== 'all' && m.region !== regionFilter) return false;
      if (dayFilter !== 'all') {
        const key = getKigaliDayKey(m.dateIso);
        if (dayFilter === 'today' && key !== todayKey) return false;
        if (dayFilter === 'yesterday' && key !== yesterdayKey) return false;
        if (dayFilter === 'tomorrow' && key !== tomorrowKey) return false;
      }
      return true;
    });
  }, [matches, regionFilter, dayFilter]);

  const counts = useMemo(() => {
    let live = 0;
    let upcoming = 0;
    let finished = 0;
    let favs = 0;
    for (const m of regionMatches) {
      if (m.statusState === 'in') live++;
      else if (m.statusState === 'pre') upcoming++;
      else finished++;
      if (favorites.matches.includes(m.id) || favorites.teams.includes(m.homeTeam.id) || favorites.teams.includes(m.awayTeam.id)) {
        favs++;
      }
    }
    return {
      all: regionMatches.length,
      live,
      upcoming,
      finished,
      favourites: favs,
    };
  }, [regionMatches, favorites]);

  const availableLeagues = useMemo(() => {
    const map = new Map<string, { slug: string; name: string }>();
    for (const m of regionMatches) {
      if (!map.has(m.leagueSlug)) {
        map.set(m.leagueSlug, { slug: m.leagueSlug, name: m.leagueName });
      }
    }
    return Array.from(map.values());
  }, [regionMatches]);

  const filteredMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return regionMatches.filter((m) => {
      if (statusFilter === 'favourites') {
        const isMatchFav = favorites.matches.includes(m.id);
        const isHomeFav = favorites.teams.includes(m.homeTeam.id);
        const isAwayFav = favorites.teams.includes(m.awayTeam.id);
        if (!isMatchFav && !isHomeFav && !isAwayFav) return false;
      } else if (statusFilter !== 'all' && statusFilter !== 'standings' && m.statusState !== statusFilter) {
        return false;
      }
      if (leagueFilter !== 'all' && m.leagueSlug !== leagueFilter) return false;
      if (q) {
        const hay = `${m.homeTeam.name} ${m.awayTeam.name} ${m.leagueName} ${m.countryLabel}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [regionMatches, statusFilter, leagueFilter, searchQuery, favorites]);

  // Keep desktop right pane populated
  useEffect(() => {
    if (!isOpen) return;
    if (!rightPanel && filteredMatches.length > 0 && statusFilter !== 'standings') {
      setRightPanel({ kind: 'match', match: filteredMatches[0] });
    } else if (rightPanel?.kind === 'match') {
      const fresh = matches.find((m) => m.id === rightPanel.match.id);
      if (fresh && fresh !== rightPanel.match) {
        setRightPanel({ kind: 'match', match: fresh });
      }
    }
  }, [isOpen, filteredMatches, matches, statusFilter]);

  // Load match detail
  const selectedMatchId = rightPanel?.kind === 'match' ? rightPanel.match.id : null;
  const selectedMatchLeague = rightPanel?.kind === 'match' ? rightPanel.match.leagueSlug : null;
  const selectedMatchEventId = rightPanel?.kind === 'match' ? extractEventId(rightPanel.match) : null;

  useEffect(() => {
    if (!isOpen || !selectedMatchId || !selectedMatchLeague || !selectedMatchEventId) return;
    let cancelled = false;
    setMatchDetailLoading(true);
    fetchRealMatchDetail(selectedMatchLeague, selectedMatchEventId)
      .then((detail) => {
        if (!cancelled) setMatchDetail(detail);
      })
      .finally(() => {
        if (!cancelled) setMatchDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedMatchId, selectedMatchLeague, selectedMatchEventId]);

  // Load team profile
  const selectedTeamId = rightPanel?.kind === 'team' ? rightPanel.team.id : null;
  const selectedTeamLeague = rightPanel?.kind === 'team' ? rightPanel.leagueSlug : null;

  useEffect(() => {
    if (!isOpen || !selectedTeamId || !selectedTeamLeague) return;
    let cancelled = false;
    setTeamLoading(true);
    setTeamProfile(null);
    fetchRealTeamProfile(selectedTeamLeague, selectedTeamId)
      .then((profile) => {
        if (!cancelled) setTeamProfile(profile);
      })
      .finally(() => {
        if (!cancelled) setTeamLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedTeamId, selectedTeamLeague]);

  const openMatchDetail = (match: LiveMatchItem) => {
    setMatchDetail(null);
    setMatchTab('details');
    setRightPanel({ kind: 'match', match });
    setMobileShowDetail(true);
  };

  const openTeamProfile = (
    leagueSlug: string,
    team: LiveMatchTeam,
    leagueName?: string,
    returnMatch?: LiveMatchItem
  ) => {
    setTeamTab('overview');
    setRightPanel({
      kind: 'team',
      leagueSlug,
      team,
      leagueName,
      returnMatch:
        returnMatch || (rightPanel?.kind === 'match' ? rightPanel.match : undefined),
    });
    setMobileShowDetail(true);
  };

  const openStandingsView = () => {
    setStatusFilter('standings');
    setRightPanel({ kind: 'standings', leagueSlug: leagueFilter !== 'all' ? leagueFilter : 'eng.1' });
    setMobileShowDetail(true);
  };

  const groupedByLeague = useMemo(() => {
    const groups: Array<{
      leagueSlug: string;
      leagueName: string;
      leagueLogo?: string;
      region: FootballRegion;
      countryLabel: string;
      items: LiveMatchItem[];
    }> = [];
    const indexMap = new Map<string, number>();

    for (const match of filteredMatches) {
      let idx = indexMap.get(match.leagueSlug);
      if (idx === undefined) {
        idx = groups.length;
        indexMap.set(match.leagueSlug, idx);
        groups.push({
          leagueSlug: match.leagueSlug,
          leagueName: match.leagueName,
          leagueLogo: match.leagueLogo,
          region: match.region,
          countryLabel: match.countryLabel,
          items: [],
        });
      }
      groups[idx].items.push(match);
    }

    return groups;
  }, [filteredMatches]);

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return '';
    return new Date(updatedAt).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, [updatedAt]);

  const pairedStats = useMemo(() => {
    if (!matchDetail) return [];
    const homeStats = matchDetail.stats.home || [];
    const awayStats = matchDetail.stats.away || [];
    const awayMap = new Map(awayStats.map((s) => [s.name, s.value]));
    const priorityOrder = [
      'possessionPct',
      'totalShots',
      'shotsOnTarget',
      'wonCorners',
      'foulsCommitted',
      'offsides',
      'saves',
      'yellowCards',
      'redCards',
      'goalAssists',
    ];
    const seen = new Set<string>();
    const rows: Array<{ key: string; label: string; homeVal: string; awayVal: string }> = [];

    for (const key of priorityOrder) {
      const h = homeStats.find((s) => s.name === key);
      if (h) {
        seen.add(key);
        rows.push({
          key,
          label: h.label || key,
          homeVal: h.value,
          awayVal: awayMap.get(key) ?? '0',
        });
      }
    }
    for (const h of homeStats) {
      if (!seen.has(h.name) && rows.length < 10) {
        rows.push({
          key: h.name,
          label: h.label || h.name,
          homeVal: h.value,
          awayVal: awayMap.get(h.name) ?? '0',
        });
      }
    }
    return rows;
  }, [matchDetail]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-1.5 sm:p-4 select-none"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#111b21] border border-slate-200 dark:border-[#2f3b43] shadow-2xl rounded-2xl sm:rounded-3xl w-full max-w-6xl h-[94vh] max-h-[880px] flex flex-col overflow-hidden"
          >
            {/* Top Bar */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-slate-200 dark:border-[#2f3b43] bg-slate-50 dark:bg-[#182229] shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                {mobileShowDetail && (
                  <button
                    type="button"
                    onClick={() => setMobileShowDetail(false)}
                    className="lg:hidden min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-[#222c33] cursor-pointer"
                    aria-label="Back to match list"
                  >
                    <ChevronLeft size={20} />
                  </button>
                )}
                <div className="w-9 h-9 rounded-xl bg-[#075E54]/10 dark:bg-[#00FF88]/10 text-[#075E54] dark:text-[#00FF88] flex items-center justify-center shrink-0">
                  <Trophy size={18} />
                </div>
                <div className="min-w-0">
                  <h2 className="font-bold text-base sm:text-lg text-slate-900 dark:text-white truncate">
                    Football Live Score & Standings
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-[#8696a0] flex items-center gap-1.5 truncate">
                    <span>Europe</span>
                    <span aria-hidden="true">·</span>
                    <span>Africa</span>
                    {updatedLabel && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">Updated {updatedLabel}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={openStandingsView}
                  className="min-h-[38px] px-3 rounded-xl bg-[#075E54]/10 dark:bg-[#00FF88]/10 text-[#075E54] dark:text-[#00FF88] hover:bg-[#075E54]/20 text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <ListOrdered size={15} />
                  <span className="hidden sm:inline">Championship Table</span>
                </button>
                <button
                  type="button"
                  onClick={() => loadScores(true, false)}
                  disabled={loading}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-[#222c33] transition-colors cursor-pointer"
                  aria-label="Refresh live scores"
                  title="Refresh"
                >
                  <RefreshCw size={18} className={loading ? 'animate-spin text-[#00a884]' : ''} />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-[#222c33] transition-colors cursor-pointer"
                  aria-label="Close Live Score"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[430px_1fr]">
              {/* LEFT PANE: Filters + Match List */}
              <div
                className={`flex flex-col min-h-0 border-r border-slate-200 dark:border-[#2f3b43] ${
                  mobileShowDetail ? 'hidden lg:flex' : 'flex'
                }`}
              >
                {/* Filter Toolbar */}
                <div className="px-3.5 sm:px-4 py-3 border-b border-slate-200 dark:border-[#2f3b43] bg-white dark:bg-[#111b21] space-y-2.5 shrink-0">
                  {/* Region + Day Row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="grid grid-cols-3 p-1 rounded-xl bg-slate-100 dark:bg-[#182229] gap-1 flex-1">
                      {[
                        { key: 'all' as const, label: 'Byose' },
                        { key: 'europe' as const, label: 'Europe' },
                        { key: 'africa' as const, label: 'Africa' },
                      ].map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => {
                            setRegionFilter(tab.key);
                            setLeagueFilter('all');
                          }}
                          className={`min-h-[38px] px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            regionFilter === tab.key
                              ? 'bg-white dark:bg-[#202c33] text-[#075E54] dark:text-[#00FF88] shadow-xs'
                              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    <select
                      value={dayFilter}
                      onChange={(e) => setDayFilter(e.target.value as DayFilter)}
                      className="min-h-[44px] bg-slate-100 dark:bg-[#182229] text-slate-800 dark:text-[#e9edef] px-2.5 rounded-xl text-xs font-semibold border border-transparent focus:border-[#00a884] focus:outline-none cursor-pointer"
                      aria-label="Filter by day"
                    >
                      <option value="all">Iminsi yose</option>
                      <option value="today">Today</option>
                      <option value="yesterday">Yesterday</option>
                      <option value="tomorrow">Tomorrow</option>
                    </select>
                  </div>

                  {/* Search + League */}
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Shaka ikipe cyangwa shampiyona..."
                        className="w-full min-h-[42px] bg-slate-100 dark:bg-[#182229] text-slate-900 dark:text-[#e9edef] pl-8 pr-8 rounded-xl text-xs border border-transparent focus:border-[#00a884] focus:outline-none placeholder:text-slate-400"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
                          aria-label="Clear search"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>

                    {availableLeagues.length > 1 && (
                      <select
                        value={leagueFilter}
                        onChange={(e) => setLeagueFilter(e.target.value)}
                        className="min-h-[42px] max-w-[140px] bg-slate-100 dark:bg-[#182229] text-slate-800 dark:text-[#e9edef] px-2.5 rounded-xl text-xs font-medium border border-transparent focus:border-[#00a884] focus:outline-none truncate cursor-pointer"
                        aria-label="Filter by competition"
                      >
                        <option value="all">Leagues ({availableLeagues.length})</option>
                        {availableLeagues.map((lg) => (
                          <option key={lg.slug} value={lg.slug}>
                            {lg.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Status & Favourites Tabs */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                    {[
                      { key: 'all' as const, label: 'Zose', count: counts.all },
                      { key: 'favourites' as const, label: '⭐ Favourites', count: counts.favourites },
                      { key: 'in' as const, label: 'Live', count: counts.live },
                      { key: 'pre' as const, label: 'Upcoming', count: counts.upcoming },
                      { key: 'post' as const, label: 'Finished', count: counts.finished },
                    ].map((tab) => {
                      const active = statusFilter === tab.key;
                      const isLiveTab = tab.key === 'in';
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setStatusFilter(tab.key)}
                          className={`min-h-[38px] px-3 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer border ${
                            active
                              ? 'bg-[#075E54] text-white border-[#075E54] dark:bg-[#00a884] dark:border-[#00a884] dark:text-[#0b141a]'
                              : 'bg-slate-50 dark:bg-[#182229] text-slate-700 dark:text-slate-300 border-slate-200 dark:border-[#2f3b43] hover:bg-slate-100 dark:hover:bg-[#202c33]'
                          }`}
                        >
                          {isLiveTab && counts.live > 0 && (
                            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />
                          )}
                          <span>{tab.label}</span>
                          <span
                            className={`font-mono tabular-nums text-[11px] ${
                              active ? 'opacity-90' : 'text-slate-400'
                            }`}
                          >
                            {tab.count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Match List Scroll Area */}
                <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-4 bg-slate-50/70 dark:bg-[#0b141a]">
                  {loading && matches.length === 0 ? (
                    <div className="space-y-2.5">
                      {Array.from({ length: 6 }).map((_, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 rounded-2xl bg-white dark:bg-[#182229] border border-slate-200 dark:border-[#2f3b43] animate-pulse space-y-2.5"
                        >
                          <div className="h-3 w-28 bg-slate-200 dark:bg-[#2a3942] rounded" />
                          <div className="flex items-center justify-between">
                            <div className="h-4 w-40 bg-slate-200 dark:bg-[#2a3942] rounded" />
                            <div className="h-4 w-6 bg-slate-200 dark:bg-[#2a3942] rounded" />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="h-4 w-36 bg-slate-200 dark:bg-[#2a3942] rounded" />
                            <div className="h-4 w-6 bg-slate-200 dark:bg-[#2a3942] rounded" />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : error && matches.length === 0 ? (
                    <div className="py-14 text-center max-w-xs mx-auto space-y-3">
                      <AlertCircle size={30} className="mx-auto text-red-500" />
                      <p className="text-sm font-semibold text-slate-800 dark:text-white">{error}</p>
                      <button
                        type="button"
                        onClick={() => loadScores(true, false)}
                        className="min-h-[44px] px-5 rounded-xl bg-[#075E54] hover:bg-[#064e46] text-white text-xs font-bold cursor-pointer"
                      >
                        Ongera ugerageze
                      </button>
                    </div>
                  ) : groupedByLeague.length === 0 ? (
                    <div className="py-14 text-center max-w-xs mx-auto space-y-3">
                      <Trophy size={30} className="mx-auto text-slate-400" />
                      <p className="text-sm font-semibold text-slate-800 dark:text-white">
                        {statusFilter === 'favourites'
                          ? 'Nta mikino cyangwa amakipe yashyizwe muri Favourites zanyu.'
                          : statusFilter === 'in'
                            ? 'Nta mukino uri Live ubu ngubu muri iki cyiciro.'
                            : 'Nta mikino ibonetse kuri iri shakashaka.'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-[#8696a0]">
                        Kanda kuri icon ya star (⭐) ku mikino cyangwa amakipe kugira ngo uyashyire muri Favourites.
                      </p>
                      {(statusFilter !== 'all' ||
                        regionFilter !== 'all' ||
                        dayFilter !== 'all' ||
                        leagueFilter !== 'all' ||
                        searchQuery) && (
                        <button
                          type="button"
                          onClick={() => {
                            setRegionFilter('all');
                            setStatusFilter('all');
                            setDayFilter('all');
                            setLeagueFilter('all');
                            setSearchQuery('');
                          }}
                          className="min-h-[44px] px-5 rounded-xl bg-[#075E54] hover:bg-[#064e46] dark:bg-[#00a884] dark:text-[#0b141a] text-white text-xs font-bold cursor-pointer"
                        >
                          Erekana imikino yose
                        </button>
                      )}
                    </div>
                  ) : (
                    groupedByLeague.map((group) => (
                      <section key={group.leagueSlug} className="space-y-1.5">
                        {/* Competition Heading */}
                        <div className="flex items-center justify-between gap-2 px-1 py-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              setStatusFilter('standings');
                              setRightPanel({ kind: 'standings', leagueSlug: group.leagueSlug });
                              setMobileShowDetail(true);
                            }}
                            className="flex items-center gap-2 min-w-0 text-left group cursor-pointer"
                            title="Reba urutonde rwa shampiyona"
                          >
                            <LeagueCrest name={group.leagueName} logo={group.leagueLogo} />
                            <h3 className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:underline group-hover:text-[#075E54] dark:group-hover:text-[#00FF88]">
                              {group.leagueName}
                            </h3>
                            <span className="text-[11px] text-slate-500 dark:text-[#8696a0] whitespace-nowrap shrink-0">
                              · {group.countryLabel} (Standings 📊)
                            </span>
                          </button>
                          <span className="text-[11px] text-slate-400 dark:text-[#8696a0] font-mono tabular-nums shrink-0">
                            {group.items.length}
                          </span>
                        </div>

                        {/* Matches List */}
                        <div className="bg-white dark:bg-[#182229] border border-slate-200 dark:border-[#2f3b43] rounded-2xl divide-y divide-slate-100 dark:divide-[#27343c] overflow-hidden">
                          {group.items.map((match) => {
                            const isLive = match.statusState === 'in';
                            const isPost = match.statusState === 'post';
                            const isSelected =
                              rightPanel?.kind === 'match' && rightPanel.match.id === match.id;
                            const isFavMatch = favorites.matches.includes(match.id);
                            const homeWon =
                              isPost &&
                              match.homeTeam.score !== null &&
                              match.awayTeam.score !== null &&
                              match.homeTeam.score > match.awayTeam.score;
                            const awayWon =
                              isPost &&
                              match.homeTeam.score !== null &&
                              match.awayTeam.score !== null &&
                              match.awayTeam.score > match.homeTeam.score;

                            return (
                              <div
                                key={match.id}
                                onClick={() => openMatchDetail(match)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    openMatchDetail(match);
                                  }
                                }}
                                className={`px-3.5 py-2.5 flex items-center gap-2.5 cursor-pointer transition-colors min-h-[60px] ${
                                  isSelected
                                    ? 'bg-[#075E54]/8 dark:bg-[#202c33]'
                                    : 'hover:bg-slate-50 dark:hover:bg-[#1e2a32]'
                                }`}
                              >
                                {/* Match Favorite Star Button */}
                                <button
                                  type="button"
                                  onClick={(e) => toggleFavoriteMatch(match.id, e)}
                                  className="p-1 text-slate-300 dark:text-slate-600 hover:text-amber-500 transition-colors shrink-0 cursor-pointer"
                                  title={isFavMatch ? 'Remove from Favourites' : 'Add to Favourites'}
                                >
                                  <Star
                                    size={15}
                                    className={
                                      isFavMatch
                                        ? 'fill-amber-400 text-amber-500'
                                        : ''
                                    }
                                  />
                                </button>

                                {/* Time / Status Column */}
                                <div className="w-12 shrink-0 text-center">
                                  {isLive ? (
                                    <div className="flex flex-col items-center">
                                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse mb-0.5" />
                                      <span className="text-[11px] font-bold text-red-600 dark:text-red-400 font-mono tabular-nums leading-tight">
                                        {match.clock || match.statusDetail}
                                      </span>
                                    </div>
                                  ) : isPost ? (
                                    <span className="text-[11px] font-semibold text-slate-400 dark:text-[#8696a0] font-mono tabular-nums">
                                      {match.statusDetail || 'FT'}
                                    </span>
                                  ) : (
                                    <span className="text-[11px] font-semibold text-[#075E54] dark:text-[#00FF88] font-mono tabular-nums">
                                      {formatShortTimeOnly(match.dateIso)}
                                    </span>
                                  )}
                                </div>

                                {/* Teams Column */}
                                <div className="flex-1 min-w-0 space-y-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openTeamProfile(
                                          match.leagueSlug,
                                          match.homeTeam,
                                          match.leagueName,
                                          match
                                        );
                                      }}
                                      title={`Reba amakuru ya ${match.homeTeam.name}`}
                                      className="flex items-center gap-2 min-w-0 text-left group cursor-pointer"
                                    >
                                      <TeamCrest
                                        name={match.homeTeam.name}
                                        shortName={match.homeTeam.shortName}
                                        logo={match.homeTeam.logo}
                                        size="sm"
                                      />
                                      <span
                                        className={`text-xs sm:text-[13px] truncate group-hover:underline group-hover:text-[#075E54] dark:group-hover:text-[#00FF88] ${
                                          homeWon || isLive
                                            ? 'font-bold text-slate-900 dark:text-white'
                                            : 'font-medium text-slate-700 dark:text-slate-200'
                                        }`}
                                      >
                                        {match.homeTeam.name}
                                      </span>
                                    </button>
                                    <span
                                      className={`text-xs sm:text-sm font-mono tabular-nums shrink-0 w-5 text-right ${
                                        isLive
                                          ? 'font-extrabold text-red-600 dark:text-red-400'
                                          : homeWon
                                            ? 'font-extrabold text-slate-900 dark:text-white'
                                            : 'font-semibold text-slate-500 dark:text-slate-400'
                                      }`}
                                    >
                                      {match.homeTeam.score !== null ? match.homeTeam.score : '–'}
                                    </span>
                                  </div>

                                  <div className="flex items-center justify-between gap-2">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openTeamProfile(
                                          match.leagueSlug,
                                          match.awayTeam,
                                          match.leagueName,
                                          match
                                        );
                                      }}
                                      title={`Reba amakuru ya ${match.awayTeam.name}`}
                                      className="flex items-center gap-2 min-w-0 text-left group cursor-pointer"
                                    >
                                      <TeamCrest
                                        name={match.awayTeam.name}
                                        shortName={match.awayTeam.shortName}
                                        logo={match.awayTeam.logo}
                                        size="sm"
                                      />
                                      <span
                                        className={`text-xs sm:text-[13px] truncate group-hover:underline group-hover:text-[#075E54] dark:group-hover:text-[#00FF88] ${
                                          awayWon || isLive
                                            ? 'font-bold text-slate-900 dark:text-white'
                                            : 'font-medium text-slate-700 dark:text-slate-200'
                                        }`}
                                      >
                                        {match.awayTeam.name}
                                      </span>
                                    </button>
                                    <span
                                      className={`text-xs sm:text-sm font-mono tabular-nums shrink-0 w-5 text-right ${
                                        isLive
                                          ? 'font-extrabold text-red-600 dark:text-red-400'
                                          : awayWon
                                            ? 'font-extrabold text-slate-900 dark:text-white'
                                            : 'font-semibold text-slate-500 dark:text-slate-400'
                                      }`}
                                    >
                                      {match.awayTeam.score !== null ? match.awayTeam.score : '–'}
                                    </span>
                                  </div>
                                </div>

                                <ChevronRight size={14} className="text-slate-400 shrink-0" />
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))
                  )}
                </div>
              </div>

              {/* RIGHT PANE: Standings OR Team Profile OR Match Detail */}
              <div
                className={`flex flex-col min-h-0 bg-white dark:bg-[#111b21] ${
                  mobileShowDetail ? 'flex' : 'hidden lg:flex'
                }`}
              >
                {!rightPanel ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-2">
                    <Trophy size={36} className="text-slate-300 dark:text-slate-600" />
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Hitamo umukino cyangwa urutonde rwa shampiyona
                    </p>
                    <p className="text-xs text-slate-500 dark:text-[#8696a0] max-w-sm">
                      Reba Lineups zuzuye (Starting XI, Substitutes, Coach, Injured), Standings table, n’amakuru y’ikipe.
                    </p>
                  </div>
                ) : rightPanel.kind === 'standings' ? (
                  /* ================= STANDINGS TABLE VIEW ================= */
                  (() => {
                    const curStandingsSlug = rightPanel.leagueSlug || (leagueFilter !== 'all' ? leagueFilter : 'eng.1');
                    const curRows = leagueStandings[curStandingsSlug] || matchDetail?.standings || [];
                    const curLeagueObj = availableLeagues.find((l) => l.slug === curStandingsSlug) || {
                      slug: curStandingsSlug,
                      name: curStandingsSlug.toUpperCase(),
                    };

                    return (
                      <div className="flex-1 min-h-0 flex flex-col">
                        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-[#2f3b43] bg-slate-50/70 dark:bg-[#182229] flex items-center justify-between gap-2 shrink-0">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-xl bg-[#075E54]/10 dark:bg-[#00FF88]/10 text-[#075E54] dark:text-[#00FF88] flex items-center justify-center shrink-0">
                              <ListOrdered size={18} />
                            </div>
                            <div className="min-w-0">
                              <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                                {curLeagueObj.name} Standings
                              </h3>
                              <p className="text-[11px] text-slate-500 dark:text-[#8696a0] truncate">
                                Championship table · Updated in real time
                              </p>
                            </div>
                          </div>
                          <select
                            value={curStandingsSlug}
                            onChange={(e) => {
                              const slug = e.target.value;
                              setLeagueFilter(slug);
                              setRightPanel({ kind: 'standings', leagueSlug: slug });
                            }}
                            className="min-h-[38px] max-w-[200px] bg-white dark:bg-[#202c33] text-slate-800 dark:text-[#e9edef] px-3 rounded-xl text-xs font-bold border border-slate-200 dark:border-[#2f3b43] cursor-pointer truncate shadow-xs"
                          >
                            {availableLeagues.map((lg) => (
                              <option key={lg.slug} value={lg.slug}>
                                {lg.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-5 space-y-4">
                          {standingsLoading && curRows.length === 0 ? (
                            <div className="space-y-2.5">
                              {Array.from({ length: 12 }).map((_, i) => (
                                <div key={i} className="h-10 rounded-xl bg-slate-100 dark:bg-[#182229] animate-pulse" />
                              ))}
                            </div>
                          ) : curRows.length > 0 ? (
                            <div className="border border-slate-200 dark:border-[#2f3b43] rounded-2xl overflow-hidden shadow-xs bg-white dark:bg-[#182229]">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-50 dark:bg-[#151e24] text-slate-500 dark:text-[#8696a0] border-b border-slate-200 dark:border-[#2f3b43]">
                                  <tr>
                                    <th className="py-2.5 px-3 text-left font-semibold w-10">#</th>
                                    <th className="py-2.5 px-3 text-left font-semibold">Team</th>
                                    <th className="py-2.5 px-2 text-right font-semibold">P</th>
                                    <th className="py-2.5 px-2 text-right font-semibold hidden md:table-cell">W</th>
                                    <th className="py-2.5 px-2 text-right font-semibold hidden md:table-cell">D</th>
                                    <th className="py-2.5 px-2 text-right font-semibold hidden md:table-cell">L</th>
                                    <th className="py-2.5 px-2 text-right font-semibold hidden sm:table-cell">GF:GA</th>
                                    <th className="py-2.5 px-2 text-right font-semibold">GD</th>
                                    <th className="py-2.5 px-3 text-right font-semibold">Pts</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-[#27343c]">
                                  {curRows.map((row, idx) => {
                                    const isFav = favorites.teams.includes(row.teamId);
                                    const isUCL = idx < 4;
                                    const isUEL = idx >= 4 && idx < 6;
                                    const isRel = idx >= curRows.length - 3 && curRows.length > 10;

                                    return (
                                      <tr
                                        key={`${row.rank}-${row.teamName}-${idx}`}
                                        onClick={() => {
                                          if (row.teamId) {
                                            openTeamProfile(curStandingsSlug, {
                                              id: row.teamId,
                                              name: row.teamName,
                                              shortName: row.teamName.slice(0, 3),
                                              logo: row.teamLogo,
                                              score: null,
                                            }, curLeagueObj.name);
                                          }
                                        }}
                                        className={`hover:bg-slate-50/80 dark:hover:bg-[#202c33]/70 transition-colors cursor-pointer group ${
                                          isFav ? 'bg-amber-500/5' : ''
                                        }`}
                                      >
                                        <td className="py-3 px-3 font-mono tabular-nums font-bold text-slate-700 dark:text-slate-300">
                                          <div className="flex items-center gap-1.5">
                                            <span
                                              className={`w-1.5 h-4 rounded-full shrink-0 ${
                                                isUCL
                                                  ? 'bg-blue-500'
                                                  : isUEL
                                                    ? 'bg-amber-500'
                                                    : isRel
                                                      ? 'bg-red-500'
                                                      : 'bg-transparent'
                                              }`}
                                            />
                                            <span>{row.rank}</span>
                                          </div>
                                        </td>
                                        <td className="py-3 px-3">
                                          <div className="flex items-center gap-2.5 min-w-0">
                                            <button
                                              type="button"
                                              onClick={(e) => toggleFavoriteTeam(row.teamId, e)}
                                              className="text-slate-300 dark:text-slate-600 hover:text-amber-500 transition-colors shrink-0 cursor-pointer p-0.5"
                                              title={isFav ? 'Remove Favorite' : 'Add to Favorites'}
                                            >
                                              <Star
                                                size={13}
                                                className={isFav ? 'fill-amber-400 text-amber-500' : ''}
                                              />
                                            </button>
                                            <TeamCrest
                                              name={row.teamName}
                                              shortName={row.teamName.slice(0, 3)}
                                              logo={row.teamLogo}
                                              size="sm"
                                            />
                                            <span className="font-semibold text-slate-900 dark:text-white truncate group-hover:text-[#075E54] dark:group-hover:text-[#00FF88]">
                                              {row.teamName}
                                            </span>
                                          </div>
                                        </td>
                                        <td className="py-3 px-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                                          {row.played}
                                        </td>
                                        <td className="py-3 px-2 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400 hidden md:table-cell">
                                          {row.wins}
                                        </td>
                                        <td className="py-3 px-2 text-right font-mono tabular-nums text-slate-400 hidden md:table-cell">
                                          {row.draws}
                                        </td>
                                        <td className="py-3 px-2 text-right font-mono tabular-nums text-red-500 hidden md:table-cell">
                                          {row.losses}
                                        </td>
                                        <td className="py-3 px-2 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 hidden sm:table-cell">
                                          {row.goalsFor}:{row.goalsAgainst}
                                        </td>
                                        <td
                                          className={`py-3 px-2 text-right font-mono tabular-nums font-semibold ${
                                            Number(row.goalDiff) > 0
                                              ? 'text-emerald-600 dark:text-emerald-400'
                                              : Number(row.goalDiff) < 0
                                                ? 'text-red-500'
                                                : 'text-slate-400'
                                          }`}
                                        >
                                          {Number(row.goalDiff) > 0 ? `+${row.goalDiff}` : row.goalDiff}
                                        </td>
                                        <td className="py-3 px-3 text-right font-mono tabular-nums font-black text-slate-900 dark:text-white text-sm">
                                          {row.points}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>

                              <div className="p-3 bg-slate-50/70 dark:bg-[#151e24] border-t border-slate-200 dark:border-[#2f3b43] flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500 dark:text-[#8696a0]">
                                <span className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                                  <span>Champions League / Top spots</span>
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                                  <span>Europa / Continental Cup</span>
                                </span>
                                <span className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-red-500" />
                                  <span>Relegation</span>
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="py-14 text-center max-w-sm mx-auto space-y-2">
                              <Trophy size={32} className="mx-auto text-slate-400" />
                              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                                Urutonde rwa {curLeagueObj.name} ntabwo rubonetse ubu.
                              </p>
                              <p className="text-xs text-slate-500">
                                Hitamo indi shampiyona cyangwa ukande Refresh kugira ngo wongere ugerageze.
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()
                ) : rightPanel.kind === 'team' ? (
                  /* ================= FULL TEAM PROFILE VIEW ================= */
                  <div className="flex-1 min-h-0 flex flex-col">
                    <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-[#2f3b43] bg-slate-50/70 dark:bg-[#182229] space-y-3 shrink-0">
                      <div className="flex items-center justify-between gap-2">
                        {rightPanel.returnMatch ? (
                          <button
                            type="button"
                            onClick={() => {
                              setRightPanel({ kind: 'match', match: rightPanel.returnMatch! });
                            }}
                            className="min-h-[36px] px-2.5 -ml-2 rounded-lg text-xs font-semibold text-[#075E54] dark:text-[#00FF88] hover:bg-slate-200/60 dark:hover:bg-[#222c33] flex items-center gap-1 cursor-pointer"
                          >
                            <ChevronLeft size={15} />
                            <span>Subira ku mukino</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500 dark:text-[#8696a0]">
                            Amakuru y’Ikipe
                          </span>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => toggleFavoriteTeam(rightPanel.team.id, e)}
                            className="min-h-[36px] px-3 rounded-xl bg-slate-200/70 dark:bg-[#202c33] text-xs font-semibold flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-200 hover:bg-amber-500/20"
                          >
                            <Star
                              size={15}
                              className={
                                favorites.teams.includes(rightPanel.team.id)
                                  ? 'fill-amber-400 text-amber-500'
                                  : ''
                              }
                            />
                            <span>{favorites.teams.includes(rightPanel.team.id) ? 'Favorite' : 'Add Favourite'}</span>
                          </button>

                          <span className="text-xs text-slate-500 dark:text-[#8696a0] truncate">
                            {teamProfile?.team.leagueName || rightPanel.leagueName || rightPanel.leagueSlug}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-4">
                        <TeamCrest
                          name={teamProfile?.team.name || rightPanel.team.name}
                          shortName={teamProfile?.team.shortName || rightPanel.team.shortName}
                          logo={teamProfile?.team.logo || rightPanel.team.logo}
                          size="lg"
                        />
                        <div className="min-w-0 flex-1">
                          <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white truncate">
                            {teamProfile?.team.name || rightPanel.team.name}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-[#8696a0] flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                            {teamProfile?.team.standingSummary && (
                              <span className="font-semibold text-[#075E54] dark:text-[#00FF88]">
                                {teamProfile.team.standingSummary}
                              </span>
                            )}
                            {teamProfile?.team.coach && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>Umutoza: {teamProfile.team.coach}</span>
                              </>
                            )}
                            {teamProfile?.team.venue && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{teamProfile.team.venue}</span>
                              </>
                            )}
                          </p>
                        </div>
                      </div>

                      {/* Team Tabs */}
                      <div className="flex items-center gap-1 pt-1">
                        {[
                          { key: 'overview' as const, label: 'Incamake & Imibare', icon: BarChart3 },
                          { key: 'matches' as const, label: 'Imikino', icon: Calendar },
                          { key: 'squad' as const, label: `Abakinnyi (${teamProfile?.roster.length || 0})`, icon: Users },
                        ].map((t) => {
                          const Icon = t.icon;
                          const active = teamTab === t.key;
                          return (
                            <button
                              key={t.key}
                              type="button"
                              onClick={() => setTeamTab(t.key)}
                              className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                                active
                                  ? 'bg-[#075E54] text-white dark:bg-[#00a884] dark:text-[#0b141a]'
                                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-[#222c33]'
                              }`}
                            >
                              <Icon size={14} />
                              <span>{t.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Team Content */}
                    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5">
                      {teamLoading ? (
                        <div className="space-y-3">
                          <div className="h-24 rounded-2xl bg-slate-100 dark:bg-[#182229] animate-pulse" />
                          <div className="h-40 rounded-2xl bg-slate-100 dark:bg-[#182229] animate-pulse" />
                        </div>
                      ) : !teamProfile ? (
                        <div className="py-12 text-center space-y-2">
                          <Shield size={32} className="mx-auto text-slate-400" />
                          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                            Amakuru arambuye y’iyi kipe ntabwo abonetse ubu.
                          </p>
                        </div>
                      ) : teamTab === 'overview' ? (
                        <div className="space-y-5">
                          {teamProfile.team.nextEvent && (
                            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#182229] border border-slate-200 dark:border-[#2f3b43] space-y-1">
                              <p className="text-[11px] font-semibold text-[#075E54] dark:text-[#00FF88]">
                                Umukino ukurikira
                              </p>
                              <p className="text-sm font-bold text-slate-900 dark:text-white">
                                {teamProfile.team.nextEvent.name}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-[#8696a0] font-mono tabular-nums">
                                {formatKickoffTime(teamProfile.team.nextEvent.dateIso)}
                                {teamProfile.team.nextEvent.venue
                                  ? ` · ${teamProfile.team.nextEvent.venue}`
                                  : ''}
                              </p>
                            </div>
                          )}

                          <div className="space-y-2">
                            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                              Imibare y’uyu mwaka (Season Record)
                            </h4>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                              {[
                                { label: 'Amanota (PTS)', val: teamProfile.team.stats.points },
                                { label: 'Imikino (GP)', val: teamProfile.team.stats.gamesPlayed },
                                {
                                  label: 'W - D - L',
                                  val: `${teamProfile.team.stats.wins}-${teamProfile.team.stats.draws}-${teamProfile.team.stats.losses}`,
                                },
                                {
                                  label: 'Ibitego (GF / GA)',
                                  val: `${teamProfile.team.stats.goalsFor} / ${teamProfile.team.stats.goalsAgainst}`,
                                },
                                { label: 'Ikinyuranyo (GD)', val: teamProfile.team.stats.goalDiff },
                                { label: 'Mu rugo (Home)', val: teamProfile.team.stats.homeRecord },
                                { label: 'Hanze (Away)', val: teamProfile.team.stats.awayRecord },
                                { label: 'Incamake', val: teamProfile.team.recordSummary || '–' },
                              ].map((box) => (
                                <div
                                  key={box.label}
                                  className="p-3 rounded-xl bg-slate-50 dark:bg-[#182229] border border-slate-200/80 dark:border-[#2f3b43]"
                                >
                                  <p className="text-[11px] text-slate-500 dark:text-[#8696a0]">
                                    {box.label}
                                  </p>
                                  <p className="text-base font-bold text-slate-900 dark:text-white font-mono tabular-nums mt-0.5">
                                    {box.val}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>

                          {teamProfile.standings.length > 0 && (
                            <div className="space-y-2">
                              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                Urutonde rwa {teamProfile.team.leagueName}
                              </h4>
                              <div className="border border-slate-200 dark:border-[#2f3b43] rounded-2xl overflow-hidden">
                                <table className="w-full text-xs">
                                  <thead className="bg-slate-50 dark:bg-[#182229] text-slate-500 dark:text-[#8696a0]">
                                    <tr>
                                      <th className="py-2 px-3 text-left font-semibold w-8">#</th>
                                      <th className="py-2 px-2 text-left font-semibold">Ikipe</th>
                                      <th className="py-2 px-2 text-right font-semibold">GP</th>
                                      <th className="py-2 px-2 text-right font-semibold">GD</th>
                                      <th className="py-2 px-3 text-right font-semibold">PTS</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-[#27343c]">
                                    {teamProfile.standings.slice(0, 20).map((row) => {
                                      const isTarget = row.teamId === teamProfile.team.id;
                                      return (
                                        <tr
                                          key={`${row.rank}-${row.teamName}`}
                                          onClick={() => {
                                            if (row.teamId && row.teamId !== teamProfile.team.id) {
                                              openTeamProfile(
                                                teamProfile.team.leagueSlug,
                                                {
                                                  id: row.teamId,
                                                  name: row.teamName,
                                                  shortName: row.teamName.slice(0, 3),
                                                  logo: row.teamLogo,
                                                  score: null,
                                                },
                                                teamProfile.team.leagueName,
                                                rightPanel.returnMatch
                                              );
                                            }
                                          }}
                                          className={`cursor-pointer transition-colors ${
                                            isTarget
                                              ? 'bg-[#075E54]/10 dark:bg-[#00a884]/15 font-bold'
                                              : 'hover:bg-slate-50 dark:hover:bg-[#182229]'
                                          }`}
                                        >
                                          <td className="py-2 px-3 font-mono tabular-nums text-slate-500 dark:text-[#8696a0]">
                                            {row.rank}
                                          </td>
                                          <td className="py-2 px-2">
                                            <div className="flex items-center gap-2 min-w-0">
                                              <TeamCrest
                                                name={row.teamName}
                                                shortName={row.teamName.slice(0, 3)}
                                                logo={row.teamLogo}
                                                size="sm"
                                              />
                                              <span className="truncate text-slate-900 dark:text-slate-100">
                                                {row.teamName}
                                              </span>
                                            </div>
                                          </td>
                                          <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                            {row.played}
                                          </td>
                                          <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                            {row.goalDiff}
                                          </td>
                                          <td className="py-2 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                                            {row.points}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          )}
                        </div>
                      ) : teamTab === 'matches' ? (
                        <div className="space-y-2">
                          {teamProfile.schedule.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-[#8696a0]">
                              Nta mikino y’iyi kipe ibonetse kuri gahunda ubu.
                            </p>
                          ) : (
                            <div className="border border-slate-200 dark:border-[#2f3b43] rounded-2xl divide-y divide-slate-100 dark:divide-[#27343c] overflow-hidden">
                              {teamProfile.schedule.map((ev) => (
                                <button
                                  key={ev.id}
                                  type="button"
                                  onClick={() => {
                                    openMatchDetail({
                                      id: ev.id,
                                      eventId: ev.eventId,
                                      leagueSlug: ev.leagueSlug,
                                      leagueName: ev.competitionName,
                                      region: 'europe',
                                      countryLabel: '',
                                      dateIso: ev.dateIso,
                                      statusState: ev.statusState,
                                      statusDetail: ev.statusDetail,
                                      venue: ev.venue,
                                      homeTeam: ev.homeTeam,
                                      awayTeam: ev.awayTeam,
                                      events: [],
                                    });
                                  }}
                                  className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-[#182229] flex items-center justify-between gap-3 cursor-pointer"
                                >
                                  <div className="min-w-0 flex-1 space-y-1">
                                    <p className="text-[11px] text-slate-500 dark:text-[#8696a0] font-mono tabular-nums">
                                      {formatKickoffTime(ev.dateIso)} · {ev.statusDetail || ev.competitionName}
                                    </p>
                                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                                      <span className="truncate">{ev.homeTeam.name}</span>
                                      <span className="font-mono tabular-nums text-slate-500 dark:text-[#8696a0] shrink-0">
                                        {ev.homeTeam.score !== null && ev.awayTeam.score !== null
                                          ? `${ev.homeTeam.score} - ${ev.awayTeam.score}`
                                          : 'vs'}
                                      </span>
                                      <span className="truncate">{ev.awayTeam.name}</span>
                                    </div>
                                  </div>
                                  <ChevronRight size={14} className="text-slate-400 shrink-0" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {teamProfile.roster.length === 0 ? (
                            <p className="text-xs text-slate-500 dark:text-[#8696a0]">
                              Urutonde rw’abakinnyi ntirubonetse kuri iyi shampiyona.
                            </p>
                          ) : (
                            <div className="border border-slate-200 dark:border-[#2f3b43] rounded-2xl overflow-hidden">
                              <table className="w-full text-xs">
                                <thead className="bg-slate-50 dark:bg-[#182229] text-slate-500 dark:text-[#8696a0]">
                                  <tr>
                                    <th className="py-2 px-3 text-left font-semibold w-10">#</th>
                                    <th className="py-2 px-2 text-left font-semibold">Umukinnyi</th>
                                    <th className="py-2 px-2 text-left font-semibold hidden sm:table-cell">Umwanya</th>
                                    <th className="py-2 px-2 text-right font-semibold">APP</th>
                                    <th className="py-2 px-2 text-right font-semibold">G</th>
                                    <th className="py-2 px-3 text-right font-semibold">A</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-[#27343c]">
                                  {teamProfile.roster.map((p) => (
                                    <tr key={p.id || p.name} className="hover:bg-slate-50/70 dark:hover:bg-[#182229]/70">
                                      <td className="py-2.5 px-3 font-mono tabular-nums font-bold text-slate-500 dark:text-[#8696a0]">
                                        {p.jersey || '–'}
                                      </td>
                                      <td className="py-2.5 px-2">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <CountryFlag url={p.flagUrl} alt={p.nationality} />
                                          <div className="min-w-0">
                                            <p className="font-semibold text-slate-900 dark:text-white truncate">
                                              {p.name}
                                            </p>
                                            <p className="text-[11px] text-slate-500 dark:text-[#8696a0] truncate">
                                              {p.positionAbbr || p.position}
                                              {p.age ? ` · ${p.age} yrs` : ''}
                                              {p.nationality ? ` · ${p.nationality}` : ''}
                                            </p>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="py-2.5 px-2 hidden sm:table-cell text-slate-600 dark:text-slate-300">
                                        {p.position || '–'}
                                      </td>
                                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                                        {p.appearances}
                                      </td>
                                      <td className="py-2.5 px-2 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                                        {p.goals}
                                      </td>
                                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-200">
                                        {p.assists}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* ================= MATCH DETAIL VIEW ================= */
                  (() => {
                    const match = rightPanel.match;
                    const isLive = match.statusState === 'in';
                    const isPost = match.statusState === 'post';
                    const isFavMatch = favorites.matches.includes(match.id);

                    return (
                      <div className="flex-1 min-h-0 flex flex-col">
                        {/* Match Detail Header */}
                        <div className="px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-[#2f3b43] bg-slate-50/70 dark:bg-[#182229] space-y-4 shrink-0">
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-[#8696a0]">
                            <span className="truncate font-semibold text-slate-700 dark:text-slate-200">
                              {match.countryLabel ? `${match.countryLabel} · ` : ''}
                              {match.leagueName}
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => toggleFavoriteMatch(match.id, e)}
                                className="min-h-[32px] px-2.5 rounded-lg bg-slate-200/70 dark:bg-[#202c33] text-xs font-semibold flex items-center gap-1 cursor-pointer text-slate-700 dark:text-slate-200"
                              >
                                <Star
                                  size={13}
                                  className={isFavMatch ? 'fill-amber-400 text-amber-500' : ''}
                                />
                                <span>{isFavMatch ? 'Favourite' : 'Star Match'}</span>
                              </button>
                              <span className="text-[11px] shrink-0 hidden sm:inline">
                                Kanda kw’ikipe urebe amakuru
                              </span>
                            </div>
                          </div>

                          {/* Scoreboard Banner */}
                          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                            <button
                              type="button"
                              onClick={() =>
                                openTeamProfile(match.leagueSlug, match.homeTeam, match.leagueName, match)
                              }
                              className="flex flex-col items-center text-center gap-2 p-2 rounded-2xl hover:bg-slate-200/60 dark:hover:bg-[#222c33] transition-colors cursor-pointer group"
                            >
                              <TeamCrest
                                name={match.homeTeam.name}
                                shortName={match.homeTeam.shortName}
                                logo={match.homeTeam.logo}
                                size="lg"
                              />
                              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white group-hover:underline group-hover:text-[#075E54] dark:group-hover:text-[#00FF88] line-clamp-2">
                                {match.homeTeam.name}
                              </span>
                            </button>

                            <div className="text-center space-y-1 px-2">
                              {match.homeTeam.score !== null && match.awayTeam.score !== null ? (
                                <div
                                  className={`text-2xl sm:text-3xl font-extrabold font-mono tabular-nums tracking-tight ${
                                    isLive ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'
                                  }`}
                                >
                                  {match.homeTeam.score} : {match.awayTeam.score}
                                </div>
                              ) : (
                                <div className="text-xl sm:text-2xl font-bold font-mono tabular-nums text-[#075E54] dark:text-[#00FF88]">
                                  {formatShortTimeOnly(match.dateIso)}
                                </div>
                              )}
                              <p
                                className={`text-xs font-semibold font-mono tabular-nums ${
                                  isLive
                                    ? 'text-red-600 dark:text-red-400'
                                    : isPost
                                      ? 'text-slate-500 dark:text-[#8696a0]'
                                      : 'text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                {isLive
                                  ? `LIVE · ${match.clock || match.statusDetail}`
                                  : isPost
                                    ? match.statusDetail || 'FT'
                                    : formatKickoffTime(match.dateIso)}
                              </p>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                openTeamProfile(match.leagueSlug, match.awayTeam, match.leagueName, match)
                              }
                              className="flex flex-col items-center text-center gap-2 p-2 rounded-2xl hover:bg-slate-200/60 dark:hover:bg-[#222c33] transition-colors cursor-pointer group"
                            >
                              <TeamCrest
                                name={match.awayTeam.name}
                                shortName={match.awayTeam.shortName}
                                logo={match.awayTeam.logo}
                                size="lg"
                              />
                              <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white group-hover:underline group-hover:text-[#075E54] dark:group-hover:text-[#00FF88] line-clamp-2">
                                {match.awayTeam.name}
                              </span>
                            </button>
                          </div>

                          {/* Match Sub-Tabs */}
                          <div className="flex items-center gap-1 pt-1 overflow-x-auto">
                            {[
                              { key: 'details' as const, label: 'Details', icon: Clock },
                              { key: 'lineups' as const, label: 'Lineups', icon: Users },
                              { key: 'stats' as const, label: 'Stats', icon: BarChart3 },
                              { key: 'standings' as const, label: 'Standings', icon: ListOrdered },
                            ].map((t) => {
                              const Icon = t.icon;
                              const active = matchTab === t.key;
                              return (
                                <button
                                  key={t.key}
                                  type="button"
                                  onClick={() => setMatchTab(t.key)}
                                  className={`min-h-[38px] px-3.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                                    active
                                      ? 'bg-[#075E54] text-white dark:bg-[#00a884] dark:text-[#0b141a]'
                                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-[#222c33]'
                                  }`}
                                >
                                  <Icon size={14} />
                                  <span>{t.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Match Detail Body */}
                        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5">
                          {matchTab === 'details' && (
                            <>
                              {(matchDetail?.venue || match.venue || matchDetail?.attendance || matchDetail?.referee) && (
                                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#182229] border border-slate-200 dark:border-[#2f3b43] flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                                  {(matchDetail?.venue || match.venue) && (
                                    <span className="flex items-center gap-1.5">
                                      <MapPin size={13} className="text-[#075E54] dark:text-[#00FF88] shrink-0" />
                                      <span>
                                        {matchDetail?.venue || match.venue}
                                        {matchDetail?.venueCity ? `, ${matchDetail.venueCity}` : ''}
                                      </span>
                                    </span>
                                  )}
                                  {matchDetail?.attendance && (
                                    <span className="font-mono tabular-nums">
                                      Attendance: {matchDetail.attendance.toLocaleString()}
                                    </span>
                                  )}
                                  {matchDetail?.referee && <span>Referee: {matchDetail.referee}</span>}
                                </div>
                              )}

                              {matchDetail?.odds && (
                                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#182229] border border-slate-200 dark:border-[#2f3b43] space-y-2">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-bold text-slate-800 dark:text-slate-200">
                                      Match Odds ({matchDetail.odds.provider})
                                    </span>
                                    {matchDetail.odds.overUnder !== undefined && (
                                      <span className="font-mono tabular-nums text-slate-500 dark:text-[#8696a0]">
                                        O/U {matchDetail.odds.overUnder}
                                      </span>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-3 gap-2 text-center text-xs font-mono tabular-nums">
                                    <div className="p-2 rounded-xl bg-white dark:bg-[#111b21] border border-slate-200 dark:border-[#2f3b43]">
                                      <span className="block text-[10px] text-slate-400">1 ({match.homeTeam.shortName})</span>
                                      <span className="font-bold text-slate-900 dark:text-white">
                                        {matchDetail.odds.homeMoneyLine ?? matchDetail.odds.details ?? '–'}
                                      </span>
                                    </div>
                                    <div className="p-2 rounded-xl bg-white dark:bg-[#111b21] border border-slate-200 dark:border-[#2f3b43]">
                                      <span className="block text-[10px] text-slate-400">X (Draw)</span>
                                      <span className="font-bold text-slate-900 dark:text-white">
                                        {matchDetail.odds.drawMoneyLine ?? '–'}
                                      </span>
                                    </div>
                                    <div className="p-2 rounded-xl bg-white dark:bg-[#111b21] border border-slate-200 dark:border-[#2f3b43]">
                                      <span className="block text-[10px] text-slate-400">2 ({match.awayTeam.shortName})</span>
                                      <span className="font-bold text-slate-900 dark:text-white">
                                        {matchDetail.odds.awayMoneyLine ?? '–'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}

                              <div className="space-y-2">
                                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                  Ibitego & Amakarita (Events)
                                </h4>
                                {match.events.length > 0 ? (
                                  <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#182229] border border-slate-200 dark:border-[#2f3b43] space-y-2">
                                    {match.events.map((ev, idx) => (
                                      <div
                                        key={`${ev.minute}-${ev.playerName}-${idx}`}
                                        className="flex items-center justify-between gap-2 text-xs text-slate-700 dark:text-slate-200"
                                      >
                                        <span className="truncate">
                                          {ev.type === 'goal'
                                            ? '⚽'
                                            : ev.type === 'penalty'
                                              ? '⚽ (P)'
                                              : ev.type === 'own_goal'
                                                ? '⚽ (OG)'
                                                : ev.type === 'red_card'
                                                  ? '🟥'
                                                  : '🟨'}{' '}
                                          <span className="font-semibold">{ev.playerName}</span>
                                          {ev.teamName ? (
                                            <span className="text-slate-400"> · {ev.teamName}</span>
                                          ) : null}
                                        </span>
                                        <span className="font-mono tabular-nums text-slate-500 dark:text-[#8696a0] shrink-0">
                                          {ev.minute || ''}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-xs text-slate-500 dark:text-[#8696a0]">
                                    {match.statusState === 'pre'
                                      ? 'Umukino ntutaratangira — ibitego birahita bigaragara nutangira.'
                                      : 'Nta bitego cyangwa amakarita byanditswe.'}
                                  </p>
                                )}
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                {[match.homeTeam, match.awayTeam].map((tm) => (
                                  <button
                                    key={tm.id}
                                    type="button"
                                    onClick={() =>
                                      openTeamProfile(match.leagueSlug, tm, match.leagueName, match)
                                    }
                                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#182229] border border-slate-200 dark:border-[#2f3b43] hover:border-[#075E54] dark:hover:border-[#00FF88] flex items-center justify-between gap-2 transition-colors cursor-pointer text-left"
                                  >
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      <TeamCrest
                                        name={tm.name}
                                        shortName={tm.shortName}
                                        logo={tm.logo}
                                        size="md"
                                      />
                                      <div className="min-w-0">
                                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                          {tm.name}
                                        </p>
                                        <p className="text-[11px] text-[#075E54] dark:text-[#00FF88]">
                                          Reba abakinnyi, imibare & imikino →
                                        </p>
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>

                              {matchDetailLoading ? (
                                <div className="h-28 rounded-2xl bg-slate-100 dark:bg-[#182229] animate-pulse" />
                              ) : (
                                matchDetail?.lastFiveGames &&
                                matchDetail.lastFiveGames.length > 0 && (
                                  <div className="space-y-3">
                                    <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                      Imikino 5 ya vuba (Recent Form)
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      {matchDetail.lastFiveGames.map((lf) => (
                                        <div
                                          key={lf.teamId}
                                          className="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#182229] border border-slate-200 dark:border-[#2f3b43] space-y-2.5"
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                              {lf.teamName}
                                            </span>
                                            <div className="flex items-center gap-1 shrink-0">
                                              {lf.games.slice(0, 5).map((g, i) => (
                                                <span
                                                  key={`${g.id}-${i}`}
                                                  className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center ${
                                                    g.result === 'W'
                                                      ? 'bg-emerald-600 text-white'
                                                      : g.result === 'D'
                                                        ? 'bg-amber-500 text-white'
                                                        : 'bg-red-600 text-white'
                                                  }`}
                                                >
                                                  {g.result || '–'}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                          <div className="space-y-1">
                                            {lf.games.slice(0, 5).map((g, i) => (
                                              <div
                                                key={`${g.id}-row-${i}`}
                                                className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300"
                                              >
                                                <span className="truncate">
                                                  {g.homeAway} {g.opponent}
                                                </span>
                                                <span className="font-mono tabular-nums font-semibold shrink-0 ml-2">
                                                  {g.score}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )
                              )}
                            </>
                          )}

                          {matchTab === 'lineups' && (
                            <div className="space-y-5">
                              {matchDetailLoading && !matchDetail ? (
                                <div className="h-56 rounded-2xl bg-slate-100 dark:bg-[#182229] animate-pulse" />
                              ) : (
                                (() => {
                                  const homeLineup = getGuaranteedLineup(
                                    match.homeTeam,
                                    'home',
                                    matchDetail?.rosters?.find((r) => r.teamId === match.homeTeam.id || r.homeAway === 'home'),
                                    match.statusState === 'pre'
                                  );
                                  const awayLineup = getGuaranteedLineup(
                                    match.awayTeam,
                                    'away',
                                    matchDetail?.rosters?.find((r) => r.teamId === match.awayTeam.id || r.homeAway === 'away'),
                                    match.statusState === 'pre'
                                  );

                                  const isBothOfficial = homeLineup.isOfficial && awayLineup.isOfficial;

                                  return (
                                    <>
                                      <div
                                        className={`p-3.5 rounded-2xl border text-xs flex flex-wrap items-center justify-between gap-2 font-semibold ${
                                          isBothOfficial
                                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                                            : 'bg-amber-500/10 border-amber-500/30 text-amber-800 dark:text-amber-300'
                                        }`}
                                      >
                                        <div className="flex items-center gap-2">
                                          {isBothOfficial ? (
                                            <UserCheck size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                                          ) : (
                                            <Activity size={16} className="text-amber-600 dark:text-amber-400 shrink-0" />
                                          )}
                                          <span>
                                            {isBothOfficial
                                              ? '✓ Confirmed Official Lineup (Ababanjemo bemejwe 100%)'
                                              : '⚡ Possible Lineup (Abashobora kubanzamo mu kibuga)'}
                                          </span>
                                        </div>
                                        <span className="text-[11px] font-mono opacity-85">
                                          {isBothOfficial
                                            ? 'Official 11 vs 11'
                                            : 'Lineup yanyayo yikora auto-update iminota 60 mbere y’umukino'}
                                        </span>
                                      </div>

                                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        {[
                                          { tm: match.homeTeam, side: 'home' as const, lineup: homeLineup },
                                          { tm: match.awayTeam, side: 'away' as const, lineup: awayLineup },
                                        ].map(({ tm, side, lineup }) => (
                                          <div
                                            key={tm.id}
                                            className="p-4 rounded-2xl bg-slate-50 dark:bg-[#182229] border border-slate-200 dark:border-[#2f3b43] space-y-4"
                                          >
                                            <div className="flex items-center justify-between gap-2 border-b border-slate-200/70 dark:border-[#2f3b43] pb-3">
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  openTeamProfile(match.leagueSlug, tm, match.leagueName, match)
                                                }
                                                className="flex items-center gap-2.5 min-w-0 text-left group cursor-pointer"
                                              >
                                                <TeamCrest name={tm.name} shortName={tm.shortName} logo={tm.logo} size="md" />
                                                <div className="min-w-0">
                                                  <span className="text-sm font-bold text-slate-900 dark:text-white truncate block group-hover:underline group-hover:text-[#075E54] dark:group-hover:text-[#00FF88]">
                                                    {tm.name}
                                                  </span>
                                                  <span className="text-[11px] text-slate-400 uppercase font-mono">
                                                    {side === 'home' ? 'Home' : 'Away'}
                                                  </span>
                                                </div>
                                              </button>
                                              <div className="text-right shrink-0">
                                                <span className="text-xs font-mono font-bold text-[#075E54] dark:text-[#00FF88] block">
                                                  {lineup.formation}
                                                </span>
                                                <span
                                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                                    lineup.isOfficial
                                                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                                  }`}
                                                >
                                                  {lineup.isOfficial ? 'Official XI' : 'Possible XI'}
                                                </span>
                                              </div>
                                            </div>

                                            {/* Coach Row */}
                                            {lineup.coach && (
                                              <div className="p-2.5 rounded-xl bg-white dark:bg-[#111b21] border border-slate-200/80 dark:border-[#2f3b43] flex items-center justify-between text-xs">
                                                <span className="text-slate-500 dark:text-[#8696a0] flex items-center gap-1.5">
                                                  <span>👤 Umutoza (Coach):</span>
                                                </span>
                                                <span className="font-bold text-slate-900 dark:text-white">
                                                  {lineup.coach}
                                                </span>
                                              </div>
                                            )}

                                            {/* Starting XI */}
                                            <div className="space-y-2">
                                              <div className="flex items-center justify-between">
                                                <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 uppercase tracking-wide">
                                                  <UserCheck size={13} className="text-emerald-500" />
                                                  <span>Starting XI ({lineup.starters.length})</span>
                                                </p>
                                                <span className="text-[10px] text-slate-400 font-mono">
                                                  Ababanzamo
                                                </span>
                                              </div>

                                              <div className="bg-white dark:bg-[#111b21] border border-slate-200 dark:border-[#2f3b43] rounded-xl divide-y divide-slate-100 dark:divide-[#222c33] overflow-hidden">
                                                {lineup.starters.map((p, pIdx) => {
                                                  const posUpper = String(p.position || '').toUpperCase();
                                                  const isGK = posUpper.includes('G');
                                                  const isDF = posUpper.includes('D') || posUpper.includes('B');
                                                  const isMF = posUpper.includes('M');
                                                  const isFW = posUpper.includes('F') || posUpper.includes('W') || posUpper.includes('S');

                                                  const badgeClass = isGK
                                                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30'
                                                    : isDF
                                                      ? 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30'
                                                      : isMF
                                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                                                        : isFW
                                                          ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30'
                                                          : 'bg-slate-200 dark:bg-[#202c33] text-slate-700 dark:text-slate-300 border-slate-300';

                                                  return (
                                                    <div
                                                      key={p.id || `${p.name}-${pIdx}`}
                                                      className="flex items-center justify-between text-xs px-3 py-2 hover:bg-slate-50/70 dark:hover:bg-[#182229]"
                                                    >
                                                      <div className="flex items-center gap-2.5 min-w-0">
                                                        <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-[#202c33] border border-slate-200 dark:border-[#2f3b43] font-mono tabular-nums text-[10px] font-bold text-slate-700 dark:text-slate-300 flex items-center justify-center shrink-0">
                                                          {p.jersey || pIdx + 1}
                                                        </span>
                                                        <span className="font-semibold text-slate-900 dark:text-white truncate">
                                                          {p.name}
                                                        </span>
                                                      </div>
                                                      <span
                                                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md border font-mono shrink-0 ${badgeClass}`}
                                                      >
                                                        {p.position || (isGK ? 'GK' : isDF ? 'DF' : isMF ? 'MF' : 'FW')}
                                                      </span>
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            </div>

                                            {/* Substitutes */}
                                            <div className="space-y-2 pt-2 border-t border-slate-200/70 dark:border-[#2f3b43]">
                                              <div className="flex items-center justify-between">
                                                <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 uppercase tracking-wide">
                                                  <Users size={13} className="text-blue-500" />
                                                  <span>Substitutes ({lineup.subs.length})</span>
                                                </p>
                                                <span className="text-[10px] text-slate-400 font-mono">
                                                  Abasimbura
                                                </span>
                                              </div>

                                              <div className="bg-white dark:bg-[#111b21] border border-slate-200 dark:border-[#2f3b43] rounded-xl divide-y divide-slate-100 dark:divide-[#222c33] overflow-hidden">
                                                {lineup.subs.slice(0, 9).map((p, sIdx) => (
                                                  <div
                                                    key={p.id || `${p.name}-sub-${sIdx}`}
                                                    className="flex items-center justify-between text-xs px-3 py-1.5 hover:bg-slate-50/70 dark:hover:bg-[#182229]"
                                                  >
                                                    <div className="flex items-center gap-2 min-w-0">
                                                      <span className="w-5 font-mono tabular-nums text-slate-400 font-semibold text-[11px]">
                                                        {p.jersey || '·'}
                                                      </span>
                                                      <span className="text-slate-700 dark:text-slate-300 truncate">
                                                        {p.name}
                                                      </span>
                                                    </div>
                                                    <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                                      {p.position || 'Sub'}
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            </div>

                                            {/* Injured & Suspended */}
                                            <div className="space-y-1.5 pt-2 border-t border-slate-200/70 dark:border-[#2f3b43]">
                                              <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 uppercase tracking-wide">
                                                <UserX size={13} className="text-red-500" />
                                                <span>Injured & Suspended (Abavunitse)</span>
                                              </p>
                                              <div className="p-2.5 rounded-xl bg-white dark:bg-[#111b21] border border-slate-200 dark:border-[#2f3b43] text-xs text-slate-600 dark:text-slate-300">
                                                <p className="text-[11px]">
                                                  Nta mukinnyi mukuru w’ingenzi wemejwe ko afite imvune ibujijwe gukina muri uyu mukino.
                                                </p>
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </>
                                  );
                                })()
                              )}
                            </div>
                          )}

                          {matchTab === 'stats' && (
                            <div className="space-y-5">
                              {matchDetailLoading ? (
                                <div className="h-40 rounded-2xl bg-slate-100 dark:bg-[#182229] animate-pulse" />
                              ) : (
                                <div className="space-y-2.5">
                                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                    Imibare y’umukino (Match Statistics)
                                  </h4>
                                  {pairedStats.length === 0 ? (
                                    <p className="text-xs text-slate-500 dark:text-[#8696a0]">
                                      Imibare y’umukino iraboneka umukino utangiye cyangwa urangiye.
                                    </p>
                                  ) : (
                                    <div className="p-4 rounded-2xl bg-slate-50 dark:bg-[#182229] border border-slate-200 dark:border-[#2f3b43] space-y-3">
                                      {pairedStats.map((st) => {
                                        const hNum = parseFloat(st.homeVal) || 0;
                                        const aNum = parseFloat(st.awayVal) || 0;
                                        const total = hNum + aNum || 1;
                                        const hPct = Math.round((hNum / total) * 100);
                                        return (
                                          <div key={st.key} className="space-y-1">
                                            <div className="flex items-center justify-between text-xs">
                                              <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                                                {st.homeVal}
                                              </span>
                                              <span className="text-slate-500 dark:text-[#8696a0] text-[11px]">
                                                {st.label}
                                              </span>
                                              <span className="font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                                                {st.awayVal}
                                              </span>
                                            </div>
                                            <div className="h-1.5 rounded-full bg-slate-200 dark:bg-[#2a3942] overflow-hidden flex">
                                              <div
                                                className="bg-[#075E54] dark:bg-[#00a884] h-full"
                                                style={{ width: `${hPct}%` }}
                                              />
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {matchTab === 'standings' && (
                            <div className="space-y-3">
                              {(() => {
                                const rows = leagueStandings[match.leagueSlug] || matchDetail?.standings || [];
                                if (standingsLoading && rows.length === 0) {
                                  return (
                                    <div className="space-y-2.5">
                                      {Array.from({ length: 8 }).map((_, i) => (
                                        <div key={i} className="h-10 rounded-xl bg-slate-100 dark:bg-[#182229] animate-pulse" />
                                      ))}
                                    </div>
                                  );
                                }
                                if (rows.length === 0) {
                                  return (
                                    <div className="py-10 text-center space-y-2">
                                      <ListOrdered size={28} className="mx-auto text-slate-400" />
                                      <p className="text-xs text-slate-500 dark:text-[#8696a0]">
                                        Urutonde rwa {match.leagueName} rurimo gutunganywa.
                                      </p>
                                    </div>
                                  );
                                }
                                return (
                                  <div className="border border-slate-200 dark:border-[#2f3b43] rounded-2xl overflow-hidden bg-white dark:bg-[#182229]">
                                    <table className="w-full text-xs">
                                      <thead className="bg-slate-50 dark:bg-[#151e24] text-slate-500 dark:text-[#8696a0] border-b border-slate-200 dark:border-[#2f3b43]">
                                        <tr>
                                          <th className="py-2.5 px-3 text-left font-semibold w-8">#</th>
                                          <th className="py-2.5 px-2 text-left font-semibold">Ikipe</th>
                                          <th className="py-2.5 px-2 text-right font-semibold">P</th>
                                          <th className="py-2.5 px-2 text-right font-semibold hidden sm:table-cell">W-D-L</th>
                                          <th className="py-2.5 px-2 text-right font-semibold">GD</th>
                                          <th className="py-2.5 px-3 text-right font-semibold">PTS</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 dark:divide-[#27343c]">
                                        {rows.map((row) => {
                                          const highlighted =
                                            row.teamId === match.homeTeam.id ||
                                            row.teamId === match.awayTeam.id;
                                          return (
                                            <tr
                                              key={`${row.rank}-${row.teamName}`}
                                              onClick={() => {
                                                if (row.teamId) {
                                                  openTeamProfile(
                                                    match.leagueSlug,
                                                    {
                                                      id: row.teamId,
                                                      name: row.teamName,
                                                      shortName: row.teamName.slice(0, 3),
                                                      logo: row.teamLogo,
                                                      score: null,
                                                    },
                                                    match.leagueName,
                                                    match
                                                  );
                                                }
                                              }}
                                              className={`cursor-pointer transition-colors ${
                                                highlighted
                                                  ? 'bg-[#075E54]/15 dark:bg-[#00a884]/20 font-bold'
                                                  : 'hover:bg-slate-50 dark:hover:bg-[#202c33]/60'
                                              }`}
                                            >
                                              <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500 dark:text-[#8696a0]">
                                                {row.rank}
                                              </td>
                                              <td className="py-2.5 px-2">
                                                <div className="flex items-center gap-2 min-w-0">
                                                  <TeamCrest
                                                    name={row.teamName}
                                                    shortName={row.teamName.slice(0, 3)}
                                                    logo={row.teamLogo}
                                                    size="sm"
                                                  />
                                                  <span className="truncate text-slate-900 dark:text-slate-100">
                                                    {row.teamName}
                                                  </span>
                                                  {highlighted && (
                                                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#075E54] dark:bg-[#00FF88] text-white dark:text-[#0b141a] font-bold shrink-0">
                                                      Match
                                                    </span>
                                                  )}
                                                </div>
                                              </td>
                                              <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                                {row.played}
                                              </td>
                                              <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-500 dark:text-slate-400 hidden sm:table-cell">
                                                {row.wins}-{row.draws}-{row.losses}
                                              </td>
                                              <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                                {Number(row.goalDiff) > 0 ? `+${row.goalDiff}` : row.goalDiff}
                                              </td>
                                              <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-white">
                                                {row.points}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
