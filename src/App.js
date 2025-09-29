import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Home,
  UtensilsCrossed,
  Star,
  MapPin,
  Clock,
} from 'lucide-react';

// === Google Sheets Integration Classes ===
const BASE_IMAGE_URL = 'http://localhost:3000/img';

class GoogleSheetsService {
  constructor(apiKey, sheetId) {
    this.apiKey = apiKey;
    this.sheetId = sheetId;
    this.baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  }

  async getSheetData(range = 'Sheet1!A:G') {
    try {
      const response = await fetch(
        `${this.baseUrl}/values/${range}?key=${this.apiKey}`
      );
      const data = await response.json();
      return data.values || [];
    } catch (error) {
      console.error('Error fetching sheet data:', error);
      throw error;
    }
  }

  parseSheetData(sheetData) {
    if (!sheetData || sheetData.length < 2) return { restaurants: [], menuItems: {} };

    const [headers, ...rows] = sheetData;
    const restaurants = new Map();
    const menuItems = {};

    rows.forEach((row) => {
      if (row.length < 7) return;

      const [
        restaurantName,
        itemName,
        price,
        category,
        description,
        imageUrl,
        available,
        restaurantLocation,
        restaurantSpecialty,
        restaurantRating,
        restaurantImage,
      ] = row;

      // Create restaurant entry
      if (!restaurants.has(restaurantName)) {
        const restaurantId = this.generateId(restaurantName);
        restaurants.set(restaurantName, {
          id: restaurantId,
          name: restaurantName,
          location: restaurantLocation || 'Malawi',
          specialty: restaurantSpecialty || 'Malawian Cuisine',
          rating: parseFloat(restaurantRating) || 4.5,
          image:
            restaurantImage ||
            'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=300&h=200&fit=crop',
        });
        menuItems[restaurantId] = [];
      }

      // Add menu item
      const restaurantId = restaurants.get(restaurantName).id;

      menuItems[restaurantId].push({
        id: this.generateId(itemName + restaurantName),
        name: itemName,
        price: price,
        category: category || 'Main Dishes',
        description: description || '',
        image: imageUrl 
        ? `${BASE_IMAGE_URL}/${imageUrl.trim()}`
        : `${BASE_IMAGE_URL}/placeholder.jpg`,       
         available: available !== 'FALSE'
      });
    });

    return {
      restaurants: Array.from(restaurants.values()),
      menuItems,
    };
  }

  generateId(text) {
    return (
      text.toLowerCase().replace(/[^a-z0-9]/g, '') + Date.now().toString().slice(-4)
    );
  }
}

class MenuSyncService {
  constructor(apiBaseUrl, googleSheetsService) {
    this.apiBaseUrl = apiBaseUrl;
    this.sheetsService = googleSheetsService;
  }

  async syncFromGoogleSheets() {
    try {
      console.log('🔄 Starting sync from Google Sheets...');
      const sheetData = await this.sheetsService.getSheetData();
      const parsedData = this.sheetsService.parseSheetData(sheetData);

      console.log(`📊 Found ${parsedData.restaurants.length} restaurants with menus`);

      for (const restaurant of parsedData.restaurants) {
        await this.syncRestaurant(restaurant, parsedData.menuItems[restaurant.id]);
      }

      console.log('✅ Sync completed successfully!');
      return parsedData;
    } catch (error) {
      console.error('❌ Sync failed:', error);
      throw error;
    }
  }

  async syncRestaurant(restaurantData, menuItems) {
    try {
      const existingRestaurant = await this.findRestaurantByName(restaurantData.name);
      let restaurantId;

      if (existingRestaurant) {
        restaurantId = existingRestaurant.id;
        await this.updateRestaurant(restaurantId, restaurantData);
        console.log(`📝 Updated restaurant: ${restaurantData.name}`);
      } else {
        const newRestaurant = await this.createRestaurant(restaurantData);
        restaurantId = newRestaurant.id;
        console.log(`🆕 Created restaurant: ${restaurantData.name}`);
      }

      if (menuItems && menuItems.length > 0) {
        await this.syncMenuItems(restaurantId, menuItems);
      }
    } catch (error) {
      console.error(`Error syncing restaurant ${restaurantData.name}:`, error);
    }
  }

