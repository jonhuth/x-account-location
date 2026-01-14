# Twitter Account Location Flag Chrome Extension

A Chrome extension that displays country flag emojis next to Twitter/X usernames based on the account's location information, plus tools to manage your Twitter interests.

## Features

### Location Flags
- Automatically detects usernames on Twitter/X pages
- Queries Twitter's GraphQL API to get account location information
- Displays the corresponding country flag emoji next to usernames
- Works with dynamically loaded content (infinite scroll)
- Caches location data to minimize API calls
- Shows statistics of profiles by country

### Clean Interests Tool
- Removes all unwanted interests from your Twitter account
- Automatically checks interests matching your preferred list
- Monitors for dynamically loaded interests as you scroll
- Customizable interest list via `myInterests.js`

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in the top right)
4. Click "Load unpacked"
5. Select the directory containing this extension
6. The extension will now be active on Twitter/X pages

## Usage

### Location Flags
Location flags appear automatically next to usernames when browsing Twitter/X. Use the popup to:
- Toggle the extension on/off
- View statistics of profiles by country
- Reset statistics

### Clean Interests
1. Navigate to `x.com/settings/your_twitter_data/twitter_interests`
2. Click the extension icon
3. Click "Clean Interests"
4. Scroll down the page to load more interests (the tool monitors for new ones)

### Customizing Your Interests
Edit `myInterests.js` to set your preferred interests:

```javascript
const MY_INTERESTS = [
  // Tech & Crypto
  'Tech', 'Technology',
  'Crypto', 'Cryptocurrency', 'Bitcoin', 'Ethereum',
  
  // Finance & Business
  'Finance', 'Financial',
  'Accounting',
  // ... add your interests here
];
```

The tool uses fuzzy matching, so adding "Tech" will match "Technology", "Tech news", etc.

## Files

- `manifest.json` - Chrome extension configuration
- `content.js` - Main content script that processes the page and injects page scripts for API calls
- `countryFlags.js` - Country name to flag emoji mapping
- `myInterests.js` - **Your preferred interests list (edit this!)**
- `popup.html` - Extension popup UI
- `popup.js` - Popup functionality (toggle, stats, clean interests)
- `pageScript.js` - Page-injected script for API calls
- `README.md` - This file

## Technical Details

### Location Flags
The extension uses a page script injection approach to make API requests. This allows it to:
- Access the same cookies and authentication as the logged-in user
- Make same-origin requests to Twitter's API without CORS issues
- Work seamlessly with Twitter's authentication system

The content script injects a script into the page context that listens for location fetch requests. When a username is detected, the content script sends a custom event to the page script, which makes the API request and returns the location data.

### Clean Interests
The clean interests tool uses `chrome.scripting.executeScript` to inject a script that:
1. Finds all checkbox elements on the interests page
2. Compares their labels against your preferred interests
3. Unchecks anything not in your list
4. Checks anything matching your interests
5. Monitors for dynamically loaded interests via MutationObserver

## API Endpoint

The extension uses Twitter's GraphQL API endpoint:
```
https://x.com/i/api/graphql/XRqGa7EeokUU5kppkh13EA/AboutAccountQuery
```

With variables:
```json
{
  "screenName": "username"
}
```

The response contains `account_based_in` field in:
```
data.user_result_by_screen_name.result.about_profile.account_based_in
```

## Limitations

- Requires the user to be logged into Twitter/X
- Only works for accounts that have location information available
- Country names must match the mapping in `countryFlags.js` (case-insensitive)
- Rate limiting may apply if making too many requests

## Privacy

- The extension only queries public account information
- No data is stored or transmitted to third-party servers
- All API requests are made directly to Twitter/X servers
- Location data is cached locally in memory and browser storage

## Troubleshooting

If flags are not appearing:
1. Make sure you're logged into Twitter/X
2. Check the browser console for any error messages
3. Verify that the account has location information available
4. Try refreshing the page

If Clean Interests isn't working:
1. Make sure you're on the Twitter interests page (`x.com/settings/your_twitter_data/twitter_interests`)
2. Scroll slowly to let interests load
3. Check the browser console for logs showing which interests are being checked/unchecked

## License

MIT
