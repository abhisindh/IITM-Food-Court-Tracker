/**
 * IITM Food Court Tracker - app.js
 * Core application logic: handles CSV loading, state calculations, recommendation calculations, and UI updates.
 */



// Global Application State
const state = {
    foodDb: [],        // Raw array of food items loaded from CSV
    foodMap: {},       // Map of foodID -> foodObject for O(1) lookups
    version: 3,        // Schema version
    settings: {
        startDate: "2026-09-01",
        endDate: "2026-10-10",
        startingBalance: 6510,
        mealWeights: {
            breakfast: 40,
            lunch: 70,
            snack: 20,
            dinner: 70
        },
        mealTimes: {
            breakfast: ["07:00", "10:00"],
            lunch: ["12:00", "14:30"],
            snack: ["16:30", "17:30"],
            dinner: ["19:00", "21:30"]
        }
    },
    ratings: {},       // maps foodID -> rating (1 to 5)
    eaten: [],         // [foodID, timestamp, priceAtPurchase, optionalCustomName]
    
    // UI states
    currentMeal: 'lunch',
    filters: {
        search: '',
        category: 'all',
        suitability: 'current' // 'all', 'current', 'breakfast', 'lunch', 'snack', 'dinner'
    },
    activeTab: 'catalog',      // 'catalog', 'history', 'settings'
    theme: 'dark'             // 'dark' or 'light'
};

// Default Settings for Fallback and Reset
const DEFAULT_SETTINGS = JSON.parse(JSON.stringify(state.settings));

// Double Click protection variable
let lastEatTime = 0;

/**
 * 1. CSV LOADING & PARSING
 */

/**
 * Parses CSV raw text into rows and columns, handling double quotes and commas inside quotes safely.
 * @param {string} text 
 * @returns {string[][]} Array of rows, where each row is an array of cell values.
 */
function parseCSV(text) {
    const lines = [];
    let row = [];
    let col = "";
    let inQuotes = false;
    
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i+1];
        if (inQuotes) {
            if (c === '"') {
                if (next === '"') { // Double double-quote is an escaped double-quote
                    col += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                col += c;
            }
        } else {
            if (c === '"') {
                inQuotes = true;
            } else if (c === ',') {
                row.push(col.trim());
                col = "";
            } else if (c === '\r' || c === '\n') {
                if (c === '\r' && next === '\n') {
                    i++;
                }
                row.push(col.trim());
                if (row.length > 1 || (row.length === 1 && row[0] !== "")) {
                    lines.push(row);
                }
                row = [];
                col = "";
            } else {
                col += c;
            }
        }
    }
    // Handle last column if file doesn't end with a newline
    if (col !== "" || row.length > 0) {
        row.push(col.trim());
        lines.push(row);
    }
    return lines;
}

/**
 * Loads CSV from the local file and parses it into state.foodDb.
 */
async function loadFoodDatabase() {
    try {
        const response = await fetch('IITM_Food_Court_Nutrition_Estimates.csv');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const csvText = await response.text();
        const csvData = parseCSV(csvText);
        
        if (csvData.length < 2) {
            throw new Error("CSV database is empty or missing headers.");
        }
        
        const header = csvData[0];
        
        // Find column indices dynamically to be robust
        const colIndices = {
            id: header.indexOf('id'),
            category: header.indexOf('Category'),
            item: header.indexOf('Item'),
            servingSize: header.indexOf('Serving_Size'),
            price: header.indexOf('Price_Rs'),
            nutritionInfo: header.indexOf('Nutrition_Info'),
            calories: header.indexOf('Calories_kcal_Approx'),
            protein: header.indexOf('Protein_g_Approx'),
            carbs: header.indexOf('Carbs_g_Approx'),
            fat: header.indexOf('Fat_g_Approx'),
            fiber: header.indexOf('Fiber_g_Approx'),
            notes: header.indexOf('Nutrition_Notes')
        };
        
        // Ensure critical columns exist
        if (colIndices.id === -1 || colIndices.price === -1 || colIndices.item === -1) {
            throw new Error("Missing essential columns (id, Price_Rs, or Item) in CSV.");
        }
        
        const loadedDb = [];
        const loadedMap = {};
        
        for (let i = 1; i < csvData.length; i++) {
            const row = csvData[i];
            if (row.length < 3 || !row[colIndices.id]) continue; // Skip malformed rows
            
            const id = row[colIndices.id].trim();
            const item = row[colIndices.item].trim();
            const category = colIndices.category !== -1 ? row[colIndices.category].trim() : 'Uncategorized';
            const servingSize = colIndices.servingSize !== -1 ? parseFloat(row[colIndices.servingSize]) || 0 : 0;
            const price = parseFloat(row[colIndices.price]) || 0;
            const info = colIndices.nutritionInfo !== -1 ? row[colIndices.nutritionInfo].trim() : '';
            
            // Handle missing nutrition values gracefully (defaults to 0 if missing or NaN)
            const calories = colIndices.calories !== -1 ? parseFloat(row[colIndices.calories]) || 0 : 0;
            const protein = colIndices.protein !== -1 ? parseFloat(row[colIndices.protein]) || 0 : 0;
            const carbs = colIndices.carbs !== -1 ? parseFloat(row[colIndices.carbs]) || 0 : 0;
            const fat = colIndices.fat !== -1 ? parseFloat(row[colIndices.fat]) || 0 : 0;
            const fiber = colIndices.fiber !== -1 ? parseFloat(row[colIndices.fiber]) || 0 : 0;
            const notes = colIndices.notes !== -1 ? row[colIndices.notes].trim() : '';
            
            const foodObj = {
                id,
                category,
                item,
                servingSize,
                price,
                info,
                calories,
                protein,
                carbs,
                fat,
                fiber,
                notes,
                nutritionScore: 0 // Will be computed after loading all items
            };
            
            loadedDb.push(foodObj);
            loadedMap[id] = foodObj;
        }
        
        state.foodDb = loadedDb;
        state.foodMap = loadedMap;
        
        // Compute nutrition scores across the loaded database
        calculateNutritionScores();
        return true;
    } catch (err) {
        console.error("Database load error:", err);
        showDatabaseErrorAlert(err.message);
        return false;
    }
}

/**
 * Adds a purchase-time price to legacy eating records and persists the new schema.
 * Legacy records use the current CSV price because their historical price is unavailable.
 */
function migrateEatenPrices() {
    state.eaten = state.eaten.map(record => {
        if (!Array.isArray(record)) return record;
        const [foodId, timestamp, savedPrice] = record;
        if (Number.isFinite(savedPrice) && savedPrice >= 0) return record;

        const currentPrice = state.foodMap[foodId]?.price;
        return [foodId, timestamp, Number.isFinite(currentPrice) ? currentPrice : 0];
    });

    saveUserData();
}

function getEatenRecordPrice(foodId, savedPrice) {
    if (Number.isFinite(savedPrice) && savedPrice >= 0) return savedPrice;
    const currentPrice = state.foodMap[foodId]?.price;
    return Number.isFinite(currentPrice) ? currentPrice : 0;
}

function isCustomFoodId(foodId) {
    return typeof foodId === 'string' && foodId.startsWith('custom:');
}

function isFoodCourtLedgerEntry(foodId) {
    return foodId === 'custom:food-court-ledger' || (typeof foodId === 'string' && foodId.startsWith('custom:food-court-ledger:'));
}

const MEAL_TYPES = ['breakfast', 'lunch', 'snack', 'dinner'];

function getEntryMealOverride(record) {
    const metadata = record.slice(4);
    return isFoodCourtLedgerEntry(record[0]) ? metadata[4] : metadata[0];
}

function getEntryMealType(record) {
    const [foodId, timestamp] = record;
    const override = getEntryMealOverride(record);
    if (MEAL_TYPES.includes(override)) return override;
    if (override === 'unassigned' || isFoodCourtLedgerEntry(foodId)) return null;
    return getMealTypeForTime(`${timestamp.substring(8, 10)}:${timestamp.substring(10, 12)}`, state.settings.mealTimes);
}

function getEntryMealLabel(record) {
    const meal = getEntryMealType(record);
    return meal ? `${meal.charAt(0).toUpperCase()}${meal.slice(1)}` : 'Meal unassigned';
}

function getEatenRecordName(foodId, customName) {
    return customName || state.foodMap[foodId]?.item || `Unknown Item (${foodId})`;
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

function showDatabaseErrorAlert(msg) {
    const catalogContainer = document.getElementById('catalog-content');
    if (catalogContainer) {
        catalogContainer.innerHTML = `
            <div class="alert alert-danger" style="margin: 20px 0; padding: 20px; border-radius: 12px;">
                <h3 style="margin-top:0;">⚠️ Unable to load food database</h3>
                <p>Failed with error: <em>${msg}</em></p>
                <p><strong>Note:</strong> Browsers restrict standard file fetches when files are opened directly via the <code>file://</code> protocol. Please ensure you are running a local web server (e.g. <code>python -m http.server</code> in the terminal) and accessing the app via <code>http://localhost:8000/</code>.</p>
            </div>
        `;
    }
}

/**
 * 2. LOCAL STORAGE CONTROLLER (With Corruption Recovery)
 */

function initializeDefaultData() {
    const defaultData = {
        version: state.version,
        settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
        ratings: {},
        eaten: []
    };
    localStorage.setItem('foodCourtData', JSON.stringify(defaultData));
    return defaultData;
}

/**
 * Loads data from localStorage. Restores default structures if corrupt.
 */
function loadUserData() {
    try {
        const stored = localStorage.getItem('foodCourtData');
        if (!stored) {
            return initializeDefaultData();
        }
        
        const data = JSON.parse(stored);
        
        // Validate Schema version & key structure (support both V1 and V2)
        if (
            !data ||
            (data.version !== 1 && data.version !== 2 && data.version !== 3) ||
            !data.settings ||
            !data.ratings ||
            !data.eaten ||
            !data.settings.mealWeights ||
            !data.settings.mealTimes
        ) {
            console.warn("Outdated or invalid data schema in localStorage. Re-initializing.");
            return initializeDefaultData();
        }
        
        // Check for specific fields in settings to be extra robust
        if (
            typeof data.settings.startingBalance !== 'number' ||
            !data.settings.startDate ||
            !data.settings.endDate
        ) {
            console.warn("Corrupt fields in settings. Re-initializing.");
            return initializeDefaultData();
        }
        
        return data;
    } catch (e) {
        console.error("LocalStorage load/parse failed. Resetting to defaults.", e);
        return initializeDefaultData();
    }
}

function saveUserData() {
    const dataToSave = {
        version: state.version,
        settings: state.settings,
        ratings: state.ratings,
        eaten: state.eaten
    };
    localStorage.setItem('foodCourtData', JSON.stringify(dataToSave));
}

/**
 * 3. DATE & TIME CALCULATIONS
 */

/**
 * Parses date string in local timezone (ignoring utc offsets).
 * @param {string} dateStr "YYYY-MM-DD"
 * @returns {Date} Date object with hours/minutes set to 0 in local timezone.
 */
function parseLocalDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day, 0, 0, 0, 0);
}