  async findRestaurantByName(name) {
    try {
      const response = await fetch(
        `${this.apiBaseUrl}/search/restaurants?q=${encodeURIComponent(name)}`
      );
      const data = await response.json();
      return data.data?.find((r) => r.name.toLowerCase() === name.toLowerCase());
    } catch (error) {
      return null;
    }
  }

  async createRestaurant(restaurantData) {
    const response = await fetch(`${this.apiBaseUrl}/restaurants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(restaurantData),
    });
    const result = await response.json();
    if (!result.success) throw new Error(result.message);
    return result.data;
  }

  async updateRestaurant(id, restaurantData) {
    const response = await fetch(`${this.apiBaseUrl}/restaurants/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(restaurantData),
    });
    const result = await response.json();
    if (!result.success) throw new Error(result.message);
    return result.data;
  }

  async syncMenuItems(restaurantId, menuItems) {
    try {
      const menusResponse = await fetch(
        `${this.apiBaseUrl}/restaurants/${restaurantId}/menus`
      );
      const menusData = await menusResponse.json();

      let menuId;
      if (menusData.data?.length > 0) {
        menuId = menusData.data[0].id;
      } else {
        const menuResponse = await fetch(
          `${this.apiBaseUrl}/restaurants/${restaurantId}/menus`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'Main Menu',
              description: 'Restaurant menu from Google Sheets',
              is_active: true,
            }),
          }
        );
        const menuResult = await menuResponse.json();
        menuId = menuResult.data.id;
      }

      const response = await fetch(`${this.apiBaseUrl}/menus/${menuId}/items/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: menuItems }),
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.message);

      console.log(`📋 Synced ${menuItems.length} menu items`);
      return result.data;
    } catch (error) {
      console.error('Error syncing menu items:', error);
      throw error;
    }
  }
}

// === Custom Hook: useGoogleSheetsMenu ===
export const useGoogleSheetsMenu = (apiKey, sheetId, apiBaseUrl) => {
  const [restaurants, setRestaurants] = useState([]);
  const [menuItems, setMenuItems] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastSync, setLastSync] = useState(null);

  const syncData = useCallback(async () => {
    if (!apiKey || !sheetId || !apiBaseUrl) {
      console.log('Missing API configuration, using fallback data');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const sheetsService = new GoogleSheetsService(apiKey, sheetId);
      const syncService = new MenuSyncService(apiBaseUrl, sheetsService);
      const data = await syncService.syncFromGoogleSheets();
      
      setRestaurants(data.restaurants);
      setMenuItems(data.menuItems);
      setLastSync(new Date());
    } catch (err) {
      setError(err.message);
      console.error('Sync error:', err);
    } finally {
      setLoading(false);
    }
  }, [apiKey, sheetId, apiBaseUrl]);

  useEffect(() => {
    syncData();
  }, [syncData]);

  useEffect(() => {
    const interval = setInterval(syncData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [syncData]);

  return {
    restaurants,
    menuItems,
    loading,
    error,
    lastSync,
    manualSync: syncData,
  };
};

// === Fallback Data (for when Google Sheets is unavailable) ===
const FALLBACK_RESTAURANTS = [
  {
    id: 1,
    name: "Mama's Kitchen",
    location: 'Blantyre City Centre',
    specialty: 'Traditional Malawian',
    rating: 4.8,
    image:
      'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=300&h=200&fit=crop',
  },
  {
    id: 2,
    name: 'Nyama House',
    location: 'Area 47, Lilongwe',
    specialty: 'Grilled Meats',
    rating: 4.6,
    image:
      'https://images.unsplash.com/photo-1558030006-450675393462?w=300&h=200&fit=crop',
  },
  {
    id: 3,
    name: 'Lake View Restaurant',
    location: 'Mangochi',
    specialty: 'Fish & Traditional',
    rating: 4.5,
    image:
      'https://images.unsplash.com/photo-1544148103-0773bf10d330?w=300&h=200&fit=crop',
  },
  {
    id: 4,
    name: 'Spice Garden',
    location: 'Mzuzu',
    specialty: 'Fusion Cuisine',
    rating: 4.7,
    image:
      'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=300&h=200&fit=crop',
  },
  {
    id: 5,
    name: 'Village Taste',
    location: 'Zomba',
    specialty: 'Home Style Cooking',
    rating: 4.9,
    image:
      'https://images.unsplash.com/photo-1590846406792-0adc7f938f1d?w=300&h=200&fit=crop',
  },
];

const FALLBACK_MENU_ITEMS = {
  1: [
    {
      id: 1,
      name: 'Nsima with Ndiwo',
      price: 'MK 1,500',
      category: 'Main Dishes',
      image:
        'https://images.unsplash.com/photo-1586511925558-a4c6376fe65f?w=400&h=300&fit=crop',
      description: 'Traditional nsima with choice of relish (ndiwo)',
    },
    {
      id: 2,
      name: 'Chambo with Rice',
      price: 'MK 2,800',
      category: 'Fish Dishes',
      image:
        'https://images.unsplash.com/photo-1544943910-4c1dc44aab44?w=400&h=300&fit=crop',
      description: 'Fresh chambo fish grilled with spices',
    },
  ],
  2: [
    {
      id: 4,
      name: 'Nyama ya Ng\'ombe',
      price: 'MK 3,200',
      category: 'Grilled Meats',
      image:
        'https://images.unsplash.com/photo-1544025162-d76694265947?w=400&h=300&fit=crop',
      description: 'Grilled beef with nsima and vegetables',
    },
  ],
};

const POPULAR_DISHES = [
  {
    id: 1,
    title: 'Traditional Nsima Experience',
    description: 'Discover authentic Malawian cuisine with our traditional nsima dishes',
    image:
      'https://images.unsplash.com/photo-1586511925558-a4c6376fe65f?w=400&h=200&fit=crop',
  },
  {
    id: 2,
    title: 'Fresh Lake Fish',
    description: 'Enjoy the finest chambo and other fish from Lake Malawi',
    image:
      'https://images.unsplash.com/photo-1544943910-4c1dc44aab44?w=400&h=200&fit=crop',
  },
  {
    id: 3,
    title: 'Local Specialties',
    description: 'Taste unique Malawian flavors and traditional cooking methods',
    image:
      'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&h=200&fit=crop',
  },
];

// === Main Component ===
const MalawianRestaurantApp = () => {
  const {
    restaurants: sheetRestaurants,
    menuItems: sheetMenuItems,
    loading: syncLoading,
    error: syncError,
    lastSync,
    manualSync,
  } = useGoogleSheetsMenu(
    process.env.REACT_APP_GOOGLE_SHEETS_API_KEY,
    process.env.REACT_APP_GOOGLE_SHEETS_ID,
    process.env.REACT_APP_API_BASE_URL || 'http://localhost:3000/api'
  );

  const [activeTab, setActiveTab] = useState('home');
  const [selectedRestaurant, setSelectedRestaurant] = useState(null);
  const [selectedMenuItem, setSelectedMenuItem] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showRestaurantPanel, setShowRestaurantPanel] = useState(false);

  const restaurants = sheetRestaurants.length > 0 ? sheetRestaurants : FALLBACK_RESTAURANTS;
  const menuItems = Object.keys(sheetMenuItems).length > 0 ? sheetMenuItems : FALLBACK_MENU_ITEMS;

  const filteredRestaurants = restaurants.filter(
    (restaurant) =>
      restaurant.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      restaurant.specialty.toLowerCase().includes(searchTerm.toLowerCase()) ||
      restaurant.location.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const MenuItem = ({ item, onClick }) => (
    <div
      className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow cursor-pointer p-4 border"
      onClick={() => onClick(item)}
    >
      <img
        src={item.image}
        alt={item.name}
        className="w-full h-32 object-cover rounded-lg mb-3"
      />
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-semibold text-gray-800">{item.name}</h3>
          <p className="text-sm text-gray-600">{item.category}</p>
        </div>
        <span className="font-bold text-green-600">{item.price}</span>
      </div>
    </div>
  );

  const MenuItemModal = ({ item, onClose }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full">
        <div className="relative">
          <img
            src={item.image}
            alt={item.name}
            className="w-full h-48 object-cover rounded-t-lg"
          />
          <button
            onClick={onClose}
            className="absolute top-2 right-2 bg-white rounded-full p-1 hover:bg-gray-100"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <div className="p-6">
          <h2 className="text-xl font-bold mb-2">{item.name}</h2>
          <p className="text-gray-600 mb-4">{item.description}</p>
          <div className="flex justify-between items-center">
            <span className="text-2xl font-bold text-green-600">{item.price}</span>
            <button className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700">
              Order Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const RestaurantCard = ({ restaurant, onClick }) => (
    <div
      className={`bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow cursor-pointer border ${
        selectedRestaurant?.id === restaurant.id ? 'ring-2 ring-red-500' : ''
      }`}
      onClick={() => {
        onClick(restaurant);
        if (window.innerWidth < 768) {
          setShowRestaurantPanel(false);
        }
      }}
    >
      <img
        src={restaurant.image}
        alt={restaurant.name}
        className="w-full h-24 object-cover rounded-t-lg"
      />
      <div className="p-3">
        <h3 className="font-semibold text-sm truncate">{restaurant.name}</h3>
        <p className="text-xs text-gray-600">{restaurant.specialty}</p>
        <div className="flex items-center justify-between mt-2 text-xs">
          <div className="flex items-center">
            <Star className="w-3 h-3 text-yellow-400 mr-1" />
            <span>{restaurant.rating}</span>
          </div>
          <div className="flex items-center text-gray-500">
            <MapPin className="w-3 h-3 mr-1" />
            <span className="truncate">{restaurant.location}</span>
          </div>
        </div>
      </div>
    </div>
  );

  const HomeTab = () => (
    <div className="flex-1 p-6 overflow-y-auto pb-20">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Malawian Restaurant Menus</h1>
          <p className="text-gray-600">
            Discover authentic Malawian cuisine from restaurants across the warm heart of Africa
          </p>
        </div>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4 flex items-center">
            <UtensilsCrossed className="w-6 h-6 mr-2 text-red-600" />
            Featured Dishes
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {POPULAR_DISHES.map((dish) => (
              <div
                key={dish.id}
                className="bg-gradient-to-br from-red-500 to-orange-500 rounded-lg overflow-hidden shadow-lg text-white"
              >
                <img
                  src={dish.image}
                  alt={dish.title}
                  className="w-full h-32 object-cover opacity-80"
                />
                <div className="p-4">
                  <h3 className="font-bold text-lg mb-2">{dish.title}</h3>
                  <p className="text-sm opacity-90">{dish.description}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4 flex items-center">
            <MapPin className="w-6 h-6 mr-2 text-red-600" />
            Popular Restaurants
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {restaurants.slice(0, 5).map((restaurant) => (
              <RestaurantCard
                key={restaurant.id}
                restaurant={restaurant}
                onClick={(r) => {
                  setSelectedRestaurant(r);
                  setActiveTab('menu');
                }}
              />
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">🇲🇼 About Malawian Cuisine</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-lg shadow-md text-center">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <UtensilsCrossed className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="font-semibold mb-2">Nsima - Staple Food</h3>
              <p className="text-gray-600 text-sm">
                Made from maize flour, nsima is the cornerstone of Malawian meals
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-md text-center">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-6 h-6 text-blue-600" />
              </div>
              <h3 className="font-semibold mb-2">Lake Malawi Fish</h3>
              <p className="text-gray-600 text-sm">
                Fresh chambo, usipa, and other fish from Africa's third largest lake
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-md text-center">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Clock className="w-6 h-6 text-green-600" />
              </div>
              <h3 className="font-semibold mb-2">Traditional Cooking</h3>
              <p className="text-gray-600 text-sm">
                Time-honored recipes passed down through generations
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );

  const MenuTab = () => (
    <div className="flex-1 flex px-6 py-6 gap-6 overflow-hidden pb-20">
      <button
        className="md:hidden fixed top-4 left-4 z-30 bg-red-600 text-white p-2 rounded-lg shadow-lg"
        onClick={() => setShowRestaurantPanel(!showRestaurantPanel)}
      >
        <UtensilsCrossed className="w-5 h-5" />
      </button>

      <div
        className={`
          ${showRestaurantPanel ? 'translate-x-0' : '-translate-x-full'} 
          md:translate-x-0 
          fixed md:relative 
          top-0 left-0 
          w-80 md:w-1/4 
          h-full md:h-auto 
          bg-white 
          rounded-none md:rounded-lg 
          shadow-lg md:shadow-md 
          p-4 
          z-20 
          transition-transform duration-300 ease-in-out
          flex flex-col
        `}
      >
        <button
          className="md:hidden self-end mb-2 p-1 hover:bg-gray-100 rounded"
          onClick={() => setShowRestaurantPanel(false)}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        <div className="mb-4">
          <h2 className="text-lg font-semibold mb-3">Restaurants</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search restaurants..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-3 max-h-[calc(100vh-200px)] md:max-h-none">
          {filteredRestaurants.map((restaurant) => (
            <RestaurantCard
              key={restaurant.id}
              restaurant={restaurant}
              onClick={setSelectedRestaurant}
            />
          ))}
        </div>
      </div>

      {showRestaurantPanel && (
        <div
          className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-10"
          onClick={() => setShowRestaurantPanel(false)}
        />
      )}

      <div className="flex-1 bg-white rounded-lg shadow-md overflow-hidden flex flex-col">
        {selectedRestaurant ? (
          <>
            <div className="p-6 border-b bg-white">
              <h1 className="text-2xl font-bold text-gray-800">{selectedRestaurant.name}</h1>
              <p className="text-gray-600">
                {selectedRestaurant.specialty} • {selectedRestaurant.location}
              </p>
              <div className="flex items-center mt-2">
                <Star className="w-4 h-4 text-yellow-400 mr-1" />
                <span className="font-medium">{selectedRestaurant.rating}</span>
                <span className="text-gray-500 ml-2">• Malawian Cuisine</span>
              </div>
            </div>

            <div className="flex-1 p-6 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(menuItems[selectedRestaurant.id] || []).map((item) => (
                  <MenuItem key={item.id} item={item} onClick={setSelectedMenuItem} />
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <UtensilsCrossed className="w-16 h-16 mb-4" />
            <h2 className="text-xl font-semibold mb-2">Select a Restaurant</h2>
            <p className="text-center">
              {window.innerWidth < 768
                ? 'Tap the menu icon to choose a restaurant'
                : 'Choose a restaurant from the left panel to view their menu'}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const SyncStatus = () => (
    <div className="fixed top-4 right-4 z-50">
      {syncLoading && (
        <div className="bg-blue-500 text-white px-3 py-2 rounded-lg shadow-lg flex items-center">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
          Syncing menus...
        </div>
      )}
      {syncError && (
        <div className="bg-red-500 text-white px-3 py-2 rounded-lg shadow-lg">
          Sync failed: {syncError}
        </div>
      )}
      {lastSync && !syncLoading && !syncError && (
        <div className="bg-green-500 text-white px-3 py-2 rounded-lg shadow-lg text-sm">
          Last sync: {lastSync.toLocaleTimeString()}
          <button onClick={manualSync} className="ml-2 underline hover:no-underline">
            Refresh
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <SyncStatus />
      
      <div className="flex flex-col min-h-screen">
        {activeTab === 'home' ? <HomeTab /> : <MenuTab />}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg">
        <div className="flex justify-center">
          <div className="flex space-x-8 px-6 py-3">
            <button
              className={`flex flex-col items-center space-y-1 px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'home'
                  ? 'text-red-600 bg-red-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              onClick={() => setActiveTab('home')}
            >
              <Home className="w-6 h-6" />
              <span className="text-xs font-medium">Home</span>
            </button>
            <button
              className={`flex flex-col items-center space-y-1 px-4 py-2 rounded-lg transition-colors ${
                activeTab === 'menu'
                  ? 'text-red-600 bg-red-50'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
              onClick={() => setActiveTab('menu')}
            >
              <UtensilsCrossed className="w-6 h-6" />
              <span className="text-xs font-medium">Menus</span>
            </button>
          </div>
        </div>
      </div>

      {selectedMenuItem && (
        <MenuItemModal item={selectedMenuItem} onClose={() => setSelectedMenuItem(null)} />
      )}
    </div>
  );
};

export default MalawianRestaurantApp;
