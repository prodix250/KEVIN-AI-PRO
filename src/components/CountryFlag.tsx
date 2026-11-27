import React from 'react';

export type CountryCodeItem = {
  code: string;
  iso: string;
  name: string;
};

export const COUNTRY_CODES: CountryCodeItem[] = [
  { code: '+250', iso: 'RW', name: 'Rwanda' },
  { code: '+257', iso: 'BI', name: 'Burundi' },
  { code: '+256', iso: 'UG', name: 'Uganda' },
  { code: '+254', iso: 'KE', name: 'Kenya' },
  { code: '+255', iso: 'TZ', name: 'Tanzania' },
  { code: '+243', iso: 'CD', name: 'DR Congo' },
  { code: '+27', iso: 'ZA', name: 'South Africa' },
  { code: '+234', iso: 'NG', name: 'Nigeria' },
  { code: '+233', iso: 'GH', name: 'Ghana' },
  { code: '+251', iso: 'ET', name: 'Ethiopia' },
  { code: '+1', iso: 'US', name: 'USA / Canada' },
  { code: '+44', iso: 'GB', name: 'UK' },
  { code: '+33', iso: 'FR', name: 'France' },
  { code: '+32', iso: 'BE', name: 'Belgium' },
  { code: '+49', iso: 'DE', name: 'Germany' },
  { code: '+971', iso: 'AE', name: 'UAE' },
  { code: '+91', iso: 'IN', name: 'India' },
  { code: '+86', iso: 'CN', name: 'China' },
];