/**
 * Helper to get local date string in YYYYMMDD format.
 */
function getLocalDateString(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}${mm}${dd}`;
}

/**
 * Helper to format local timestamp as YYYYMMDDHHMM.
 */
function getLocalTimestamp(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}${mm}${dd}${hh}${min}`;
}

/**
 * Converts HH:MM string to minutes from midnight (0-1439).
 */
function timeToMinutes(tStr) {
    const [h, m] = tStr.split(':').map(Number);
    return h * 60 + m;
}

/**
 * 4. FINANCIAL CALCULATIONS & BUDGET ALLOCATIONS
 */

function calculateFinance() {
    const now = new Date();
    // Midnight check: set time to 00:00:00 to compare dates purely.
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    
    const start = parseLocalDate(state.settings.startDate);
    const end = parseLocalDate(state.settings.endDate);
    
    const isBeforePeriod = today < start;
    const isAfterPeriod = today > end;
    const isOutOfPeriod = isBeforePeriod || isAfterPeriod;
    
    // Total days in the budget period (inclusive)
    const diffTimeTotal = end.getTime() - start.getTime();
    const numberOfDays = Math.round(diffTimeTotal / (1000 * 60 * 60 * 24)) + 1;
    
    // Days remaining (inclusive of today)
    let daysRemaining = 0;
    if (isBeforePeriod) {
        daysRemaining = numberOfDays;
    } else if (isAfterPeriod) {
        daysRemaining = 0;
    } else {
        const diffTimeRemaining = end.getTime() - today.getTime();
        daysRemaining = Math.round(diffTimeRemaining / (1000 * 60 * 60 * 24)) + 1;
    }
    
    // Calculate total spent using saved purchase prices, with a CSV fallback for legacy records.
    let totalSpent = 0;
    const todayStr = getLocalDateString(today);
    let spentTodayTotal = 0;
    const spentTodayByMeal = { breakfast: 0, lunch: 0, snack: 0, dinner: 0 };
    
    state.eaten.forEach(record => {
        const [foodId, timestamp, savedPrice] = record;
        const food = state.foodMap[foodId];
        const price = getEatenRecordPrice(foodId, savedPrice);
        if (food || price > 0) {
            totalSpent += price;
            
            // Check if item was eaten today
            if (timestamp.substring(0, 8) === todayStr) {
                spentTodayTotal += price;
                
                // Determine meal type for this record's timestamp
                const hr = timestamp.substring(8, 10);
                const min = timestamp.substring(10, 12);
                const mealType = getEntryMealType(record);
                if (mealType) spentTodayByMeal[mealType] += price;
            }
        }
    });
    
    // Current balance
    const currentBalance = state.settings.startingBalance - totalSpent;
    
    // Today's budget
    // Zero or negative balances results in a remaining daily budget of ₹0
    let todayBudget = 0;
    if (currentBalance > 0 && daysRemaining > 0 && !isBeforePeriod && !isAfterPeriod) {
        todayBudget = currentBalance / daysRemaining;
    }
    
    // Meal budget distribution
    const weights = state.settings.mealWeights;
    const totalMealWeight = weights.breakfast + weights.lunch + weights.snack + weights.dinner;
    
    const mealBudgets = { breakfast: 0, lunch: 0, snack: 0, dinner: 0 };
    if (totalMealWeight > 0) {
        mealBudgets.breakfast = todayBudget * weights.breakfast / totalMealWeight;
        mealBudgets.lunch = todayBudget * weights.lunch / totalMealWeight;
        mealBudgets.snack = todayBudget * weights.snack / totalMealWeight;
        mealBudgets.dinner = todayBudget * weights.dinner / totalMealWeight;
    }
    
    return {
        isBeforePeriod,
        isAfterPeriod,
        isOutOfPeriod,
        numberOfDays,
        daysRemaining,
        totalSpent,
        currentBalance,
        todayBudget,
        mealBudgets,
        spentTodayByMeal,
        spentTodayTotal
    };
}

/**
 * 5. CURRENT MEAL DETECTION & EXPLICIT BOUNDARIES
 */

/**
 * Returns active meal type based on time with explicit fallbacks for intermediate ranges.
 */
function getMealTypeForTime(timeStr, mealTimes) {
    const m = timeToMinutes(timeStr);
    const bStart = timeToMinutes(mealTimes.breakfast[0]);
    const bEnd = timeToMinutes(mealTimes.breakfast[1]);
    const lStart = timeToMinutes(mealTimes.lunch[0]);
    const lEnd = timeToMinutes(mealTimes.lunch[1]);
    const sStart = timeToMinutes(mealTimes.snack[0]);
    const sEnd = timeToMinutes(mealTimes.snack[1]);
    const dStart = timeToMinutes(mealTimes.dinner[0]);
    const dEnd = timeToMinutes(mealTimes.dinner[1]);
    
    // 1. Direct active window check
    if (m >= bStart && m <= bEnd) return 'breakfast';
    if (m >= lStart && m <= lEnd) return 'lunch';
    if (m >= sStart && m <= sEnd) return 'snack';
    if (m >= dStart && m <= dEnd) return 'dinner';
    
    // 2. Explicit nearest meal window fallbacks
    // Between Breakfast end and Lunch start -> Fallback to Breakfast
    if (m > bEnd && m < lStart) return 'breakfast';
    // Between Lunch end and Snack start -> Fallback to Lunch
    if (m > lEnd && m < sStart) return 'lunch';
    // Between Snack end and Dinner start -> Fallback to Snack
    if (m > sEnd && m < dStart) return 'snack';
    // Between Dinner end and Breakfast start (includes wrap around midnight) -> Fallback to Dinner
    return 'dinner';
}

/**
 * 6. NUTRITION SCORE CALCULATIONS (Normalized Across database)
 */
function calculateNutritionScores() {
    if (state.foodDb.length === 0) return;
    
    let minP = Infinity, maxP = -Infinity;
    let minFib = Infinity, maxFib = -Infinity;
    let minCal = Infinity, maxCal = -Infinity;
    let minFat = Infinity, maxFat = -Infinity;
    
    // Find limits to perform Min-Max Normalization
    state.foodDb.forEach(f => {
        if (f.protein < minP) minP = f.protein;
        if (f.protein > maxP) maxP = f.protein;
        
        if (f.fiber < minFib) minFib = f.fiber;
        if (f.fiber > maxFib) maxFib = f.fiber;
        
        if (f.calories < minCal) minCal = f.calories;
        if (f.calories > maxCal) maxCal = f.calories;
        
        if (f.fat < minFat) minFat = f.fat;
        if (f.fat > maxFat) maxFat = f.fat;
    });
    
    // Prevent division by zero
    if (minP === maxP) { minP = 0; maxP = 1; }
    if (minFib === maxFib) { minFib = 0; maxFib = 1; }
    if (minCal === maxCal) { minCal = 0; maxCal = 1; }
    if (minFat === maxFat) { minFat = 0; maxFat = 1; }
    
    state.foodDb.forEach(f => {
        const pNorm = (f.protein - minP) / (maxP - minP);
        const fibNorm = (f.fiber - minFib) / (maxFib - minFib);
        const calNorm = (f.calories - minCal) / (maxCal - minCal);
        const fatNorm = (f.fat - minFat) / (maxFat - minFat);
        
        // Score Components:
        // Calories: optimal target around 35% of max calories (roughly 250-300 kcal is ideal)
        const calScore = 1 - Math.abs(calNorm - 0.35); 
        // Fat: penalize high fat content (lower fat is better)
        const fatScore = 1 - fatNorm;
        
        // Final Formula (0-100 index):
        // 40% Protein Weight, 30% Fiber Weight, 20% Calorie Balance Weight, 10% Fat Limitation Weight.
        const score = 40 * pNorm + 30 * fibNorm + 20 * calScore + 10 * fatScore;
        f.nutritionScore = Math.max(0, Math.min(100, Math.round(score * 100) / 100));
    });
}

/**
 * 7. RECOMMENDATION ALGORITHM
 */

/**
 * Assigns meal suitability score (10 to 100) based on categories and item keywords.
 */
function getMealSuitabilityScore(food, mealType) {
    const category = food.category.toLowerCase();
    const name = food.item.toLowerCase();
    
    switch (mealType) {
        case 'breakfast':
            if (category === 'breakfast' || name.includes('egg') || name.includes('banana') || name.includes('sprouts')) {
                return 100;
            }
            if (category === 'indian breads' || name.includes('coffee') || name.includes('tea') || name.includes('milk') || name.includes('juice')) {
                return 75;
            }
            if (category === 'beverages' || category === 'fresh juices') {
                return 40;
            }
            return 10;
            
        case 'lunch':
            if (category === 'lunch' || name.includes('biryani') || name.includes('thali') || name.includes('rice')) {
                return 100;
            }
            if (category === 'curries & dry' || category === 'dry items' || category === 'chinese' || category === 'indian breads') {
                return 80;
            }
            return 10;
            
        case 'snack':
            if (category === 'snacks' || category === 'chat' || category === 'fresh juices' || category === 'beverages') {
                return 100;
            }
            if (name.includes('banana') || name.includes('samosa') || name.includes('vada') || name.includes('idly') || name.includes('pongal') || name.includes('upma') || name.includes('bhaji') || name.includes('pav')) {
                return 80;
            }
            return 10;
            
        case 'dinner':
            // Dinner allows lunch items, curries, breads, chinese, biryanis
            if (category === 'lunch' || category === 'curries & dry' || category === 'dry items' || category === 'indian breads' || category === 'chinese' || name.includes('roti') || name.includes('naan') || name.includes('chapati') || name.includes('biryani') || name.includes('fried rice')) {
                return 100;
            }
            if (category === 'breakfast') { // e.g. dosas/idly at night
                return 50;
            }
            return 10;
            
        default:
            return 50;
    }
}

/**
 * Computes recommendations for the current meal.
 * Sorted by: baseScore + explorationBonus descending.
 */
function getRecommendations(mealType) {
    if (state.foodDb.length === 0) return [];
    
    const candidates = state.foodDb.map(food => {
        const nutrition = food.nutritionScore; // 0-100
        const ratingVal = state.ratings[food.id]; // 1-5 or undefined
        
        // Map rating to 0-100 scale; use neutral 60 for unrated
        const ratingScore = ratingVal ? (ratingVal * 20) : 60; 
        const suitability = getMealSuitabilityScore(food, mealType); // 10-100
        
        // Base Score calculation (max 100)
        // 60% Nutrition, 25% User rating, 15% Meal suitability
        const baseScore = 0.60 * nutrition + 0.25 * ratingScore + 0.15 * suitability;
        
        // Exploration component: unrated foods receive slightly larger random range (0-10) 
        // to encourage tasting, while rated foods shuffle slightly (0-3). 
        // Small ranges guarantee recommendation invariants (e.g. low-nutrition/low-rating food won't outrank healthy/five-star food).
        const isRated = ratingVal !== undefined;
        const explorationBonus = Math.random() * (isRated ? 3 : 10);
        
        const finalScore = baseScore + explorationBonus;
        
        return {
            food,
            isRated,
            baseScore,
            explorationBonus,
            finalScore
        };
    });
    
    // Sort descending by finalScore
    candidates.sort((a, b) => b.finalScore - a.finalScore);
    
    // Return top 5
    return candidates.slice(0, 5);
}

