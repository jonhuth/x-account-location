// Country name to flag emoji mapping
const COUNTRY_FLAGS = {
  // A
  "Afghanistan": "🇦🇫",
  "Albania": "🇦🇱",
  "Algeria": "🇩🇿",
  "Andorra": "🇦🇩",
  "Angola": "🇦🇴",
  "Argentina": "🇦🇷",
  "Armenia": "🇦🇲",
  "Australia": "🇦🇺",
  "Austria": "🇦🇹",
  "Azerbaijan": "🇦🇿",
  
  // B
  "Bahamas": "🇧🇸",
  "Bahrain": "🇧🇭",
  "Bangladesh": "🇧🇩",
  "Barbados": "🇧🇧",
  "Belarus": "🇧🇾",
  "Belgium": "🇧🇪",
  "Belize": "🇧🇿",
  "Bermuda": "🇧🇲",
  "Bolivia": "🇧🇴",
  "Bosnia and Herzegovina": "🇧🇦",
  "Botswana": "🇧🇼",
  "Brazil": "🇧🇷",
  "Brunei": "🇧🇳",
  "Bulgaria": "🇧🇬",
  
  // C
  "Cambodia": "🇰🇭",
  "Cameroon": "🇨🇲",
  "Canada": "🇨🇦",
  "Chile": "🇨🇱",
  "China": "🇨🇳",
  "Colombia": "🇨🇴",
  "Costa Rica": "🇨🇷",
  "Croatia": "🇭🇷",
  "Cuba": "🇨🇺",
  "Cyprus": "🇨🇾",
  "Czech Republic": "🇨🇿",
  "Czechia": "🇨🇿",
  
  // D
  "Denmark": "🇩🇰",
  "Dominican Republic": "🇩🇴",
  
  // E
  "Ecuador": "🇪🇨",
  "Egypt": "🇪🇬",
  "El Salvador": "🇸🇻",
  "Estonia": "🇪🇪",
  "Ethiopia": "🇪🇹",
  "Europe": "🇪🇺",
  
  // F
  "Finland": "🇫🇮",
  "France": "🇫🇷",
  
  // G
  "Georgia": "🇬🇪",
  "Germany": "🇩🇪",
  "Ghana": "🇬🇭",
  "Greece": "🇬🇷",
  "Guatemala": "🇬🇹",
  
  // H
  "Haiti": "🇭🇹",
  "Honduras": "🇭🇳",
  "Hong Kong": "🇭🇰",
  "Hungary": "🇭🇺",
  
  // I
  "Iceland": "🇮🇸",
  "India": "🇮🇳",
  "Indonesia": "🇮🇩",
  "Iran": "🇮🇷",
  "Iraq": "🇮🇶",
  "Ireland": "🇮🇪",
  "Israel": "🇮🇱",
  "Italy": "🇮🇹",
  
  // J
  "Jamaica": "🇯🇲",
  "Japan": "🇯🇵",
  "Jordan": "🇯🇴",
  
  // K
  "Kazakhstan": "🇰🇿",
  "Kenya": "🇰🇪",
  "Korea": "🇰🇷",
  "Kosovo": "🇽🇰",
  "Kuwait": "🇰🇼",
  "Kyrgyzstan": "🇰🇬",
  
  // L
  "Laos": "🇱🇦",
  "Latvia": "🇱🇻",
  "Lebanon": "🇱🇧",
  "Libya": "🇱🇾",
  "Liechtenstein": "🇱🇮",
  "Lithuania": "🇱🇹",
  "Luxembourg": "🇱🇺",
  
  // M
  "Macau": "🇲🇴",
  "Macedonia": "🇲🇰",
  "North Macedonia": "🇲🇰",
  "Malaysia": "🇲🇾",
  "Maldives": "🇲🇻",
  "Malta": "🇲🇹",
  "Mauritius": "🇲🇺",
  "Mexico": "🇲🇽",
  "Moldova": "🇲🇩",
  "Monaco": "🇲🇨",
  "Mongolia": "🇲🇳",
  "Montenegro": "🇲🇪",
  "Morocco": "🇲🇦",
  "Myanmar": "🇲🇲",
  
  // N
  "Nepal": "🇳🇵",
  "Netherlands": "🇳🇱",
  "New Zealand": "🇳🇿",
  "Nicaragua": "🇳🇮",
  "Nigeria": "🇳🇬",
  "Norway": "🇳🇴",
  
  // O
  "Oman": "🇴🇲",
  
  // P
  "Pakistan": "🇵🇰",
  "Palestine": "🇵🇸",
  "Panama": "🇵🇦",
  "Paraguay": "🇵🇾",
  "Peru": "🇵🇪",
  "Philippines": "🇵🇭",
  "Poland": "🇵🇱",
  "Portugal": "🇵🇹",
  "Puerto Rico": "🇵🇷",
  
  // Q
  "Qatar": "🇶🇦",
  
  // R
  "Romania": "🇷🇴",
  "Russia": "🇷🇺",
  "Russian Federation": "🇷🇺",
  "Rwanda": "🇷🇼",
  
  // S
  "Saudi Arabia": "🇸🇦",
  "Senegal": "🇸🇳",
  "Serbia": "🇷🇸",
  "Singapore": "🇸🇬",
  "Slovakia": "🇸🇰",
  "Slovenia": "🇸🇮",
  "South Africa": "🇿🇦",
  "South Korea": "🇰🇷",
  "Spain": "🇪🇸",
  "Sri Lanka": "🇱🇰",
  "Sweden": "🇸🇪",
  "Switzerland": "🇨🇭",
  "Syria": "🇸🇾",
  
  // T
  "Taiwan": "🇹🇼",
  "Tanzania": "🇹🇿",
  "Thailand": "🇹🇭",
  "Trinidad and Tobago": "🇹🇹",
  "Tunisia": "🇹🇳",
  "Turkey": "🇹🇷",
  "Türkiye": "🇹🇷",
  
  // U
  "Uganda": "🇺🇬",
  "Ukraine": "🇺🇦",
  "United Arab Emirates": "🇦🇪",
  "UAE": "🇦🇪",
  "United Kingdom": "🇬🇧",
  "UK": "🇬🇧",
  "United States": "🇺🇸",
  "USA": "🇺🇸",
  "Uruguay": "🇺🇾",
  "Uzbekistan": "🇺🇿",
  
  // V
  "Venezuela": "🇻🇪",
  "Vietnam": "🇻🇳",
  "Viet Nam": "🇻🇳",
  
  // Z
  "Zimbabwe": "🇿🇼"
  
  // Note: Regions (Africa, East Asia & Pacific, South Asia, etc.) intentionally
  // have no flags - they'll display as text only to be distinguishable
};

const COUNTRY_FLAGS_LOWER = {};
for (const [country, flag] of Object.entries(COUNTRY_FLAGS)) {
  COUNTRY_FLAGS_LOWER[country.toLowerCase()] = flag;
}

function getCountryFlag(countryName) {
  if (!countryName) return null;
  
  const normalized = countryName.trim().toLowerCase();
  return COUNTRY_FLAGS_LOWER[normalized] || null;
}