export const CountryFlag: React.FC<{ iso: string; className?: string }> = ({
  iso,
  className = 'w-5 h-3.5 rounded-[3px] shrink-0 shadow-xs ring-1 ring-white/20',
}) => {
  switch (iso) {
    case 'RW':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="10" fill="#20603D" y="0" />
          <rect width="30" height="10" fill="#00A1DE" y="0" />
          <rect width="30" height="5" fill="#FAD201" y="10" />
          <rect width="30" height="5" fill="#20603D" y="15" />
          <circle cx="23.5" cy="4.5" r="2.2" fill="#E5BE01" />
          <circle cx="23.5" cy="4.5" r="1.2" fill="#E5BE01" />
        </svg>
      );
    case 'BI':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="20" fill="#1EB53A" />
          <polygon points="0,0 15,10 30,0" fill="#CE1126" />
          <polygon points="0,20 15,10 30,20" fill="#CE1126" />
          <line x1="0" y1="0" x2="30" y2="20" stroke="#FFFFFF" strokeWidth="3.2" />
          <line x1="30" y1="0" x2="0" y2="20" stroke="#FFFFFF" strokeWidth="3.2" />
          <circle cx="15" cy="10" r="4.5" fill="#FFFFFF" />
          <circle cx="15" cy="7.9" r="0.9" fill="#CE1126" />
          <circle cx="13.2" cy="11.2" r="0.9" fill="#CE1126" />
          <circle cx="16.8" cy="11.2" r="0.9" fill="#CE1126" />
        </svg>
      );
    case 'UG':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="3.33" y="0" fill="#000000" />
          <rect width="30" height="3.33" y="3.33" fill="#FCDC04" />
          <rect width="30" height="3.34" y="6.66" fill="#D90000" />
          <rect width="30" height="3.33" y="10" fill="#000000" />
          <rect width="30" height="3.33" y="13.33" fill="#FCDC04" />
          <rect width="30" height="3.34" y="16.66" fill="#D90000" />
          <circle cx="15" cy="10" r="3.4" fill="#FFFFFF" />
          <circle cx="15" cy="10" r="1.4" fill="#D90000" />
        </svg>
      );
    case 'KE':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="6" y="0" fill="#000000" />
          <rect width="30" height="1" y="6" fill="#FFFFFF" />
          <rect width="30" height="6" y="7" fill="#BB0000" />
          <rect width="30" height="1" y="13" fill="#FFFFFF" />
          <rect width="30" height="6" y="14" fill="#006600" />
          <ellipse cx="15" cy="10" rx="2.4" ry="4.5" fill="#BB0000" stroke="#FFFFFF" strokeWidth="0.7" />
          <ellipse cx="15" cy="10" rx="0.9" ry="2.5" fill="#000000" />
        </svg>
      );
    case 'TZ':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="20" fill="#00A3DD" />
          <polygon points="0,0 30,0 0,20" fill="#1EB53A" />
          <line x1="0" y1="20" x2="30" y2="0" stroke="#FCD116" strokeWidth="6" />
          <line x1="0" y1="20" x2="30" y2="0" stroke="#000000" strokeWidth="4" />
        </svg>
      );
    case 'CD':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="20" fill="#007FFF" />
          <line x1="0" y1="20" x2="30" y2="0" stroke="#F7D618" strokeWidth="5.4" />
          <line x1="0" y1="20" x2="30" y2="0" stroke="#CE1021" strokeWidth="3.6" />
          <polygon points="5,2.2 5.9,4.9 8.7,4.9 6.4,6.5 7.3,9.2 5,7.5 2.7,9.2 3.6,6.5 1.3,4.9 4.1,4.9" fill="#F7D618" />
        </svg>
      );
    case 'ZA':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="10" y="0" fill="#E03C31" />
          <rect width="30" height="10" y="10" fill="#001489" />
          <polygon points="0,0 13,10 0,20" fill="#FFFFFF" />
          <rect x="11" y="7" width="19" height="6" fill="#FFFFFF" />
          <polygon points="0,1.5 12,10 0,18.5" fill="#007749" />
          <rect x="10" y="8" width="20" height="4" fill="#007749" />
          <polygon points="0,3.8 8.2,10 0,16.2" fill="#FFB81C" />
          <polygon points="0,5.2 6.5,10 0,14.8" fill="#000000" />
        </svg>
      );
    case 'NG':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="10" height="20" x="0" fill="#008751" />
          <rect width="10" height="20" x="10" fill="#FFFFFF" />
          <rect width="10" height="20" x="20" fill="#008751" />
        </svg>
      );
    case 'GH':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="6.67" y="0" fill="#CE1126" />
          <rect width="30" height="6.67" y="6.67" fill="#FCD116" />
          <rect width="30" height="6.66" y="13.34" fill="#006B3F" />
          <polygon points="15,7.2 15.8,9.4 18.1,9.4 16.2,10.7 17,12.9 15,11.6 13,12.9 13.8,10.7 11.9,9.4 14.2,9.4" fill="#000000" />
        </svg>
      );
    case 'ET':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="6.67" y="0" fill="#078930" />
          <rect width="30" height="6.67" y="6.67" fill="#FCDD09" />
          <rect width="30" height="6.66" y="13.34" fill="#DA121A" />
          <circle cx="15" cy="10" r="3.4" fill="#0F47AF" />
          <circle cx="15" cy="10" r="1.7" fill="none" stroke="#FCDD09" strokeWidth="0.7" />
        </svg>
      );
    case 'US':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="20" fill="#FFFFFF" />
          {[0, 4, 8, 12, 16].map((y) => (
            <rect key={y} width="30" height="2" y={y} fill="#B22234" />
          ))}
          <rect width="13" height="10" fill="#3C3B6E" />
          <circle cx="3" cy="3" r="0.7" fill="#FFFFFF" />
          <circle cx="6.5" cy="3" r="0.7" fill="#FFFFFF" />
          <circle cx="10" cy="3" r="0.7" fill="#FFFFFF" />
          <circle cx="4.8" cy="5.5" r="0.7" fill="#FFFFFF" />
          <circle cx="8.2" cy="5.5" r="0.7" fill="#FFFFFF" />
          <circle cx="3" cy="8" r="0.7" fill="#FFFFFF" />
          <circle cx="6.5" cy="8" r="0.7" fill="#FFFFFF" />
          <circle cx="10" cy="8" r="0.7" fill="#FFFFFF" />
        </svg>
      );
    case 'GB':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="20" fill="#012169" />
          <line x1="0" y1="0" x2="30" y2="20" stroke="#FFFFFF" strokeWidth="4" />
          <line x1="30" y1="0" x2="0" y2="20" stroke="#FFFFFF" strokeWidth="4" />
          <line x1="0" y1="0" x2="30" y2="20" stroke="#C8102E" strokeWidth="2" />
          <line x1="30" y1="0" x2="0" y2="20" stroke="#C8102E" strokeWidth="2" />
          <rect x="12" y="0" width="6" height="20" fill="#FFFFFF" />
          <rect x="0" y="7" width="30" height="6" fill="#FFFFFF" />
          <rect x="13.2" y="0" width="3.6" height="20" fill="#C8102E" />
          <rect x="0" y="8.2" width="30" height="3.6" fill="#C8102E" />
        </svg>
      );
    case 'FR':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="10" height="20" x="0" fill="#002395" />
          <rect width="10" height="20" x="10" fill="#FFFFFF" />
          <rect width="10" height="20" x="20" fill="#ED2939" />
        </svg>
      );
    case 'BE':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="10" height="20" x="0" fill="#000000" />
          <rect width="10" height="20" x="10" fill="#FAE042" />
          <rect width="10" height="20" x="20" fill="#ED2939" />
        </svg>
      );
    case 'DE':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="6.67" y="0" fill="#000000" />
          <rect width="30" height="6.67" y="6.67" fill="#DD0000" />
          <rect width="30" height="6.66" y="13.34" fill="#FFCE00" />
        </svg>
      );
    case 'AE':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="22" height="6.67" x="8" y="0" fill="#00732F" />
          <rect width="22" height="6.67" x="8" y="6.67" fill="#FFFFFF" />
          <rect width="22" height="6.66" x="8" y="13.34" fill="#000000" />
          <rect width="8" height="20" x="0" y="0" fill="#FF0000" />
        </svg>
      );
    case 'IN':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="6.67" y="0" fill="#FF9933" />
          <rect width="30" height="6.67" y="6.67" fill="#FFFFFF" />
          <rect width="30" height="6.66" y="13.34" fill="#138808" />
          <circle cx="15" cy="10" r="2.3" fill="none" stroke="#000080" strokeWidth="0.7" />
        </svg>
      );
    case 'CN':
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="20" fill="#DE2910" />
          <polygon points="5.5,2.5 6.2,4.7 8.5,4.7 6.6,6 7.3,8.2 5.5,6.9 3.7,8.2 4.4,6 2.5,4.7 4.8,4.7" fill="#FFDE00" />
          <circle cx="10.5" cy="2.6" r="0.7" fill="#FFDE00" />
          <circle cx="12" cy="4.8" r="0.7" fill="#FFDE00" />
          <circle cx="12" cy="7.5" r="0.7" fill="#FFDE00" />
          <circle cx="10.2" cy="9.4" r="0.7" fill="#FFDE00" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 30 20" className={className} aria-hidden="true">
          <rect width="30" height="20" fill="#075E54" />
          <circle cx="15" cy="10" r="5" fill="#00FF88" />
        </svg>
      );
  }
};