/**
 * 8. REAL-TIME DATA BINDINGS & VIEW RENDERING
 */

function renderDashboard() {
    const fin = calculateFinance();
    console.log(fin)
    // Bind main financial values
    document.getElementById('db-start-balance').textContent = `₹${state.settings.startingBalance.toFixed(2)}`;
    document.getElementById('db-total-spent').textContent = `₹${fin.totalSpent.toFixed(2)}`;
    
    const curBalEl = document.getElementById('db-current-balance');
    curBalEl.textContent = `₹${fin.currentBalance.toFixed(2)}`;
    if (fin.currentBalance < 0) {
        curBalEl.classList.add('text-negative');
        curBalEl.classList.remove('text-positive');
    } else {
        curBalEl.classList.add('text-positive');
        curBalEl.classList.remove('text-negative');
    }
    
    document.getElementById('db-days-remaining').textContent = fin.daysRemaining;
    document.getElementById('db-today-budget').textContent = `₹${fin.todayBudget.toFixed(2)}`;
    
    // Render Period Banners
    const bannerEl = document.getElementById('period-status-banner');
    if (fin.isBeforePeriod) {
        bannerEl.style.display = 'block';
        bannerEl.className = 'status-banner banner-warning';
        bannerEl.innerHTML = `📅 Budget period has not started yet. Starts on: <strong>${state.settings.startDate}</strong>. Adding items to eating log is disabled.`;
    } else if (fin.isAfterPeriod) {
        bannerEl.style.display = 'block';
        bannerEl.className = 'status-banner banner-error';
        bannerEl.innerHTML = `📅 Budget period ended on: <strong>${state.settings.endDate}</strong>. Adding items to eating log is disabled.`;
    } else {
        bannerEl.style.display = 'none';
    }
}

function renderCurrentMeal() {
    const fin = calculateFinance();
    const meal = state.currentMeal;
    
    // Update prominent UI values
    const capitalizedMealName = meal.charAt(0).toUpperCase() + meal.slice(1);
    document.getElementById('lbl-current-meal-title').textContent = capitalizedMealName;
    
    const budget = fin.mealBudgets[meal] || 0;
    const spent = fin.spentTodayByMeal[meal] || 0;
    const remaining = budget - spent;
    
    document.getElementById('meal-budget-val').textContent = `₹${fin.todayBudget.toFixed(2)}`;
    document.getElementById('meal-spent-val').textContent = `₹${fin.spentTodayTotal}`;
    
    const remainingValEl = document.getElementById('meal-remaining-val');
    remainingValEl.textContent = `₹${(fin.todayBudget - fin.spentTodayTotal).toFixed(2)}`;
    
    const mealBudgetCard = document.getElementById('current-meal-card');
    if (remaining < 0) {
        remainingValEl.className = 'val text-negative';
        mealBudgetCard.classList.add('budget-alert-over');
        mealBudgetCard.classList.remove('budget-alert-under');
    } else {
        remainingValEl.className = 'val text-positive';
        mealBudgetCard.classList.add('budget-alert-under');
        mealBudgetCard.classList.remove('budget-alert-over');
    }
    
    // Set time window indicators
    const times = state.settings.mealTimes[meal];
    document.getElementById('meal-time-window').textContent = `(${times[0]} – ${times[1]})`;
    
    // Render Mini Meal Grid spent values in dashboard
    ['breakfast', 'lunch', 'snack', 'dinner'].forEach(m => {
        const mBudget = fin.mealBudgets[m] || 0;
        const mSpent = fin.spentTodayByMeal[m] || 0;
        const mRem = mBudget - mSpent;
        
        document.getElementById(`grid-budget-${m}`).textContent = `₹${mBudget.toFixed(0)}`;
        document.getElementById(`grid-spent-${m}`).textContent = `₹${mSpent.toFixed(0)}`;
        
        const mRemEl = document.getElementById(`grid-rem-${m}`);
        mRemEl.textContent = `₹${mRem.toFixed(0)}`;
        mRemEl.className = mRem < 0 ? 'text-negative text-bold' : 'text-positive text-bold';
    });
}

