// Country name to flag emoji mapping
const COUNTRY_FLAGS = {
  "Afghanistan": "🇦🇫",
  "Albania": "🇦🇱",
  "Algeria": "🇩🇿",
  "Argentina": "🇦🇷",
  "Australia": "🇦🇺",
  "Austria": "🇦🇹",
  "Bangladesh": "🇧🇩",
  "Belgium": "🇧🇪",
  "Brazil": "🇧🇷",
  "Canada": "🇨🇦",
  "Chile": "🇨🇱",
  "China": "🇨🇳",
  "Colombia": "🇨🇴",
  "Czech Republic": "🇨🇿",
  "Denmark": "🇩🇰",
  "Egypt": "🇪🇬",
  "Europe": "🇪🇺",
  "Finland": "🇫🇮",
  "France": "🇫🇷",
  "Germany": "🇩🇪",
  "Greece": "🇬🇷",
  "Guatemala": "🇬🇹",
  "Honduras": "🇭🇳",
  "Hong Kong": "🇭🇰",
  "Hungary": "🇭🇺",
  "Iceland": "🇮🇸",
  "India": "🇮🇳",
  "Indonesia": "🇮🇩",
  "Iran": "🇮🇷",
  "Iraq": "🇮🇶",
  "Ireland": "🇮🇪",
  "Israel": "🇮🇱",
  "Italy": "🇮🇹",
  "Jamaica": "🇯🇲",
  "Japan": "🇯🇵",
  "Jordan": "🇯🇴",
  "Kenya": "🇰🇪",
  "Malaysia": "🇲🇾",
  "Morocco": "🇲🇦",
  "Mexico": "🇲🇽",
  "Netherlands": "🇳🇱",
  "New Zealand": "🇳🇿",
  "Nigeria": "🇳🇬",
  "Norway": "🇳🇴",
  "Pakistan": "🇵🇰",
  "Panama": "🇵🇦",
  "Peru": "🇵🇪",
  "Philippines": "🇵🇭",
  "Poland": "🇵🇱",
  "Portugal": "🇵🇹",
  "Romania": "🇷🇴",
  "Russia": "🇷🇺",
  "Saudi Arabia": "🇸🇦",
  "Singapore": "🇸🇬",
  "South Africa": "🇿🇦",
  "Korea": "🇰🇷",
  "South Korea": "🇰🇷",
  "Spain": "🇪🇸",
  "Sri Lanka": "🇱🇰",
  "Sweden": "🇸🇪",
  "Switzerland": "🇨🇭",
  "Taiwan": "🇹🇼",
  "Thailand": "🇹🇭",
  "Trinidad and Tobago": "🇹🇹",
  "Turkey": "🇹🇷",
  "Ukraine": "🇺🇦",
  "United Arab Emirates": "🇦🇪",
  "United Kingdom": "🇬🇧",
  "United States": "🇺🇸",
  "Uruguay": "🇺🇾",
  "Venezuela": "🇻🇪",
  "Vietnam": "🇻🇳"
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

