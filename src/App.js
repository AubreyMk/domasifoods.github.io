import React, { useState, useEffect, useCallback, memo } from 'react';
import {
  Search, Home, UtensilsCrossed, Star, MapPin,
  Clock, Navigation, X, AlertCircle,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const FALLBACK_IMG =
  'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=500&h=400&fit=crop';

const DEBUG = process.env.NODE_ENV !== 'production';
const log  = (...a) => DEBUG && console.log('[RestaurantApp]', ...a);
const warn = (...a) => DEBUG && console.warn('[RestaurantApp]', ...a);
const err  = (...a) => console.error('[RestaurantApp]', ...a);

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE DRIVE URL CONVERSION
//
// FIX: drive.google.com/uc?export=view redirects to a download/virus-scan
// page — browsers refuse to render it in <img> tags.
// The correct embeddable format is:
//   https://lh3.googleusercontent.com/d/FILE_ID
// which serves the raw bytes directly with proper CORS headers.
// ─────────────────────────────────────────────────────────────────────────────
export const getDriveImageUrl = (raw) => {
  if (!raw) return FALLBACK_IMG;
  const url = raw.toString().trim();

  // Already a non-Drive URL → pass through
  if (!url.includes('drive.google.com') && url.startsWith('http')) {
    return url;
  }

  let fileId = null;

  // Format A: /file/d/{ID}/...
  const filePathMatch = url.match(/\/file\/d\/([-\w]{10,})/);
  if (filePathMatch) fileId = filePathMatch[1];

  // Format B/C: ?id={ID} or &id={ID}
  if (!fileId) {
    const queryMatch = url.match(/[?&]id=([-\w]{10,})/);
    if (queryMatch) fileId = queryMatch[1];
  }

  // Format D: bare file ID (28-44 chars, no spaces/dots/slashes)
  if (!fileId && /^[-\w]{28,44}$/.test(url)) fileId = url;

  if (fileId) {
    // FIX: use lh3.googleusercontent.com — the only Drive URL that browsers
    // can load directly in <img> without being redirected to a download page.
    const resolved = `https://lh3.googleusercontent.com/d/${fileId}`;
    log('Drive ID', fileId, '→', resolved);
    return resolved;
  }

  warn('Could not extract Drive file ID from:', url);
  return FALLBACK_IMG;
};

// ─────────────────────────────────────────────────────────────────────────────
// SafeImage
// FIX: compute the URL once on mount/src-change via useMemo-style init,
// not on every render. Also guard against infinite error loops.
// ─────────────────────────────────────────────────────────────────────────────
const SafeImage = memo(({ src, alt, className }) => {
  // Resolve once; don't re-run getGoogleDriveImageUrl on every parent render
  const [imgSrc, setImgSrc] = useState(() => getDriveImageUrl(src));
  const [failed, setFailed]  = useState(false);

  useEffect(() => {
    setImgSrc(getDriveImageUrl(src));
    setFailed(false);
  }, [src]);

  const handleError = useCallback(() => {
    if (!failed) {
      warn('Image failed to load:', imgSrc);
      setFailed(true);
      setImgSrc(FALLBACK_IMG);
    }
    // No more setImgSrc after fallback — prevents infinite onError loop
  }, [failed, imgSrc]);

  return (
    <img
      src={imgSrc || FALLBACK_IMG}
      alt={alt}
      className={className}
      onError={handleError}
    />
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Google Sheets Service
// ─────────────────────────────────────────────────────────────────────────────
class GoogleSheetsService {
  constructor(apiKey, sheetId) {
    if (!apiKey) warn('Missing REACT_APP_GOOGLE_SHEETS_API_KEY');
    if (!sheetId) warn('Missing REACT_APP_GOOGLE_SHEETS_ID');
    this.apiKey   = apiKey;
    this.sheetId  = sheetId;
    this.baseUrl  = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  }

  async _fetch(range) {
    const url = `${this.baseUrl}/values/${encodeURIComponent(range)}?key=${this.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      err(`Sheet fetch failed [${range}]:`, res.status, body);
      return [];
    }
    const data = await res.json();
    return data.values || [];
  }

  async getSheetData(range = 'Sheet1!A:M') {
    try {
      const rows = await this._fetch(range);
      log('Sheet rows received:', rows.length);
      return rows;
    } catch (e) { err('getSheetData:', e); return []; }
  }

  async getGourmetPicks(range = 'GourmetPicks!A:F') {
    try {
      const rows = await this._fetch(range);
      if (rows.length < 2) { warn('GourmetPicks: empty'); return []; }
      const [, ...data] = rows;
      return data.slice(0, 3).map((row, i) => ({
        id:          `promo-${i}`,
        name:        row[0] || '',
        description: row[1] || '',
        promoText:   row[2] || '',
        image:       getDriveImageUrl(row[3]?.trim()),
        price:       row[4] || '',
        mapsUrl:     row[5] || '',
      }));
    } catch (e) { err('getGourmetPicks:', e); return []; }
  }

  parseSheetData(sheetData) {
    if (!sheetData || sheetData.length < 2) {
      warn('parseSheetData: no data'); return { restaurants: [], menuItems: {} };
    }
    const [, ...rows] = sheetData;
    const restaurants = new Map();
    const menuItems   = {};
    let   skipped     = 0;

    rows.forEach((row, idx) => {
      if (row.length < 7) { skipped++; return; }
      const [rName, itemName, price, cat, desc, img, , loc, spec, rate, rImg, maps, isTop] = row;
      if (!rName) { skipped++; return; }

      if (!restaurants.has(rName)) {
        const rId = rName.toLowerCase().replace(/[^a-z0-9]/g, '');
        restaurants.set(rName, {
          id:       rId,
          name:     rName,
          location: loc  || 'Malawi',
          specialty:spec  || 'Malawian Cuisine',
          rating:   parseFloat(rate) || 4.5,
          image:    getDriveImageUrl(rImg?.trim()),
          mapsUrl:  maps || '',
          isTop:    isTop === 'TRUE',
        });
        menuItems[rId] = [];
      }

      const rId = restaurants.get(rName).id;
      menuItems[rId].push({
        id:          `${itemName}-${rId}-${idx}`,
        name:        itemName || 'Unnamed Item',
        price:       price    || '',
        category:    cat      || 'Main Dishes',
        description: desc     || '',
        image:       getDriveImageUrl(img?.trim()),
        mapsUrl:     maps     || '',
      });
    });

    if (skipped) warn(`Skipped ${skipped} rows`);
    log(`Parsed: ${restaurants.size} restaurants`);
    return { restaurants: Array.from(restaurants.values()), menuItems };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// FIX: defined OUTSIDE the parent component so React doesn't recreate them
// on every render — the root cause of the repeated getGoogleDriveImageUrl
// calls and flashing images when opening the menu modal.
// ─────────────────────────────────────────────────────────────────────────────
const ErrorBanner = ({ message }) => (
  <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg mb-4">
    <AlertCircle className="w-4 h-4 flex-shrink-0" /><span>{message}</span>
  </div>
);

const RestaurantCard = memo(({ restaurant, selected, onSelect }) => (
  <div
    className={`bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow cursor-pointer border ${
      selected ? 'ring-2 ring-red-500' : ''
    }`}
    onClick={onSelect}
  >
    <SafeImage src={restaurant.image} alt={restaurant.name} className="w-full h-24 object-cover rounded-t-lg" />
    <div className="p-3">
      <h3 className="font-semibold text-sm truncate">{restaurant.name}</h3>
      <p className="text-xs text-gray-600">{restaurant.specialty}</p>
      <div className="flex items-center justify-between mt-2 text-xs">
        <div className="flex items-center">
          <Star className="w-3 h-3 text-yellow-400 mr-1" /><span>{restaurant.rating}</span>
        </div>
        <div className="flex items-center text-gray-500">
          <MapPin className="w-3 h-3 mr-1" /><span className="truncate">{restaurant.location}</span>
        </div>
      </div>
    </div>
  </div>
));

const MenuItem = memo(({ item, onSelect }) => (
  <div
    className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow cursor-pointer p-4 border"
    onClick={onSelect}
  >
    <SafeImage src={item.image} alt={item.name} className="w-full h-32 object-cover rounded-lg mb-3" />
    <div className="flex justify-between items-start">
      <div>
        <h3 className="font-semibold text-gray-800">{item.name}</h3>
        <p className="text-sm text-gray-600">{item.category}</p>
      </div>
      <span className="font-bold text-green-600">{item.price}</span>
    </div>
  </div>
));

const MenuItemModal = memo(({ item, onClose }) => {
  const mapsUrl = item.mapsUrl?.startsWith('http')
    ? item.mapsUrl
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.name)}`;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div className="bg-white rounded-lg max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="relative">
          {/* FIX: image src is already resolved — no extra getDriveImageUrl call here */}
          <SafeImage src={item.image} alt={item.name} className="w-full h-48 object-cover rounded-t-lg" />
          <button onClick={onClose} className="absolute top-2 right-2 bg-white rounded-full p-1 shadow-md hover:bg-gray-100">
            <X className="w-6 h-6" />
          </button>
        </div>
        <div className="p-6">
          <h2 className="text-xl font-bold mb-2">{item.name}</h2>
          <p className="text-gray-600 mb-6">{item.description}</p>
          <div className="flex flex-col gap-3">
            <a
              href={mapsUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700"
            >
              <Navigation className="w-4 h-4 mr-2" /> Directions
            </a>
            <div className="flex justify-between items-center mt-2">
              <span className="text-2xl font-bold text-green-600">{item.price}</span>
              <button className="bg-red-600 text-white px-8 py-2 rounded-lg font-bold">Order Now</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
const MalawianRestaurantApp = () => {
  const [restaurants,        setRestaurants]        = useState([]);
  const [menuItems,          setMenuItems]           = useState({});
  const [gourmetPicks,       setGourmetPicks]        = useState([]);
  const [activeTab,          setActiveTab]           = useState('home');
  const [selectedRestaurant, setSelectedRestaurant]  = useState(null);
  const [selectedMenuItem,   setSelectedMenuItem]    = useState(null);
  const [searchTerm,         setSearchTerm]          = useState('');
  const [showSidebar,        setShowSidebar]         = useState(false);
  const [loadError,          setLoadError]           = useState(null);
  const [loading,            setLoading]             = useState(true);

  useEffect(() => {
    const apiKey  = process.env.REACT_APP_GOOGLE_SHEETS_API_KEY;
    const sheetId = process.env.REACT_APP_GOOGLE_SHEETS_ID;
    if (!apiKey || !sheetId) {
      setLoadError('Missing REACT_APP_GOOGLE_SHEETS_API_KEY or REACT_APP_GOOGLE_SHEETS_ID');
      setLoading(false); return;
    }
    const sheets = new GoogleSheetsService(apiKey, sheetId);
    (async () => {
      try {
        const [sheetData, picks] = await Promise.all([sheets.getSheetData(), sheets.getGourmetPicks()]);
        const parsed = sheets.parseSheetData(sheetData);
        setRestaurants(parsed.restaurants);
        setMenuItems(parsed.menuItems);
        setGourmetPicks(picks);
      } catch (e) {
        err('Sync failed:', e);
        setLoadError('Failed to load data. Check console for details.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredRestaurants = restaurants.filter(r =>
    r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.location.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectRestaurantForMenu = useCallback((r) => {
    setSelectedRestaurant(r);
    setActiveTab('menu');
    setShowSidebar(false);
  }, []);

  // ── Home Tab ────────────────────────────────────────────────────────────────
  const HomeTab = () => (
    <div className="flex-1 p-6 overflow-y-auto pb-20">
      <div className="max-w-6xl mx-auto">
        {loadError && <ErrorBanner message={loadError} />}

        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Malawian Restaurant Menus</h1>
          <p className="text-gray-600">Discover authentic Malawian cuisine from the warm heart of Africa</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20 text-gray-400">Loading…</div>
        ) : (
          <>
            {gourmetPicks.length > 0 && (
              <section className="mb-8">
                <h2 className="text-2xl font-semibold mb-4 flex items-center">
                  <UtensilsCrossed className="w-6 h-6 mr-2 text-red-600" /> Gourmet's Picks
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {gourmetPicks.map(dish => (
                    <div
                      key={dish.id}
                      className="bg-gradient-to-br from-red-500 to-orange-500 rounded-lg overflow-hidden shadow-lg text-white cursor-pointer"
                      onClick={() => setSelectedMenuItem(dish)}
                    >
                      <SafeImage src={dish.image} alt={dish.name} className="w-full h-32 object-cover opacity-80" />
                      <div className="p-4">
                        <h3 className="font-bold text-lg mb-2">
                          {dish.name}{' '}
                          <span className="text-xs bg-white/20 px-2 py-1 rounded ml-2">{dish.promoText}</span>
                        </h3>
                        <p className="text-sm opacity-90">{dish.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="mb-8">
              <h2 className="text-2xl font-semibold mb-4 flex items-center text-gray-800">
                <MapPin className="w-6 h-6 mr-2 text-red-600" /> Popular Restaurants
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {restaurants.filter(r => r.isTop).slice(0, 5).map(r => (
                  <RestaurantCard
                    key={r.id} restaurant={r}
                    selected={selectedRestaurant?.id === r.id}
                    onSelect={() => selectRestaurantForMenu(r)}
                  />
                ))}
              </div>
              {!loading && restaurants.filter(r => r.isTop).length === 0 && (
                <p className="text-gray-400 text-sm mt-2">
                  No featured restaurants yet — add <code>TRUE</code> in column M.
                </p>
              )}
            </section>

            
          </>
        )}
      </div>
    </div>
  );

  // ── Menu Tab ────────────────────────────────────────────────────────────────
  const MenuTab = () => (
    <div className="flex-1 flex px-6 py-6 gap-6 overflow-hidden pb-20">
      <button
        className="md:hidden fixed top-4 left-4 z-30 bg-red-600 text-white p-2 rounded-lg shadow-lg"
        onClick={() => setShowSidebar(s => !s)}
      >
        <UtensilsCrossed className="w-5 h-5" />
      </button>

      {/* Sidebar */}
      <div className={`${showSidebar ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
        fixed md:relative top-0 left-0 w-80 md:w-1/4 h-full bg-white rounded-lg shadow-md p-4 z-20 flex flex-col`}
      >
        <div className="mb-4">
          <h2 className="text-lg font-semibold mb-3">Restaurants</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text" placeholder="Search…"
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm"
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3">
          {filteredRestaurants.length === 0
            ? <p className="text-gray-400 text-sm text-center mt-8">No restaurants found</p>
            : filteredRestaurants.map(r => (
                <RestaurantCard
                  key={r.id} restaurant={r}
                  selected={selectedRestaurant?.id === r.id}
                  onSelect={() => { setSelectedRestaurant(r); setShowSidebar(false); }}
                />
              ))
          }
        </div>
      </div>

      {/* Menu panel */}
      <div className="flex-1 bg-white rounded-lg shadow-md overflow-hidden flex flex-col">
        {selectedRestaurant ? (
          <>
            <div className="p-6 border-b">
              <h1 className="text-2xl font-bold text-gray-800">{selectedRestaurant.name}</h1>
              <p className="text-gray-600">{selectedRestaurant.specialty} • {selectedRestaurant.location}</p>
              <div className="flex items-center mt-2">
                <Star className="w-4 h-4 text-yellow-400 mr-1" />
                <span className="font-medium">{selectedRestaurant.rating}</span>
                <span className="text-gray-500 ml-2">• Malawian Cuisine</span>
              </div>
            </div>
            <div className="flex-1 p-6 overflow-y-auto">
              {(menuItems[selectedRestaurant.id] || []).length === 0
                ? <p className="text-gray-400 text-sm text-center mt-8">No menu items yet</p>
                : <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {(menuItems[selectedRestaurant.id] || []).map(item => (
                      <MenuItem key={item.id} item={item} onSelect={() => setSelectedMenuItem(item)} />
                    ))}
                  </div>
              }
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <UtensilsCrossed className="w-16 h-16 mb-4" />
            <p>Select a restaurant to view their menu</p>
          </div>
        )}
      </div>
    </div>
  );

  // ── Root ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {activeTab === 'home' ? <HomeTab /> : <MenuTab />}

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t p-3 flex justify-center gap-12 shadow-lg z-40 text-gray-500">
        <button onClick={() => setActiveTab('home')} className={`flex flex-col items-center ${activeTab === 'home' ? 'text-red-600' : ''}`}>
          <Home className="w-6 h-6" /><span className="text-xs">Home</span>
        </button>
        <button onClick={() => setActiveTab('menu')} className={`flex flex-col items-center ${activeTab === 'menu' ? 'text-red-600' : ''}`}>
          <UtensilsCrossed className="w-6 h-6" /><span className="text-xs">Menus</span>
        </button>
      </nav>

      {selectedMenuItem && (
        <MenuItemModal item={selectedMenuItem} onClose={() => setSelectedMenuItem(null)} />
      )}
    </div>
  );
};

export default MalawianRestaurantApp;