function renderRecommendations() {
    const recs = getRecommendations(state.currentMeal);
    const container = document.getElementById('recommendations-grid');
    if (!container) return;
    
    if (recs.length === 0) {
        container.innerHTML = `<div class="empty-state">No foods loaded to recommend.</div>`;
        return;
    }
    
    const fin = calculateFinance();
    const disabled = fin.isOutOfPeriod ? 'disabled title="Disabled outside budget period"' : '';
    
    container.innerHTML = recs.map(rec => {
        const f = rec.food;
        const rating = state.ratings[f.id] || 0;
        
        return `
            <div class="food-card rec-card">
                <div class="card-badge">Top Rec</div>
                <div class="food-card-header">
                    <span class="food-category-badge">${f.category}</span>
                    <span class="food-price">₹${f.price}</span>
                </div>
                <h4 class="food-name">${f.item}</h4>
                <div class="nutrition-score-row">
                    <span class="score-label">Nutrition Score:</span>
                    <span class="score-value score-${getScoreColorClass(f.nutritionScore)}">${f.nutritionScore.toFixed(0)}</span>
                </div>
                <div class="rating-row" data-id="${f.id}">
                    ${renderStarWidget(f.id, rating)}
                </div>
                <div class="card-footer">
                    <button class="btn btn-primary btn-sm eat-btn" data-id="${f.id}" ${disabled}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                        Eat
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function getScoreColorClass(score) {
    if (score >= 70) return 'high';
    if (score >= 45) return 'med';
    return 'low';
}

function renderStarWidget(foodId, rating) {
    let starsHtml = '';
    for (let i = 1; i <= 5; i++) {
        const active = i <= rating ? 'active' : '';
        starsHtml += `<span class="star ${active}" data-val="${i}">★</span>`;
    }
    return `<div class="star-rating" data-id="${foodId}">${starsHtml}</div>`;
}

function renderFilters() {
    const selectCat = document.getElementById('filter-category');
    if (!selectCat) return;
    
    // Save current selected category
    const currentVal = state.filters.category;
    
    // Find unique categories from CSV
    const categories = new Set();
    state.foodDb.forEach(f => {
        if (f.category) categories.add(f.category);
    });
    
    const sortedCats = Array.from(categories).sort();
    
    // Re-fill category select
    let optionsHtml = '<option value="all">All Categories</option>';
    sortedCats.forEach(cat => {
        const selected = cat === currentVal ? 'selected' : '';
        optionsHtml += `<option value="${cat}" ${selected}>${cat}</option>`;
    });
    
    selectCat.innerHTML = optionsHtml;
}

function renderFoodCatalog() {
    const container = document.getElementById('catalog-grid');
    if (!container) return;
    
    if (state.foodDb.length === 0) {
        container.innerHTML = `<div class="empty-state">Loading food catalog...</div>`;
        return;
    }
    
    const fin = calculateFinance();
    const disabled = fin.isOutOfPeriod ? 'disabled title="Disabled outside budget period"' : '';
    
    // Filter database
    const filtered = state.foodDb.filter(f => {
        // 1. Search text filter (Item and Category case-insensitive)
        if (state.filters.search) {
            const query = state.filters.search.toLowerCase();
            const matchesName = f.item.toLowerCase().includes(query);
            const matchesCat = f.category.toLowerCase().includes(query);
            if (!matchesName && !matchesCat) return false;
        }
        
        // 2. Category filter
        if (state.filters.category !== 'all') {
            if (f.category !== state.filters.category) return false;
        }
        
        // 3. Suitability filter
        if (state.filters.suitability !== 'all') {
            const targetMeal = state.filters.suitability === 'current' ? state.currentMeal : state.filters.suitability;
            const score = getMealSuitabilityScore(f, targetMeal);
            if (score < 40) return false; // Hide unsuitable items (scores less than 40) when filtered
        }
        
        return true;
    });
    
    if (filtered.length === 0) {
        container.innerHTML = `<div class="empty-state">No matching foods found in catalog.</div>`;
        return;
    }
    
    container.innerHTML = filtered.map(f => {
        const rating = state.ratings[f.id] || 0;
        
        return `
            <div class="food-card ${rating === 0 ? 'card-unrated' : ''}">
                <div class="food-card-header">
                    <span class="food-category-badge">${f.category}</span>
                    <span class="food-price">₹${f.price}</span>
                </div>
                <h4 class="food-name" title="${f.item}">${f.item}</h4>
                <div class="food-card-meta">Serving Size: ${f.servingSize}g</div>
                
                <div class="nutrition-score-row">
                    <span class="score-label">Nutrition Score:</span>
                    <span class="score-value score-${getScoreColorClass(f.nutritionScore)}">${f.nutritionScore.toFixed(0)}</span>
                </div>
                
                <div class="nutrition-details-row">
                    <span class="nut-val" title="Calories">🔥 ${f.calories.toFixed(0)} kcal</span>
                    <span class="nut-val" title="Protein">🥚 P: ${f.protein.toFixed(0)}g</span>
                    <span class="nut-val" title="Fiber">🌾 F: ${f.fiber.toFixed(0)}g</span>
                </div>
                
                <div class="rating-row">
                    ${renderStarWidget(f.id, rating)}
                </div>
                <div class="card-footer">
                    <button class="btn btn-primary btn-sm eat-btn" data-id="${f.id}" ${disabled}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                        Eat
                    </button>
                    <button class="btn btn-outline btn-sm details-btn" data-id="${f.id}">Details</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderHistory() {
    const listContainer = document.getElementById('history-list');
    if (!listContainer) return;
    
    if (state.eaten.length === 0) {
        listContainer.innerHTML = `<div class="empty-state">No eating records recorded yet. Your meals will appear here.</div>`;
        return;
    }
    
    // Group records by Date local timezone
    const groups = {}; // dateStr -> records array
    
    
    state.eaten.forEach(([foodId, timestamp, savedPrice, customName], index) => {
        const food = state.foodMap[foodId];
        const datePart = timestamp.substring(0, 8); // YYYYMMDD
        
        // Parse date for clean header display
        const year = parseInt(datePart.substring(0, 4));
        const month = parseInt(datePart.substring(4, 6));
        const day = parseInt(datePart.substring(6, 8));
        
        const dateObj = new Date(year, month - 1, day);
        const headerStr = dateObj.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        
        const hr = timestamp.substring(8, 10);
        const min = timestamp.substring(10, 12);
        const timeStr = `${hr}:${min}`;
        
        if (!groups[datePart]) {
            groups[datePart] = {
                title: headerStr,
                records: []
            };
        }
        groups[datePart].records.push({
            index, // Keep global index in state.eaten for removal
            foodId,
            foodItem: getEatenRecordName(foodId, customName),
            foodCategory: food ? food.category : (isCustomFoodId(foodId) ? 'Custom item' : 'N/A'),
            price: getEatenRecordPrice(foodId, savedPrice),
            time: isFoodCourtLedgerEntry(foodId) ? '—' : timeStr,
            meal: getEntryMealLabel(state.eaten[index])
        });
    });
    
    // Sort groups newest first
    const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    
    let html = '';
    sortedDates.forEach(dateKey => {
        const group = groups[dateKey];
        // Sort items inside group newest first (highest index first)
        group.records.sort((a, b) => b.index - a.index);
        
        let itemsHtml = group.records.map(rec => `
            <div class="history-item">
                <div class="history-item-left">
                    <span class="history-time">${rec.time}</span>
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <span class="history-name">${escapeHTML(rec.foodItem)}</span>
                        <span class="history-category">${escapeHTML(rec.foodCategory)} · ${escapeHTML(rec.meal)}</span>
                    </div>
                </div>
                <div class="history-item-right">
                    <span class="history-price">₹${rec.price.toFixed(2)}</span>
                    <button class="btn btn-outline btn-xs edit-history-btn" data-index="${rec.index}" title="Edit date and time">✏️ Edit</button>
                    <button class="delete-history-btn" data-index="${rec.index}" title="Remove entry">×</button>
                </div>
            </div>
        `).join('');
        
        html += `
            <div class="history-group">
                <div class="history-group-header">${group.title}</div>
                <div class="history-group-items">${itemsHtml}</div>
            </div>
        `;
    });
    
    listContainer.innerHTML = html;
}

function renderSettingsForm() {
    document.getElementById('set-start-date').value = state.settings.startDate;
    document.getElementById('set-end-date').value = state.settings.endDate;
    document.getElementById('set-start-balance').value = state.settings.startingBalance;
    
    // Weights
    document.getElementById('set-weight-breakfast').value = state.settings.mealWeights.breakfast;
    document.getElementById('set-weight-lunch').value = state.settings.mealWeights.lunch;
    document.getElementById('set-weight-snack').value = state.settings.mealWeights.snack;
    document.getElementById('set-weight-dinner').value = state.settings.mealWeights.dinner;
    
    // Update Percentage Preview
    const pct = getWeightPercentages(state.settings.mealWeights);
    document.getElementById('pct-breakfast').textContent = `${pct.breakfast}%`;
    document.getElementById('pct-lunch').textContent = `${pct.lunch}%`;
    document.getElementById('pct-snack').textContent = `${pct.snack}%`;
    document.getElementById('pct-dinner').textContent = `${pct.dinner}%`;
    
    // Times
    document.getElementById('set-time-breakfast-start').value = state.settings.mealTimes.breakfast[0];
    document.getElementById('set-time-breakfast-end').value = state.settings.mealTimes.breakfast[1];
    
    document.getElementById('set-time-lunch-start').value = state.settings.mealTimes.lunch[0];
    document.getElementById('set-time-lunch-end').value = state.settings.mealTimes.lunch[1];
    
    document.getElementById('set-time-snack-start').value = state.settings.mealTimes.snack[0];
    document.getElementById('set-time-snack-end').value = state.settings.mealTimes.snack[1];
    
    document.getElementById('set-time-dinner-start').value = state.settings.mealTimes.dinner[0];
    document.getElementById('set-time-dinner-end').value = state.settings.mealTimes.dinner[1];
}

function getWeightPercentages(weights) {
    const total = weights.breakfast + weights.lunch + weights.snack + weights.dinner;
    if (total === 0) return { breakfast: 0, lunch: 0, snack: 0, dinner: 0 };
    return {
        breakfast: Math.round((weights.breakfast / total) * 100),
        lunch: Math.round((weights.lunch / total) * 100),
        snack: Math.round((weights.snack / total) * 100),
        dinner: Math.round((weights.dinner / total) * 100)
    };
}

/**
 * 9. NOTIFICATION & TOAST DISPLAYS
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    container.appendChild(toast);
    
    // Trigger entrance transition
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Destroy after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/**
 * 10. ACTION HANDLERS & BUSINESS LOGIC
 */

/**
 * Log eating a food item with double-click protection and budget range check.
 */
function eatFood(foodId) {
    const nowMs = Date.now();
    if (nowMs - lastEatTime < 1000) {
        console.warn("Throttled duplicate eat request.");
        return;
    }
    
    const fin = calculateFinance();
    if (fin.isOutOfPeriod) {
        showToast("Cannot log eating outside the active budget period!", "error");
        return;
    }
    
    const food = state.foodMap[foodId];
    if (!food) {
        showToast("Error: Food not found in database.", "error");
        return;
    }
    
    // Update throttle timestamp
    lastEatTime = nowMs;
    
    const localNow = new Date();
    const timestamp = getLocalTimestamp(localNow);
    
    // Add to eating records: [foodID, YYYYMMDDHHMM, priceAtPurchase]
    state.eaten.push([foodId, timestamp, food.price]);
    saveUserData();
    
    // Recalculate and re-render
    triggerFullUIRender();
    showToast(`Logged eating: ${food.item} (₹${food.price})`, "success");
}

/**
 * Update rating for a specific food.
 */
function rateFood(foodId, stars) {
    const parsedStars = parseInt(stars);
    if (parsedStars < 1 || parsedStars > 5) return;
    
    state.ratings[foodId] = parsedStars;
    saveUserData();
    
    // Recalculate recommendations & re-render catalog without losing search input state
    renderRecommendations();
    renderFoodCatalog();
    showToast("Rating updated!", "success");
}

/**
 * Remove a single history record.
 */
function deleteHistoryEntry(index) {
    if (index < 0 || index >= state.eaten.length) return;
    
    const [foodId, , , customName] = state.eaten[index];
    const food = state.foodMap[foodId];
    const itemName = getEatenRecordName(foodId, customName);
    
    state.eaten.splice(index, 1);
    saveUserData();
    
    triggerFullUIRender();
    showToast(`Removed eating entry for ${itemName}`, "info");
}

/**
 * Validates and saves configurations.
 */
function saveSettings(e) {
    e.preventDefault();
    
    const startStr = document.getElementById('set-start-date').value;
    const endStr = document.getElementById('set-end-date').value;
    const balance = parseFloat(document.getElementById('set-start-balance').value);
    
    const bW = parseInt(document.getElementById('set-weight-breakfast').value);
    const lW = parseInt(document.getElementById('set-weight-lunch').value);
    const sW = parseInt(document.getElementById('set-weight-snack').value);
    const dW = parseInt(document.getElementById('set-weight-dinner').value);
    
    const bTime = [document.getElementById('set-time-breakfast-start').value, document.getElementById('set-time-breakfast-end').value];
    const lTime = [document.getElementById('set-time-lunch-start').value, document.getElementById('set-time-lunch-end').value];
    const sTime = [document.getElementById('set-time-snack-start').value, document.getElementById('set-time-snack-end').value];
    const dTime = [document.getElementById('set-time-dinner-start').value, document.getElementById('set-time-dinner-end').value];
    
    // 1. Validations
    if (!startStr || !endStr) {
        showToast("Start and End dates are required.", "error");
        return;
    }
    const start = parseLocalDate(startStr);
    const end = parseLocalDate(endStr);
    if (start > end) {
        showToast("Validation failed: Start date must be on or before the end date.", "error");
        return;
    }
    if (isNaN(balance) || balance < 0) {
        showToast("Starting balance must be greater than or equal to 0.", "error");
        return;
    }
    if (isNaN(bW) || bW < 0 || isNaN(lW) || lW < 0 || isNaN(sW) || sW < 0 || isNaN(dW) || dW < 0) {
        showToast("Meal weights must be non-negative integers.", "error");
        return;
    }
    if (bW + lW + sW + dW === 0) {
        showToast("At least one meal weight must be greater than 0.", "error");
        return;
    }
    
    // Time format checks
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    const timesValid = [bTime, lTime, sTime, dTime].every(win => timeRegex.test(win[0]) && timeRegex.test(win[1]));
    if (!timesValid) {
        showToast("Meal start/end times must be in valid HH:MM format.", "error");
        return;
    }
    
    // Check if start time is before end time for all windows
    const windowsOrderValid = [bTime, lTime, sTime, dTime].every(win => {
        return timeToMinutes(win[0]) < timeToMinutes(win[1]);
    });
    if (!windowsOrderValid) {
        showToast("Meal start time must be earlier than end time.", "error");
        return;
    }
    
    // 2. Commit settings to state
    state.settings = {
        startDate: startStr,
        endDate: endStr,
        startingBalance: balance,
        mealWeights: { breakfast: bW, lunch: lW, snack: sW, dinner: dW },
        mealTimes: { breakfast: bTime, lunch: lTime, snack: sTime, dinner: dTime }
    };
    
    saveUserData();
    triggerFullUIRender();
    showToast("Configuration saved successfully!", "success");
}

/**
 * Reset settings to original code defaults.
 */
function resetSettingsToDefault() {
    state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    saveUserData();
    triggerFullUIRender();
    showToast("Settings reset to defaults.", "info");
}

/**
 * Danger Action: Clear ratings and eating records.
 * Supports BOTH cancellation paths explicitly.
 */
function clearAllUserData() {
    // 1st Confirmation
    const conf1 = confirm("Are you sure you want to clear all eating history and ratings? This will reset your current balance.");
    if (!conf1) {
        showToast("Operation cancelled.", "info");
        return; // Path 1: User cancelled on first prompt
    }
    
    // 2nd Confirmation
    const conf2 = prompt("This action cannot be undone. Type CLEAR to confirm.");
    if (conf2 !== 'CLEAR') {
        showToast("Operation cancelled. Confirmation text did not match.", "warning");
        return; // Path 2: User cancelled, clicked Cancel, or typed anything other than CLEAR
    }
    
    // Proceed with reset
    state.ratings = {};
    state.eaten = [];
    saveUserData();
    
    triggerFullUIRender();
    showToast("All historical logs and food ratings cleared.", "success");
}

/**
 * 11. MODAL DETAILS CONTROLLER
 */
function openDetailsModal(foodId) {
    const food = state.foodMap[foodId];
    if (!food) return;
    
    const rating = state.ratings[foodId] || 0;
    
    const modalContent = document.getElementById('details-modal-body');
    modalContent.innerHTML = `
        <div class="modal-title-row">
            <h3>${food.item}</h3>
            <span class="food-category-badge" style="font-size: 14px;">${food.category}</span>
        </div>
        <p class="modal-desc" style="color:var(--text-secondary); margin-bottom:20px; font-style:italic;">${food.info || 'No details description available.'}</p>
        
        <div class="modal-grid">
            <div class="modal-metric-card">
                <span class="label">Price</span>
                <span class="val" style="color: var(--accent-light);">₹${food.price}</span>
            </div>
            <div class="modal-metric-card">
                <span class="label">Serving Size</span>
                <span class="val">${food.servingSize}g</span>
            </div>
            <div class="modal-metric-card">
                <span class="label">Nutrition Score</span>
                <span class="val score-${getScoreColorClass(food.nutritionScore)}" style="font-weight: 700;">${food.nutritionScore.toFixed(0)}</span>
            </div>
            <div class="modal-metric-card">
                <span class="label">Your Rating</span>
                <span class="val">${rating > 0 ? '★'.repeat(rating) + '☆'.repeat(5 - rating) : 'Unrated'}</span>
            </div>
        </div>
        
        <h4 style="margin-top:20px; border-bottom:1px solid var(--border-color); padding-bottom:5px;">Nutrition Composition</h4>
        <div class="nut-details-grid">
            <div class="nut-detail-bar-row">
                <span class="label">🔥 Calories</span>
                <span class="val">${food.calories.toFixed(1)} kcal</span>
            </div>
            <div class="nut-detail-bar-row">
                <span class="label">🥚 Protein</span>
                <span class="val">${food.protein.toFixed(1)} g</span>
            </div>
            <div class="nut-detail-bar-row">
                <span class="label">🌾 Fiber</span>
                <span class="val">${food.fiber.toFixed(1)} g</span>
            </div>
            <div class="nut-detail-bar-row">
                <span class="label">🍞 Carbohydrates</span>
                <span class="val">${food.carbs.toFixed(1)} g</span>
            </div>
            <div class="nut-detail-bar-row">
                <span class="label">🥑 Fats</span>
                <span class="val">${food.fat.toFixed(1)} g</span>
            </div>
        </div>
        
        ${food.notes ? `
        <h4 style="margin-top:20px; border-bottom:1px solid var(--border-color); padding-bottom:5px;">Preparation Notes</h4>
        <p style="font-size:13px; color:var(--text-secondary); line-height:1.4; margin-top:5px;">${food.notes}</p>
        ` : ''}
    `;
    
    document.getElementById('details-modal').classList.add('open');
}

function closeDetailsModal() {
    document.getElementById('details-modal').classList.remove('open');
}

/**
 * 12. EDIT EATING HISTORY CONTROLLER
 */
let editingHistoryIndex = -1;

function openCustomEntryModal() {
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    document.getElementById('custom-entry-form').reset();
    document.getElementById('custom-entry-date').value = localDate;
    document.getElementById('custom-entry-time').value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    document.getElementById('custom-entry-modal').classList.add('open');
    document.getElementById('custom-entry-name').focus();
}

function closeCustomEntryModal() {
    document.getElementById('custom-entry-modal').classList.remove('open');
}

function saveCustomEntry(e) {
    e.preventDefault();
    const name = document.getElementById('custom-entry-name').value.trim();
    const amount = Number(document.getElementById('custom-entry-amount').value);
    const dateVal = document.getElementById('custom-entry-date').value;
    const timeVal = document.getElementById('custom-entry-time').value;

    if (!name || name.length > 100) {
        showToast('Enter an item name up to 100 characters.', 'error');
        return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        showToast('Amount must be greater than ₹0.', 'error');
        return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeVal)) {
        showToast('Enter a valid date and time.', 'error');
        return;
    }

    const [year, month, day] = dateVal.split('-').map(Number);
    const checkDate = new Date(year, month - 1, day);
    if (checkDate.getFullYear() !== year || checkDate.getMonth() !== month - 1 || checkDate.getDate() !== day) {
        showToast('Enter a valid calendar date.', 'error');
        return;
    }
    if (dateVal < state.settings.startDate || dateVal > state.settings.endDate) {
        showToast('Custom purchases must be within the active budget period.', 'error');
        return;
    }

    const [hour, minute] = timeVal.split(':');
    const timestamp = `${String(year).padStart(4, '0')}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}${hour}${minute}`;
    const foodId = `custom:${name.toLocaleLowerCase()}`;
    state.eaten.push([foodId, timestamp, amount, name]);
    saveUserData();
    triggerFullUIRender();
    closeCustomEntryModal();
    showToast(`Logged custom purchase: ${name} (₹${amount.toFixed(2)})`, 'success');
}

let pendingBulkImport = null;

function parseLedgerMoney(value) {
    const cleaned = String(value || '').replace(/[₹,\s]/g, '').replace(/\(Dr\)/ig, '');
    if (!cleaned) return 0;
    if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) return null;
    return Math.round(Number(cleaned) * 100);
}

function parseLedgerDate(value) {
    const match = String(value || '').trim().match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s*(\d{4})$/i);
    if (!match) return null;
    const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
    const year = Number(match[3]);
    const month = months[match[1].toLowerCase()];
    const day = Number(match[2]);
    const check = new Date(year, month - 1, day);
    if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) return null;
    return `${String(year).padStart(4, '0')}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
}

function parseFoodCourtLedger(text) {
    const entries = [];
    const errors = [];
    const lines = text.split(/\r?\n/);

    lines.forEach((line, index) => {
        if (!/\bEx[\w-]+\b/i.test(line)) return;
        const cells = line.includes('|')
            ? line.split('|').map(cell => cell.trim()).filter((cell, i, all) => !(cell === '' && (i === 0 || i === all.length - 1)))
            : line.split('\t').map(cell => cell.trim());
        const voucher = cells[0] || '';
        if (!/^Ex[\w-]+$/i.test(voucher) || cells.length < 6) {
            errors.push(`Line ${index + 1}: couldn't read the voucher, date, credit, debit, and closing-balance columns.`);
            return;
        }

        const date = parseLedgerDate(cells[1]);
        const creditCents = parseLedgerMoney(cells[3]);
        const debitCents = parseLedgerMoney(cells[4]);
        const closingCents = parseLedgerMoney(cells[5]);
        if (!date || creditCents === null || debitCents === null || closingCents === null || closingCents < 0) {
            errors.push(`Line ${index + 1} (${voucher}): invalid date or amount in the report row.`);
            return;
        }
        if (creditCents === 0 && debitCents === 0) {
            errors.push(`Line ${index + 1} (${voucher}): row has no credit or debit amount.`);
            return;
        }
        entries.push({ voucher, date, description: cells[2], creditCents, debitCents, closingCents, lineNumber: index + 1 });
    });

    if (entries.length === 0 && errors.length === 0) {
        errors.push('No ledger rows found. Paste the report table, including its voucher rows.');
    }

    let calculatedClosingCents = null;
    if (entries.length > 0) {
        // The first pasted row establishes the chunk's opening checkpoint. Every following
        // row must reconcile exactly, which also makes contiguous chunks independently verifiable.
        calculatedClosingCents = entries[0].closingCents;
        for (let i = 1; i < entries.length; i++) {
            const row = entries[i];
            calculatedClosingCents += row.creditCents - row.debitCents;
            if (calculatedClosingCents !== row.closingCents) {
                errors.push(`Line ${row.lineNumber} (${row.voucher}): calculated closing balance is ₹${(calculatedClosingCents / 100).toFixed(2)}, but the report shows ₹${(row.closingCents / 100).toFixed(2)}. Paste a smaller continuous chunk around this row to find the missing or incorrect line.`);
            }
        }
    }

    return { entries, errors, calculatedClosingCents };
}

