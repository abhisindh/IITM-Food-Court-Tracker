# IITM Food Court Tracker

A lightweight, privacy-first web application for tracking food-court spending, eating habits, nutrition, and meal-wise budgeting at IIT Madras.

The project combines a local food database with a client-side recommendation engine and a reproducible budgeting system. It is designed as a practical example of building a complete data-driven web application using only HTML, CSS, vanilla JavaScript, CSV, and browser `localStorage`—without a backend or external database.

> **Status:** MVP
> **Stack:** HTML5 · CSS3 · Vanilla JavaScript · CSV · Web Storage API

---

## Overview

Managing a fixed food budget across breakfast, lunch, snacks, and dinner is not just a budgeting problem. The user also needs to decide what to eat, balance nutrition with cost, learn from previous food choices, and avoid repeatedly choosing the same options.

IITM Food Court Tracker addresses these problems through four connected components:

* **Budget engine** — continuously calculates the remaining budget and daily/meal-wise spending allowance.
* **Food database** — stores food, price, serving size, and approximate nutritional information in CSV.
* **Recommendation engine** — ranks foods using nutrition, meal suitability, personal ratings, and controlled exploration.
* **Eating history** — records what was eaten and when using a minimal localStorage representation.

The application is entirely client-side. User data stays in the browser.

---

## Key Features

### Dynamic Budget Management

The application starts with a configurable budget and distributes the remaining balance over the remaining days.

Default configuration:

| Setting          |    Default |
| ---------------- | ---------: |
| Start date       | 2026-09-01 |
| End date         | 2026-10-10 |
| Starting balance |     ₹6,510 |
| Breakfast weight |         40 |
| Lunch weight     |         70 |
| Snack weight     |         20 |
| Dinner weight    |         70 |

The meal weights are normalized automatically.

`40 : 70 : 20 : 70`

corresponds to:

`20% : 35% : 10% : 35%`

The daily budget is recalculated dynamically:

```text
Current Balance
──────────────────────────
Days Remaining Including Today
```

Only actual purchases reduce the balance. Meal budgets are recommendations and are never deducted automatically.

---

## Food Database

Food information is maintained in:

```text
IITM_Food_Court_Nutrition_Estimates.csv
```

Each food has a permanent sequential identifier:

```text
0001
0002
0003
...
```

The ID acts as the primary key.

Food records contain information such as:

* Food name
* Category
* Serving size
* Price
* Approximate calories
* Approximate protein
* Approximate carbohydrates
* Approximate fat
* Approximate fibre

The CSV is treated as the master source of truth for food metadata.

User-specific data does not duplicate this information.

---

## Minimal Data Model

A deliberate design decision in this project is to avoid redundant localStorage data.

An eating record contains only:

```js
["0042", "202609011230"]
```

where:

```text
0042             → food ID
202609011230     → YYYYMMDDHHMM
```

The application retrieves the food name, price, nutrition, and category from the CSV whenever required.

Therefore, an eating record does **not** store:

```text
food name
price
category
nutrition
meal type
```

This makes the stored state compact and keeps the food database as the single source of truth.

Ratings use the same principle:

```js
{
  "0001": 5,
  "0042": 4
}
```

---

## Recommendation Engine

The recommendation system uses an exploration/exploitation approach rather than simply sorting foods by calories or user rating.

The ranking considers:

1. Nutritional value
2. User rating
3. Meal suitability
4. Exploration of unrated foods
5. Small controlled randomness

A representative ranking model is:

```text
Base Score =
    0.60 × Nutrition Score
  + 0.25 × Rating Score
  + 0.15 × Meal Suitability Score
```

An exploration component is then added.

Rated foods receive a small random component, while unrated foods receive a somewhat larger exploration bonus.

This prevents the application from repeatedly recommending only familiar foods while still preventing randomness from dominating the ranking.

The system therefore balances:

```text
Exploitation
"Recommend foods I already know I like."

with

Exploration
"Occasionally introduce something new."
```

Ratings are not treated as absolute truth. They are one component of the recommendation score.

---

## Nutrition Scoring

Nutrition information in the database is approximate rather than laboratory-measured.

