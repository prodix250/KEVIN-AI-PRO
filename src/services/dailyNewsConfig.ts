export type DailyNewsSlotKey = 'morning_tech' | 'noon_world' | 'afternoon_sports_analysis' | 'evening_tech';

export interface DailyNewsSlotMeta {
  key: DailyNewsSlotKey;
  hourKigali: number;
  minuteKigali: number;
  scheduledLabel: string;
  titleRw: string;
  categoryLabel: string;
  emoji: string;
}

export interface DailyNewsBriefing {
  slotId: string;
  kigaliDate: string;
  slotKey: DailyNewsSlotKey;
  scheduledLabel: string;
  title: string;
  preview: string;
  body: string;
  sources: Array<{ title: string; url: string }>;
  generatedAtMs: number;
  scheduledAtMs: number;
  category: 'tech_ai' | 'world_sports' | 'sports_analysis';
}

export const DAILY_NEWS_SLOTS: DailyNewsSlotMeta[] = [
  {
    key: 'morning_tech',
    hourKigali: 6,
    minuteKigali: 0,
    scheduledLabel: '06:00',
    titleRw: "Amakuru y'Ikoranabuhanga & AI (Mugitondo)",
    categoryLabel: 'Tech & AI',
    emoji: '☀️💻',
  },
  {
    key: 'noon_world',
    hourKigali: 12,
    minuteKigali: 0,
    scheduledLabel: '12:00',
    titleRw: "Amakuru y'Isi & Imikino (Saa Sita)",
    categoryLabel: 'Isi & Sport',
    emoji: '🌍⚽',
  },
  {
    key: 'afternoon_sports_analysis',
    hourKigali: 15,
    minuteKigali: 0,
    scheduledLabel: '15:00',
    titleRw: "Ubusesenguzi bw'Amakipe & Imikino yo ku Isi (Saa Cyenda)",
    categoryLabel: 'Ubusesenguzi bwa Siporo',
    emoji: '⚽📊',
  },
  {
    key: 'evening_tech',
    hourKigali: 18,
    minuteKigali: 0,
    scheduledLabel: '18:00',
    titleRw: "Ibyiriwe mu Ikoranabuhanga & AI (Nimugoroba)",
    categoryLabel: 'Tech & AI',
    emoji: '🌆🤖',
  },
];

export const KIGALI_TIMEZONE = 'Africa/Kigali';

export function getKigaliClockInfo(date: Date = new Date()): {
  kigaliDate: string;
  hour: number;
  minute: number;
  second: number;
  displayDateRw: string;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: KIGALI_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') {
      map[p.type] = p.value;
    }
  }
  const year = map.year || String(date.getUTCFullYear());
  const month = map.month || '01';
  const day = map.day || '01';
  const rawHour = Number(map.hour || '0');
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(map.minute || '0');
  const second = Number(map.second || '0');

  return {
    kigaliDate: `${year}-${month}-${day}`,
    hour,
    minute,
    second,
    displayDateRw: `${day}/${month}/${year}`,
  };
}

export function buildNewsSlotId(kigaliDate: string, slotKey: DailyNewsSlotKey): string {
  return `${kigaliDate}_${slotKey}`;
}

export function computeKigaliSlotEpochMs(kigaliDate: string, hourKigali: number, minuteKigali = 0): number {
  const hh = String(hourKigali).padStart(2, '0');
  const mm = String(minuteKigali).padStart(2, '0');
  // Africa/Kigali is permanently UTC+02:00 (no DST)
  const parsed = Date.parse(`${kigaliDate}T${hh}:${mm}:00+02:00`);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function getDueDailyNewsSlots(now: Date = new Date()): Array<{
  slotId: string;
  kigaliDate: string;
  meta: DailyNewsSlotMeta;
  scheduledAtMs: number;
}> {
  const clock = getKigaliClockInfo(now);
  const currentTotalMinutes = clock.hour * 60 + clock.minute;

  return DAILY_NEWS_SLOTS
    .filter((slot) => currentTotalMinutes >= slot.hourKigali * 60 + slot.minuteKigali)
    .map((slot) => ({
      slotId: buildNewsSlotId(clock.kigaliDate, slot.key),
      kigaliDate: clock.kigaliDate,
      meta: slot,
      scheduledAtMs: computeKigaliSlotEpochMs(clock.kigaliDate, slot.hourKigali, slot.minuteKigali),
    }));
}