function ledgerDuplicateKey(date, amountCents, closingCents) {
    return `${date}|${amountCents}|${closingCents}`;
}

function inferLedgerMeals(entries) {
    const averages = Object.fromEntries(MEAL_TYPES.map(meal => [meal, { totalCents: 0, count: 0 }]));
    state.eaten.forEach(record => {
        const meal = getEntryMealType(record);
        if (!meal) return;
        const cents = Math.round(getEatenRecordPrice(record[0], record[2]) * 100);
        averages[meal].totalCents += cents;
        averages[meal].count++;
    });

    const byDate = new Map();
    entries.forEach(entry => {
        if (!byDate.has(entry.date)) byDate.set(entry.date, []);
        byDate.get(entry.date).push(entry);
    });
    const sparseDays = [];
    const addSample = (meal, entry) => {
        averages[meal].totalCents += entry.debitCents;
        averages[meal].count++;
        entry.meal = meal;
    };
    const chronological = rows => rows.slice().sort((a, b) => {
        const aVoucher = Number(a.voucher.replace(/\D/g, ''));
        const bVoucher = Number(b.voucher.replace(/\D/g, ''));
        return aVoucher - bVoucher;
    });

    byDate.forEach(rows => {
        const ordered = chronological(rows);
        if (ordered.length < 3) {
            sparseDays.push(ordered);
            return;
        }

        let groups = ordered.map(entry => [entry]);
        if (ordered.length === 3 || ordered.length === 4) {
            groups = ordered.map(entry => [entry]);
        } else {
            while (groups.length > 4) {
                let closestIndex = 0;
                let closestGap = Infinity;
                for (let i = 0; i < groups.length - 1; i++) {
                    const left = Number(groups[i][groups[i].length - 1].voucher.replace(/\D/g, ''));
                    const right = Number(groups[i + 1][0].voucher.replace(/\D/g, ''));
                    const gap = right - left;
                    if (gap < closestGap) {
                        closestGap = gap;
                        closestIndex = i;
                    }
                }
                groups[closestIndex] = groups[closestIndex].concat(groups[closestIndex + 1]);
                groups.splice(closestIndex + 1, 1);
            }
        }

        const mealOrder = ordered.length === 3 ? ['breakfast', 'lunch', 'dinner'] : MEAL_TYPES;
        groups.forEach((group, index) => {
            const meal = mealOrder[index];
            group.forEach(entry => addSample(meal, entry));
        });
    });

    sparseDays.forEach(rows => rows.forEach(entry => {
        const availableMeals = MEAL_TYPES.filter(meal => averages[meal].count > 0);
        if (availableMeals.length === 0) {
            entry.meal = null;
            return;
        }
        const closestMeal = availableMeals.reduce((best, meal) => {
            const average = averages[meal].totalCents / averages[meal].count;
            const bestAverage = averages[best].totalCents / averages[best].count;
            return Math.abs(entry.debitCents - average) < Math.abs(entry.debitCents - bestAverage) ? meal : best;
        }, availableMeals[0]);
        entry.meal = closestMeal;
    }));

    return entries;
}