The recommendation system uses the available nutritional fields to construct a relative score based on factors such as:

* Protein
* Fibre
* Calories
* Fat

The score is intended for **relative food comparison**, not medical or dietary advice.

For example, the application should be able to distinguish between:

```text
High-protein + reasonable-calorie meal
```

and

```text
Highly calorie-dense + low-protein snack
```

while still exposing the underlying nutritional estimates to the user.

The UI should clearly communicate that nutritional values can vary depending on recipe, oil, sugar, and actual serving size.

---

## Meal Detection

The application determines the current meal from the user's local time.

Default meal windows:

| Meal      | Time        |
| --------- | ----------- |
| Breakfast | 07:00–10:00 |
| Lunch     | 12:00–14:30 |
| Snack     | 16:30–17:30 |
| Dinner    | 19:00–21:30 |

The gaps between these windows are assigned deterministically so that every time of day has a predictable meal classification.

Meal timings are configurable through the Admin/Settings panel.

The actual timestamp is stored rather than the meal name. This means historical records remain valid even if meal boundaries are changed later.

---

## Financial Calculation

The financial state is derived rather than stored.

```text
Current Balance =
Starting Balance − Total Cost of Eaten Items
```

For every eating record:

```text
food ID
   ↓
CSV lookup
   ↓
price
   ↓
total spending
```

This means the application can reconstruct the complete financial state from:

```text
Settings + Food Database + Eating History
```

Calculated values such as current balance, daily budget, and meal budgets are intentionally not persisted.

This reduces the possibility of stale or inconsistent financial state.

---

## Date Handling

The budget period includes both the start and end dates.

For example:

```text
2026-09-01 → 2026-10-10
```

contains:

```text
40 days
```

The application uses:

```text
Days Remaining Including Today
```

for daily budget calculation.

Therefore, on the final day:

```text
Days Remaining = 1
```

rather than zero.

Date and timestamp calculations use the browser's local time rather than UTC conversion, avoiding incorrect day assignment around midnight.

---

## User Workflow

When the application starts:

```text
Load settings
      ↓
Load food database
      ↓
Load ratings
      ↓
Load eating history
      ↓
Calculate financial state
      ↓
Determine current meal
      ↓
Calculate recommendation scores
      ↓
Display recommendations
```

When the user selects a food:

```text
Food
 ↓
Rate OR Eat
```

### Rate

A rating:

* Updates the user's rating
* Is stored in localStorage
* Does not affect the budget
* Changes future recommendations

### Eat

An eating action:

* Records food ID + timestamp
* Retrieves price from the CSV
* Updates total spending
* Updates current balance
* Updates today's spending
* Updates meal budget status
* Updates the UI immediately

---

## Storage Architecture

The application uses browser `localStorage`.

Conceptually:

```js
{
  version: 1,

  settings: {
    startDate: "2026-09-01",
    endDate: "2026-10-10",
    startingBalance: 6510,
    mealWeights: {
      breakfast: 40,
      lunch: 70,
      snack: 20,
      dinner: 70
    }
  },

  ratings: {
    "0001": 5,
    "0042": 4
  },

  eaten: [
    ["0042", "202609011230"],
    ["0001", "202609010800"]
  ]
}
```

No account or server is required.

---

## Data Integrity

Several design choices are intentional:

### Stable food IDs

Food IDs are sequential and persistent.

They are not generated from food names and are not random.

Therefore:

```text
0042
```

continues to identify the same food even if its display name changes.

### No redundant financial data

Prices are not duplicated into eating records.

The CSV remains the source of truth.

### No stored calculated values

The application does not store:

```text
currentBalance
todayBudget
daysRemaining
mealBudget
totalSpent
```

These are derived whenever needed.

### Versioned localStorage

The stored data contains a schema version so that future changes can be migrated safely.

---

## Privacy

The application is designed as a local-first application.

User-specific information is stored only in the browser's localStorage.

There is:

* No login
* No backend
* No cloud database
* No external analytics requirement
* No external API requirement

Eating history and ratings therefore remain local to the browser unless the user deliberately exports or copies the data.

