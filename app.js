/**
 * IITM Food Court Tracker - app.js
 * Core application logic: handles CSV loading, state calculations, recommendation calculations, and UI updates.
 */

// Global Application State
const state = {
    foodDb: [],        // Raw array of food items loaded from CSV
    foodMap: {},       // Map of foodID -> foodObject for O(1) lookups
    version: 1,        // Schema version
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
    eaten: [],         // array of [foodID, timestamp]
    
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
        
        // Validate Schema version & key structure
        if (
            !data ||
            data.version !== state.version ||
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
    
    // Calculate total spent based on actual CSV values of items eaten (dynamic lookup)
    let totalSpent = 0;
    const todayStr = getLocalDateString(today);
    let spentTodayTotal = 0;
    const spentTodayByMeal = { breakfast: 0, lunch: 0, snack: 0, dinner: 0 };
    
    state.eaten.forEach(([foodId, timestamp]) => {
        const food = state.foodMap[foodId];
        if (food) {
            totalSpent += food.price;
            
            // Check if item was eaten today
            if (timestamp.substring(0, 8) === todayStr) {
                spentTodayTotal += food.price;
                
                // Determine meal type for this record's timestamp
                const hr = timestamp.substring(8, 10);
                const min = timestamp.substring(10, 12);
                const timeStr = `${hr}:${min}`;
                const mealType = getMealTypeForTime(timeStr, state.settings.mealTimes);
                spentTodayByMeal[mealType] += food.price;
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
    
    document.getElementById('meal-budget-val').textContent = `₹${fin.todayBudget.toFixed()}`;
    document.getElementById('meal-spent-val').textContent = `₹${fin.spentTodayTotal}`;
    
    const remainingValEl = document.getElementById('meal-remaining-val');
    remainingValEl.textContent = `₹${fin.todayBudget.toFixed()- fin.spentTodayTotal}`;
    
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
    
    state.eaten.forEach(([foodId, timestamp], index) => {
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
            foodItem: food ? food.item : `Unknown Item (${foodId})`,
            foodCategory: food ? food.category : 'N/A',
            price: food ? food.price : 0,
            time: timeStr
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
                        <span class="history-name">${rec.foodItem}</span>
                        <span class="history-category">${rec.foodCategory}</span>
                    </div>
                </div>
                <div class="history-item-right">
                    <span class="history-price">₹${rec.price.toFixed(2)}</span>
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
    
    // Add to eating records: [foodID, YYYYMMDDHHMM]
    state.eaten.push([foodId, timestamp]);
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
    
    const [foodId] = state.eaten[index];
    const food = state.foodMap[foodId];
    const itemName = food ? food.item : 'Item';
    
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
 * 12. RUN-TIME INITIALIZERS & BINDINGS
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
        
        // Delete history entry
        const delHistBtn = e.target.closest('.delete-history-btn');
        if (delHistBtn) {
            const idx = parseInt(delHistBtn.getAttribute('data-index'));
            deleteHistoryEntry(idx);
            return;
        }
    });
    
    // Modal controls
    document.getElementById('modal-close-btn').addEventListener('click', closeDetailsModal);
    
    // Settings panel
    document.getElementById('settings-form').addEventListener('submit', saveSettings);
    document.getElementById('btn-reset-settings').addEventListener('click', resetSettingsToDefault);
    document.getElementById('btn-clear-data').addEventListener('click', clearAllUserData);
    
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
        initEventBindings();
        triggerFullUIRender();
        
        // Sync active pill in current meal header
        const activePill = document.querySelector(`.meal-pill[data-meal="${state.currentMeal}"]`);
        if (activePill) {
            activePill.classList.add('active');
        }
    }
});