function prepareBulkLedgerImport(text) {
    const parsed = parseFoodCourtLedger(text);
    if (parsed.errors.length > 0) return { ...parsed, duplicates: 0, newEntries: [] };

    const debitEntries = parsed.entries.filter(entry => entry.debitCents > 0);
    if (debitEntries.length === 0) {
        return { ...parsed, errors: ['No debit/purchase rows found to import.'], duplicates: 0, newEntries: [] };
    }
    inferLedgerMeals(debitEntries);

    const seen = new Set();
    state.eaten.forEach(([foodId, timestamp, amount, , closingCents, , originalAmountCents, originalDate]) => {
        if (!isCustomFoodId(foodId) || !Number.isFinite(closingCents)) return;
        const matchDate = typeof originalDate === 'string' ? originalDate : timestamp.substring(0, 8);
        const matchAmount = Number.isFinite(originalAmountCents) ? originalAmountCents : Math.round(amount * 100);
        seen.add(ledgerDuplicateKey(matchDate, matchAmount, closingCents));
    });

    let duplicates = 0;
    const newEntries = [];
    debitEntries.forEach(entry => {
        const key = ledgerDuplicateKey(entry.date, entry.debitCents, entry.closingCents);
        if (seen.has(key)) {
            duplicates++;
            return;
        }
        seen.add(key);
        newEntries.push([
            `custom:food-court-ledger:${entry.voucher.toLowerCase()}`,
            `${entry.date}0000`,
            entry.debitCents / 100,
            `${entry.description || 'Food Court Purchase'} · ${entry.voucher}`,
            entry.closingCents,
            entry.voucher,
            entry.debitCents,
            entry.date,
            entry.meal || null
        ]);
    });

    return { ...parsed, debitEntries, duplicates, newEntries };
}

function openBulkLedgerModal() {
    document.getElementById('bulk-ledger-text').value = '';
    document.getElementById('bulk-ledger-preview').textContent = '';
    document.getElementById('bulk-ledger-preview').style.display = 'none';
    document.getElementById('bulk-ledger-import-btn').style.display = 'none';
    pendingBulkImport = null;
    document.getElementById('bulk-ledger-modal').classList.add('open');
    document.getElementById('bulk-ledger-text').focus();
}

function closeBulkLedgerModal() {
    document.getElementById('bulk-ledger-modal').classList.remove('open');
    pendingBulkImport = null;
}

function previewBulkLedgerImport() {
    const text = document.getElementById('bulk-ledger-text').value;
    const result = prepareBulkLedgerImport(text);
    const preview = document.getElementById('bulk-ledger-preview');
    const importButton = document.getElementById('bulk-ledger-import-btn');
    preview.style.display = 'block';
    importButton.style.display = 'none';
    pendingBulkImport = null;

    if (result.errors.length > 0) {
        preview.textContent = `Import stopped. No rows were added.\n\n${result.errors.join('\n')}`;
        return;
    }

    const totalDebitsCents = result.debitEntries.reduce((sum, entry) => sum + entry.debitCents, 0);
    const mealSummary = MEAL_TYPES.map(meal => {
        const count = result.debitEntries.filter(entry => entry.meal === meal).length;
        return count ? `${meal}: ${count}` : null;
    }).filter(Boolean);
    const unassignedCount = result.debitEntries.filter(entry => !entry.meal).length;
    if (unassignedCount > 0) mealSummary.push(`unassigned: ${unassignedCount}`);
    const lines = [
        `Validated ${result.entries.length} ledger rows.`,
        `Purchase rows: ${result.debitEntries.length} (₹${(totalDebitsCents / 100).toFixed(2)} total)`,
        `Already imported: ${result.duplicates}`,
        `New purchases to add: ${result.newEntries.length}`,
        `Inferred meals (editable in History): ${mealSummary.join(', ') || 'none'}`,
        `Calculated final ledger balance: ₹${(result.calculatedClosingCents / 100).toFixed(2)} (matches the last report row).`,
        '',
        'The app budget settings will not change.'
    ];
    preview.textContent = lines.join('\n');

    if (result.newEntries.length > 0) {
        pendingBulkImport = result;
        importButton.textContent = `Import ${result.newEntries.length} new purchase${result.newEntries.length === 1 ? '' : 's'}`;
        importButton.style.display = 'inline-flex';
    }
}

function commitBulkLedgerImport() {
    if (!pendingBulkImport || pendingBulkImport.errors.length > 0) return;
    const entries = pendingBulkImport.newEntries;
    state.eaten.push(...entries);
    saveUserData();
    triggerFullUIRender();
    closeBulkLedgerModal();
    showToast(`Imported ${entries.length} food court purchase${entries.length === 1 ? '' : 's'}.`, 'success');
}

function openEditHistoryModal(index) {
    if (index < 0 || index >= state.eaten.length) return;
    editingHistoryIndex = index;
    
    const [foodId, timestamp, savedPrice, customName] = state.eaten[index];
    const food = state.foodMap[foodId];
    
    const itemName = getEatenRecordName(foodId, customName);
    const itemPrice = getEatenRecordPrice(foodId, savedPrice);
    document.getElementById('edit-modal-item-name').textContent = itemName;
    document.getElementById('edit-modal-item-category').textContent = food ? food.category : (isCustomFoodId(foodId) ? 'Custom item' : 'N/A');
    document.getElementById('edit-modal-item-price').textContent = `₹${itemPrice.toFixed(2)}`;
    document.getElementById('edit-record-name').value = itemName;
    document.getElementById('edit-record-price').value = itemPrice.toFixed(2);
    const mealOverride = getEntryMealOverride(state.eaten[index]);
    document.getElementById('edit-record-meal').value = MEAL_TYPES.includes(mealOverride)
        ? mealOverride
        : (mealOverride === 'unassigned' || isFoodCourtLedgerEntry(foodId) ? 'unassigned' : 'auto');
    
    const yyyy = timestamp.substring(0, 4);
    const mm = timestamp.substring(4, 6);
    const dd = timestamp.substring(6, 8);
    const hh = timestamp.substring(8, 10);
    const min = timestamp.substring(10, 12);
    
    document.getElementById('edit-record-date').value = `${yyyy}-${mm}-${dd}`;
    document.getElementById('edit-record-time').value = `${hh}:${min}`;
    
    document.getElementById('edit-history-modal').classList.add('open');
}

function closeEditHistoryModal() {
    document.getElementById('edit-history-modal').classList.remove('open');
    editingHistoryIndex = -1;
}

function saveEditHistory(e) {
    e.preventDefault();
    if (editingHistoryIndex < 0 || editingHistoryIndex >= state.eaten.length) return;
    
    const dateVal = document.getElementById('edit-record-date').value;
    const timeVal = document.getElementById('edit-record-time').value;
    const nameVal = document.getElementById('edit-record-name').value.trim();
    const priceText = document.getElementById('edit-record-price').value.trim();
    const priceVal = Number(priceText);
    const mealVal = document.getElementById('edit-record-meal').value;

    if (!nameVal || nameVal.length > 100) {
        showToast('Enter an item name up to 100 characters.', 'error');
        return;
    }
    if (!priceText || !Number.isFinite(priceVal) || priceVal < 0) {
        showToast('Price must be a valid amount greater than or equal to ₹0.', 'error');
        return;
    }
    
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
        showToast("Invalid date format.", "error");
        return;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeVal)) {
        showToast("Invalid time format.", "error");
        return;
    }
    
    const [y, m, d] = dateVal.split('-').map(Number);
    const testDate = new Date(y, m - 1, d);
    if (isNaN(testDate.getTime()) || testDate.getMonth() !== m - 1 || testDate.getDate() !== d) {
        showToast("Invalid calendar date.", "error");
        return;
    }
    
    const [hh, mm] = timeVal.split(':');
    const newTimestamp = `${String(y).padStart(4, '0')}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}${hh}${mm}`;
    
    // In-place replacement: keep original foodID, replace only timestamp
    const [foodId, , , , ...metadata] = state.eaten[editingHistoryIndex];
    if (isFoodCourtLedgerEntry(foodId)) {
        metadata[4] = MEAL_TYPES.includes(mealVal) ? mealVal : null;
    } else {
        metadata[0] = mealVal === 'auto' ? null : mealVal;
    }
    state.eaten[editingHistoryIndex] = [foodId, newTimestamp, priceVal, nameVal, ...metadata];
    
    saveUserData();
    triggerFullUIRender();
    closeEditHistoryModal();
    showToast("Eating record updated successfully!", "success");
}

/**
 * 13. ANALYTICS & CHART.JS VISUALIZATIONS
 */
const chartInstances = {
    balanceTrend: null,
    dailySpending: null,
    mealSpending: null,
    categorySpending: null
};