---

## Admin / Settings

The settings panel allows modification of:

* Budget period
* Starting balance
* Meal budget weights
* Meal time windows

Settings are persisted in localStorage.

The application also provides:

**Reset Settings**

to restore defaults.

A separate:

**Clear Current Data**

operation removes:

* eating history
* ratings

but does not remove:

* settings
* food database
* default configuration

The clear operation requires two confirmations, with the second requiring the user to type:

```text
CLEAR
```

---

## Validation and Error Handling

The MVP validates:

* Date ranges
* Starting balance
* Meal weights
* Meal times
* Food IDs
* Food prices
* Nutrition fields
* CSV structure
* localStorage contents

Malformed localStorage should not make the application permanently unusable.

If the CSV cannot be loaded, the application displays a clear error instead of silently operating with an incomplete database.

---

## Testing Strategy

The project includes a lightweight logic test runner:

```text
verify_logic.js
```

The tests focus on business logic rather than visual rendering.

Important automated tests include:

### CSV parser

Verify that:

* quoted values work
* commas inside quoted fields work
* numeric fields are parsed correctly
* IDs are unique
* invalid rows are handled safely

### Date engine

Verify:

```text
2026-09-01 → 2026-10-10 = 40 days
same start/end date = 1 day
final day = 1 day remaining
after end date = period ended
```

### Time engine

Verify boundary cases including:

```text
07:00
10:00
11:30
12:00
14:30
15:00
16:30
17:30
19:00
21:30
23:59
00:01
```

### Financial engine

Verify:

```text
No purchases
One purchase
Repeated purchase
Multiple different foods
Overspending
Zero balance
Negative balance
```

### Persistence

Verify that data survives:

```text
Eat → Refresh
Rate → Refresh
Change Settings → Refresh
Clear Data → Refresh
```

### Recommendation engine

Test invariants rather than exact randomized rankings.

Verify that:

* ratings influence ranking
* unrated foods receive exploration treatment
* meal suitability influences ranking
* invalid nutrition does not produce `NaN`
* randomness cannot overwhelm large score differences

---

## Running Locally

Because the application loads the CSV using `fetch()`, it should be served through a local HTTP server rather than opened directly with `file://`.

With Python installed:

```bash
python -m http.server
```

Then open the displayed local address in a browser.

The project requires no build step.

---

## Project Structure

```text
iitm-food-court-tracker/
│
├── index.html
├── style.css
├── app.js
├── verify_logic.js
├── IITM_Food_Court_Nutrition_Estimates.csv
└── README.md
```

---

## Engineering Highlights

This project demonstrates several practical software engineering concepts in a small application:

* Client-side state management
* Data-driven UI design
* CSV parsing and validation
* Deterministic financial calculations
* Date/time handling
* Local persistence
* Stable primary-key design
* Data normalization
* Recommendation systems
* Exploration/exploitation strategies
* Ranking algorithms
* Input validation
* Schema versioning
* Defensive programming
* Automated business-logic testing
* Responsive UI design

The project intentionally avoids a framework to keep the underlying architecture visible and understandable.

---

## Future Improvements

Possible extensions include:

* Export/import of eating history
* Weekly and monthly spending analytics
* Nutrition trends over time
* More sophisticated recommendation algorithms
* Contextual bandit-based recommendations
* Price-change/version tracking
* Food availability tracking
* Visualization of spending by meal
* Visualization of protein/fibre intake
* Offline-first Progressive Web App support
* Automated CSV update pipeline
* Historical food-price snapshots

A future recommendation engine could model the problem as a contextual bandit where the context includes meal, remaining budget, time of day, nutrition profile, and previous user preferences.

---

## Motivation

This project started as a practical need: manage a fixed food budget while making better food choices.

It evolved into a compact software engineering and machine-learning-inspired problem involving:

```text
Data
 ↓
State
 ↓
Ranking
 ↓
Recommendation
 ↓
User Feedback
 ↓
Updated Ranking
```

The application is deliberately small, but the underlying design demonstrates how a real-world system can combine data modeling, state management, algorithms, and user feedback into a complete working product.