function renderAnalytics() {
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js is not loaded.");
        return;
    }

    const start = parseLocalDate(state.settings.startDate);
    const end = parseLocalDate(state.settings.endDate);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);

    const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    
    let daysElapsed = 0;
    if (today < start) {
        daysElapsed = 0;
    } else if (today > end) {
        daysElapsed = totalDays;
    } else {
        daysElapsed = Math.round((today.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    }

    const startingBalance = state.settings.startingBalance;
    const dailyExpectedBurn = totalDays > 0 ? (startingBalance / totalDays) : 0;
    const expectedSpendToDate = daysElapsed * dailyExpectedBurn;
    const expectedBalanceToDate = Math.max(0, startingBalance - expectedSpendToDate);

    let totalSpent = 0;
    const dailySpendMap = {};
    const mealSpendMap = { breakfast: 0, lunch: 0, snack: 0, dinner: 0 };
    const categorySpendMap = {};
    const foodCountMap = {};
    const foodSpendMap = {};
    const foodNameMap = {};

    state.eaten.forEach(record => {
        const [foodId, timestamp, savedPrice, customName] = record;
        const food = state.foodMap[foodId];
        const price = getEatenRecordPrice(foodId, savedPrice);
        totalSpent += price;

        const dateStr = timestamp.substring(0, 8);
        dailySpendMap[dateStr] = (dailySpendMap[dateStr] || 0) + price;

        const mealType = getEntryMealType(record);
        if (mealType) {
            mealSpendMap[mealType] = (mealSpendMap[mealType] || 0) + price;
        }

        const cat = food ? food.category : (isCustomFoodId(foodId) ? 'Custom item' : 'Other');
        categorySpendMap[cat] = (categorySpendMap[cat] || 0) + price;

        foodCountMap[foodId] = (foodCountMap[foodId] || 0) + 1;
        foodSpendMap[foodId] = (foodSpendMap[foodId] || 0) + price;
        foodNameMap[foodId] = getEatenRecordName(foodId, customName);
    });

    const actualBalance = startingBalance - totalSpent;

    // Populate KPIs
    const anTotalSpentEl = document.getElementById('an-total-spent');
    if (anTotalSpentEl) anTotalSpentEl.textContent = `₹${totalSpent.toFixed(2)}`;
    const spentPct = startingBalance > 0 ? Math.round((totalSpent / startingBalance) * 100) : 0;
    const anSpentPctEl = document.getElementById('an-spent-pct');
    if (anSpentPctEl) anSpentPctEl.textContent = `${spentPct}% of ₹${startingBalance.toFixed(0)} Budget`;

    const anExpectedSpentEl = document.getElementById('an-expected-spent');
    if (anExpectedSpentEl) anExpectedSpentEl.textContent = `₹${expectedSpendToDate.toFixed(2)}`;
    const spendDiff = expectedSpendToDate - totalSpent;
    const spendDiffEl = document.getElementById('an-spend-diff');
    if (spendDiffEl) {
        if (spendDiff >= 0) {
            spendDiffEl.textContent = `₹${spendDiff.toFixed(2)} under expected (Surplus)`;
            spendDiffEl.className = 'metric-subtext text-positive';
        } else {
            spendDiffEl.textContent = `₹${Math.abs(spendDiff).toFixed(2)} over expected (Deficit)`;
            spendDiffEl.className = 'metric-subtext text-negative';
        }
    }

    const anExpectedBalEl = document.getElementById('an-expected-balance');
    if (anExpectedBalEl) anExpectedBalEl.textContent = `₹${expectedBalanceToDate.toFixed(2)}`;
    const balanceStatusEl = document.getElementById('an-balance-status');
    if (balanceStatusEl) {
        if (actualBalance >= expectedBalanceToDate) {
            balanceStatusEl.textContent = `Actual: ₹${actualBalance.toFixed(2)} (Ahead)`;
            balanceStatusEl.className = 'metric-subtext text-positive';
        } else {
            balanceStatusEl.textContent = `Actual: ₹${actualBalance.toFixed(2)} (Behind)`;
            balanceStatusEl.className = 'metric-subtext text-negative';
        }
    }

    const effectiveDays = Math.max(1, daysElapsed);
    const avgDailySpend = daysElapsed > 0 ? (totalSpent / effectiveDays) : 0;
    const anAvgDailyEl = document.getElementById('an-avg-daily');
    if (anAvgDailyEl) anAvgDailyEl.textContent = `₹${avgDailySpend.toFixed(2)}/day`;
    const anTargetDailyEl = document.getElementById('an-target-daily');
    if (anTargetDailyEl) anTargetDailyEl.textContent = `Target: ₹${dailyExpectedBurn.toFixed(2)}/day`;

    let peakDayStr = '-';
    let peakAmount = 0;
    Object.keys(dailySpendMap).forEach(d => {
        if (dailySpendMap[d] > peakAmount) {
            peakAmount = dailySpendMap[d];
            peakDayStr = d;
        }
    });
    const anPeakAmountEl = document.getElementById('an-peak-day-amount');
    if (anPeakAmountEl) anPeakAmountEl.textContent = `₹${peakAmount.toFixed(2)}`;
    const anPeakDateEl = document.getElementById('an-peak-day-date');
    if (anPeakDateEl) {
        if (peakDayStr !== '-') {
            const py = peakDayStr.substring(0, 4);
            const pm = peakDayStr.substring(4, 6);
            const pd = peakDayStr.substring(6, 8);
            anPeakDateEl.textContent = `${py}-${pm}-${pd}`;
        } else {
            anPeakDateEl.textContent = 'No data';
        }
    }

    const runwayDaysEl = document.getElementById('an-runway-days');
    const runwayStatusEl = document.getElementById('an-runway-status');
    
    const diffTimeRemaining = end.getTime() - today.getTime();
    const daysRemaining = (today < start) ? totalDays : (today > end ? 0 : Math.round(diffTimeRemaining / (1000 * 60 * 60 * 24)) + 1);

    if (runwayDaysEl && runwayStatusEl) {
        if (actualBalance <= 0) {
            runwayDaysEl.textContent = "0 days";
            runwayStatusEl.textContent = "Budget depleted";
            runwayStatusEl.className = "metric-subtext text-negative";
        } else if (avgDailySpend <= 0) {
            runwayDaysEl.textContent = `${daysRemaining} days`;
            runwayStatusEl.textContent = "No spending yet";
            runwayStatusEl.className = "metric-subtext text-positive";
        } else {
            const runway = Math.floor(actualBalance / avgDailySpend);
            runwayDaysEl.textContent = `${runway} days`;
            if (runway >= daysRemaining) {
                runwayStatusEl.textContent = `Will cover all ${daysRemaining} remaining days!`;
                runwayStatusEl.className = "metric-subtext text-positive";
            } else {
                const shortfall = daysRemaining - runway;
                runwayStatusEl.textContent = `Shortfall of ~${shortfall} day(s) at current burn`;
                runwayStatusEl.className = "metric-subtext text-negative";
            }
        }
    }

    const isDark = state.theme === 'dark';
    const textColor = isDark ? '#94a3b8' : '#4b5563';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.07)' : 'rgba(0, 0, 0, 0.08)';

    if (chartInstances.balanceTrend) { chartInstances.balanceTrend.destroy(); chartInstances.balanceTrend = null; }
    if (chartInstances.dailySpending) { chartInstances.dailySpending.destroy(); chartInstances.dailySpending = null; }
    if (chartInstances.mealSpending) { chartInstances.mealSpending.destroy(); chartInstances.mealSpending = null; }
    if (chartInstances.categorySpending) { chartInstances.categorySpending.destroy(); chartInstances.categorySpending = null; }

    // Chart 1: Balance Over Time (Expected vs Actual)
    const dateLabels = [];
    const expectedData = [];
    const actualData = [];

    const sortedEaten = [...state.eaten].sort((a, b) => a[1].localeCompare(b[1]));

    let cumulativeSpend = 0;
    const cumulativeSpendByDate = {};
    sortedEaten.forEach(([fId, ts, savedPrice]) => {
        const p = getEatenRecordPrice(fId, savedPrice);
        const dStr = ts.substring(0, 8);
        cumulativeSpend += p;
        cumulativeSpendByDate[dStr] = cumulativeSpend;
    });

    let runningCumSpend = 0;
    const curDate = new Date(start.getTime());
    let dayIndex = 0;

    while (curDate <= end) {
        const yStr = curDate.getFullYear();
        const mStr = String(curDate.getMonth() + 1).padStart(2, '0');
        const dStr = String(curDate.getDate()).padStart(2, '0');
        const key = `${yStr}${mStr}${dStr}`;
        const label = `${mStr}/${dStr}`;
        dateLabels.push(label);

        const expBal = Math.max(0, startingBalance - (dayIndex * dailyExpectedBurn));
        expectedData.push(Math.round(expBal));

        if (curDate <= today || today > end) {
            if (cumulativeSpendByDate[key] !== undefined) {
                runningCumSpend = cumulativeSpendByDate[key];
            }
            actualData.push(Math.round(startingBalance - runningCumSpend));
        } else {
            actualData.push(null);
        }

        curDate.setDate(curDate.getDate() + 1);
        dayIndex++;
    }

    const ctxBalance = document.getElementById('chart-balance-trend');
    if (ctxBalance) {
        chartInstances.balanceTrend = new Chart(ctxBalance, {
            type: 'line',
            data: {
                labels: dateLabels,
                datasets: [
                    {
                        label: 'Expected Balance (Target)',
                        data: expectedData,
                        borderColor: '#94a3b8',
                        borderDash: [6, 6],
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.1,
                        fill: false
                    },
                    {
                        label: 'Actual Balance',
                        data: actualData,
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99, 102, 241, 0.15)',
                        borderWidth: 3,
                        pointRadius: 2,
                        pointHoverRadius: 6,
                        tension: 0.2,
                        fill: true
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: textColor } }
                },
                scales: {
                    x: { ticks: { color: textColor, maxTicksLimit: 12 }, grid: { color: gridColor } },
                    y: { ticks: { color: textColor, callback: v => `₹${v}` }, grid: { color: gridColor } }
                }
            }
        });
    }

    // Chart 2: Daily Spending
    const dailyKeys = Object.keys(dailySpendMap).sort();
    const dailyLabels = dailyKeys.map(k => `${k.substring(4, 6)}/${k.substring(6, 8)}`);
    const dailyValues = dailyKeys.map(k => dailySpendMap[k]);

    const ctxDaily = document.getElementById('chart-daily-spending');
    if (ctxDaily) {
        chartInstances.dailySpending = new Chart(ctxDaily, {
            type: 'bar',
            data: {
                labels: dailyLabels.length > 0 ? dailyLabels : ['No Data'],
                datasets: [
                    {
                        label: 'Daily Spending',
                        data: dailyValues.length > 0 ? dailyValues : [0],
                        backgroundColor: '#38bdf8',
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: textColor } }
                },
                scales: {
                    x: { ticks: { color: textColor }, grid: { color: gridColor } },
                    y: { ticks: { color: textColor, callback: v => `₹${v}` }, grid: { color: gridColor } }
                }
            }
        });
    }

    // Chart 3: Spending by Meal
    const ctxMeal = document.getElementById('chart-meal-spending');
    if (ctxMeal) {
        chartInstances.mealSpending = new Chart(ctxMeal, {
            type: 'doughnut',
            data: {
                labels: ['Breakfast', 'Lunch', 'Snack', 'Dinner'],
                datasets: [
                    {
                        data: [
                            mealSpendMap.breakfast,
                            mealSpendMap.lunch,
                            mealSpendMap.snack,
                            mealSpendMap.dinner
                        ],
                        backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6'],
                        borderWidth: 2,
                        borderColor: isDark ? '#131b2e' : '#ffffff'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: textColor } }
                }
            }
        });
    }

    // Chart 4: Spending by Category
    const catKeys = Object.keys(categorySpendMap).sort((a, b) => categorySpendMap[b] - categorySpendMap[a]);
    const catLabels = catKeys.slice(0, 8);
    const catValues = catLabels.map(k => categorySpendMap[k]);

    const ctxCat = document.getElementById('chart-category-spending');
    if (ctxCat) {
        chartInstances.categorySpending = new Chart(ctxCat, {
            type: 'bar',
            data: {
                labels: catLabels.length > 0 ? catLabels : ['None'],
                datasets: [
                    {
                        label: 'Spent (₹)',
                        data: catValues.length > 0 ? catValues : [0],
                        backgroundColor: '#a855f7',
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: { ticks: { color: textColor, callback: v => `₹${v}` }, grid: { color: gridColor } },
                    y: { ticks: { color: textColor }, grid: { color: gridColor } }
                }
            }
        });
    }

    // Tables: Most Frequently Eaten Foods
    const freqWrapper = document.getElementById('an-freq-table-wrapper');
    const sortedFreqIds = Object.keys(foodCountMap).sort((a, b) => foodCountMap[b] - foodCountMap[a]).slice(0, 8);
    
    if (freqWrapper) {
        if (sortedFreqIds.length === 0) {
            freqWrapper.innerHTML = `<div class="empty-state">No eating records yet.</div>`;
        } else {
            let rowsHtml = sortedFreqIds.map((fId, idx) => {
                const food = state.foodMap[fId];
                const count = foodCountMap[fId];
                const itemTotal = foodSpendMap[fId] || 0;
                const rankClass = idx === 0 ? 'rank-1' : (idx === 1 ? 'rank-2' : (idx === 2 ? 'rank-3' : ''));
                return `
                    <tr>
                        <td><span class="rank-pill ${rankClass}">${idx + 1}</span></td>
                        <td style="font-weight:600;">${escapeHTML(foodNameMap[fId] || food?.item || fId)}</td>
                        <td><span class="food-category-badge">${escapeHTML(food ? food.category : (isCustomFoodId(fId) ? 'Custom item' : 'N/A'))}</span></td>
                        <td style="text-align:center; font-weight:700;">${count}×</td>
                        <td style="text-align:right; font-weight:700; color:var(--accent-light);">₹${itemTotal.toFixed(2)}</td>
                    </tr>
                `;
            }).join('');

            freqWrapper.innerHTML = `
                <table class="analytics-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Food Item</th>
                            <th>Category</th>
                            <th style="text-align:center;">Times Eaten</th>
                            <th style="text-align:right;">Total Spent</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            `;
        }
    }

    // Tables: Favorite Foods
    const favsWrapper = document.getElementById('an-favs-table-wrapper');
    const candidateIds = new Set([...Object.keys(state.ratings), ...Object.keys(foodCountMap)]);
    const favCandidates = Array.from(candidateIds).map(fId => {
        const rating = state.ratings[fId] || 0;
        const count = foodCountMap[fId] || 0;
        const score = (rating * 20) + (count * 5);
        return { fId, rating, count, score };
    });

    favCandidates.sort((a, b) => b.score - a.score);
    const topFavs = favCandidates.slice(0, 8);

    if (favsWrapper) {
        if (topFavs.length === 0 || (topFavs[0].rating === 0 && topFavs[0].count === 0)) {
            favsWrapper.innerHTML = `<div class="empty-state">No ratings or eating records yet.</div>`;
        } else {
            let rowsHtml = topFavs.map((fav, idx) => {
                const food = state.foodMap[fav.fId];
                const rankClass = idx === 0 ? 'rank-1' : (idx === 1 ? 'rank-2' : (idx === 2 ? 'rank-3' : ''));
                const stars = fav.rating > 0 ? '★'.repeat(fav.rating) + '☆'.repeat(5 - fav.rating) : 'Unrated';
                return `
                    <tr>
                        <td><span class="rank-pill ${rankClass}">${idx + 1}</span></td>
                        <td style="font-weight:600;">${escapeHTML(food ? food.item : (foodNameMap[fav.fId] || fav.fId))}</td>
                        <td style="color:var(--warning); font-size:12px;">${stars}</td>
                        <td style="text-align:center;">${fav.count}×</td>
                        <td><span class="food-category-badge">${escapeHTML(food ? food.category : (isCustomFoodId(fav.fId) ? 'Custom item' : 'N/A'))}</span></td>
                        <td style="text-align:right; font-weight:700;">₹${fav.count ? (foodSpendMap[fav.fId] / fav.count).toFixed(2) : (food ? food.price.toFixed(2) : '0.00')}</td>
                    </tr>
                `;
            }).join('');

            favsWrapper.innerHTML = `
                <table class="analytics-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Food Item</th>
                            <th>Rating</th>
                            <th style="text-align:center;">Eaten</th>
                            <th>Category</th>
                            <th style="text-align:right;">Price</th>
                        </tr>
                    </thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            `;
        }
    }
}

/**
 * 14. RUN-TIME INITIALIZERS & BINDINGS
 */

function triggerFullUIRender() {
    // 1. Detect current meal dynamically from local clock
    const now = new Date();
    const curTimeStr = String(now.getHours()).padStart(2, '0') + ":" + String(now.getMinutes()).padStart(2, '0');
    state.currentMeal = getMealTypeForTime(curTimeStr, state.settings.mealTimes);
    
    // 2. Render all subviews
    renderDashboard();
    renderCurrentMeal();
    renderRecommendations();
    renderFilters();
    renderFoodCatalog();
    renderHistory();
    renderSettingsForm();

    if (state.activeTab === 'analytics') {
        renderAnalytics();
    }
}

function switchTab(tabId) {
    state.activeTab = tabId;
    
    // Switch active buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });
    
    // Switch active panes
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === `${tabId}-pane`);
    });

    if (tabId === 'analytics') {
        renderAnalytics();
    }
}

function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', state.theme);
    
    // Update theme toggle icon
    const themeIcon = document.getElementById('theme-toggle-btn');
    if (state.theme === 'dark') {
        themeIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
    } else {
        themeIcon.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
    }

    if (state.activeTab === 'analytics') {
        renderAnalytics();
    }
}

// Bind all UI Actions
function initEventBindings() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
    });
    
    // Theme toggle
    document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);
    
    // Filter controls
    document.getElementById('search-box').addEventListener('input', (e) => {
        state.filters.search = e.target.value;
        renderFoodCatalog();
    });
    
    document.getElementById('filter-category').addEventListener('change', (e) => {
        state.filters.category = e.target.value;
        renderFoodCatalog();
    });
    
    document.getElementById('filter-suitability').addEventListener('change', (e) => {
        state.filters.suitability = e.target.value;
        renderFoodCatalog();
    });
    
    // Food Catalog and Recommendations interactions (using Event Delegation)
    document.addEventListener('click', (e) => {
        // Eat Button
        const eatBtn = e.target.closest('.eat-btn');
        if (eatBtn) {
            const foodId = eatBtn.getAttribute('data-id');
            eatFood(foodId);
            return;
        }
        
        // Star clicks
        const star = e.target.closest('.star');
        if (star) {
            const ratingContainer = star.closest('.star-rating');
            if (ratingContainer) {
                const foodId = ratingContainer.getAttribute('data-id');
                const val = star.getAttribute('data-val');
                rateFood(foodId, val);
            }
            return;
        }
        
        // Details Button
        const detailsBtn = e.target.closest('.details-btn');
        if (detailsBtn) {
            const foodId = detailsBtn.getAttribute('data-id');
            openDetailsModal(foodId);
            return;
        }
        
        // Close modal clicking outside
        if (e.target.id === 'details-modal') {
            closeDetailsModal();
            return;
        }

        // Close edit modal clicking outside
        if (e.target.id === 'edit-history-modal') {
            closeEditHistoryModal();
            return;
        }

        if (e.target.id === 'custom-entry-modal') {
            closeCustomEntryModal();
            return;
        }

        if (e.target.id === 'bulk-ledger-modal') {
            closeBulkLedgerModal();
            return;
        }
        
        // Delete history entry
        const delHistBtn = e.target.closest('.delete-history-btn');
        if (delHistBtn) {
            const idx = parseInt(delHistBtn.getAttribute('data-index'));
            deleteHistoryEntry(idx);
            return;
        }

        // Edit history entry
        const editHistBtn = e.target.closest('.edit-history-btn');
        if (editHistBtn) {
            const idx = parseInt(editHistBtn.getAttribute('data-index'));
            openEditHistoryModal(idx);
            return;
        }
    });
    
    // Modal controls
    document.getElementById('modal-close-btn').addEventListener('click', closeDetailsModal);
    
    // Edit history modal controls
    const editCancelBtn = document.getElementById('edit-history-cancel-btn');
    if (editCancelBtn) editCancelBtn.addEventListener('click', closeEditHistoryModal);
    const editForm = document.getElementById('edit-history-form');
    if (editForm) editForm.addEventListener('submit', saveEditHistory);
    
    // Settings panel
    document.getElementById('settings-form').addEventListener('submit', saveSettings);
    document.getElementById('btn-reset-settings').addEventListener('click', resetSettingsToDefault);
    document.getElementById('btn-clear-data').addEventListener('click', clearAllUserData);

    document.getElementById('add-custom-entry-btn').addEventListener('click', openCustomEntryModal);
    document.getElementById('custom-entry-cancel-btn').addEventListener('click', closeCustomEntryModal);
    document.getElementById('custom-entry-form').addEventListener('submit', saveCustomEntry);
    document.getElementById('bulk-ledger-open-btn').addEventListener('click', openBulkLedgerModal);
    document.getElementById('bulk-ledger-cancel-btn').addEventListener('click', closeBulkLedgerModal);
    document.getElementById('bulk-ledger-preview-btn').addEventListener('click', previewBulkLedgerImport);
    document.getElementById('bulk-ledger-import-btn').addEventListener('click', commitBulkLedgerImport);
    document.getElementById('bulk-ledger-text').addEventListener('input', () => {
        pendingBulkImport = null;
        document.getElementById('bulk-ledger-preview').style.display = 'none';
        document.getElementById('bulk-ledger-import-btn').style.display = 'none';
    });
    
    // Live update of percentages while editing weights
    const weightsInputs = ['breakfast', 'lunch', 'snack', 'dinner'].map(m => document.getElementById(`set-weight-${m}`));
    weightsInputs.forEach(input => {
        input.addEventListener('input', () => {
            const weights = {
                breakfast: parseInt(document.getElementById('set-weight-breakfast').value) || 0,
                lunch: parseInt(document.getElementById('set-weight-lunch').value) || 0,
                snack: parseInt(document.getElementById('set-weight-snack').value) || 0,
                dinner: parseInt(document.getElementById('set-weight-dinner').value) || 0
            };
            const pct = getWeightPercentages(weights);
            document.getElementById('pct-breakfast').textContent = `${pct.breakfast}%`;
            document.getElementById('pct-lunch').textContent = `${pct.lunch}%`;
            document.getElementById('pct-snack').textContent = `${pct.snack}%`;
            document.getElementById('pct-dinner').textContent = `${pct.dinner}%`;
        });
    });
    
    // Quick-select meal type header filter
    document.querySelectorAll('.meal-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.meal-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            
            // Set global currentMeal overrides for the recommendations list
            state.currentMeal = pill.getAttribute('data-meal');
            
            // Re-render
            renderCurrentMeal();
            renderRecommendations();
            
            // If catalog filter suitability is 'current', update catalog too
            if (state.filters.suitability === 'current') {
                renderFoodCatalog();
            }
        });
    });
}

// App Bootstrap
window.addEventListener('DOMContentLoaded', async () => {
    // 1. Initial LocalStorage Sync & Schema setup
    const userData = loadUserData();
    state.settings = userData.settings;
    state.ratings = userData.ratings;
    state.eaten = userData.eaten;
    
    // Set theme representation
    document.documentElement.setAttribute('data-theme', state.theme);
    
    // 2. Load Food CSV
    const dbSuccess = await loadFoodDatabase();
    if (dbSuccess) {
        migrateEatenPrices();
        initEventBindings();
        triggerFullUIRender();
        
        // Sync active pill in current meal header
        const activePill = document.querySelector(`.meal-pill[data-meal="${state.currentMeal}"]`);
        if (activePill) {
            activePill.classList.add('active');
        }
    }
});
