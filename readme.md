# IITM Food Court Tracker

A responsive, local-first web application for tracking food-court spending, eating habits, nutrition, and meal-wise budgeting at IIT Madras.

The project combines a local food database with a client-side recommendation engine and a reproducible budgeting system. It is designed as a practical example of building a complete data-driven web application using only HTML, CSS, vanilla JavaScript, CSV, and browser `localStorage`—without a backend or external database.

> **Status:** Active
> **Stack:** HTML5 · CSS3 · Vanilla JavaScript · CSV · Web Storage API

## View the App

[Open IITM Food Court Tracker](https://abhisindh.github.io/IITM-Food-Court-Tracker/)

---

## Overview

Managing a fixed food budget across breakfast, lunch, snacks, and dinner is not just a budgeting problem. The user also needs to decide what to eat, balance nutrition with cost, learn from previous food choices, and avoid repeatedly choosing the same options.

IITM Food Court Tracker addresses these needs through a set of connected features:

* **Budget engine** — calculates the remaining balance, adaptive daily allowance, and meal budgets that rebalance as the day progresses.
* **Food database** — stores food, price, serving size, and approximate nutritional information in CSV.
* **Recommendation engine** — ranks foods using nutrition, meal suitability, personal ratings, and controlled exploration.
* **Eating history** — keeps each purchase as its own record and groups the display by date and meal, with meal totals and editable records.
* **Analytics** — compares expected and actual balance, plots daily spending against an adaptive target, and summarizes spending by meal and catalog category.
* **Ledger import** — validates pasted hostel ledger reports, skips duplicates, infers meals, and applies authoritative dates and balance from the report.
* **Responsive layout** — adapts navigation, cards, charts, forms, and history for mobile, tablet, and desktop screens.

The application is entirely client-side. User data stays in the browser.

The app is hosted on GitHub Pages. Chart.js is loaded from jsDelivr; the tracker has no application backend.

---

## Key Features

### Dynamic Budget Management

The application starts with a configurable budget and distributes the remaining balance over the remaining days.

Default configuration:

| Setting          |    Default |
| ---------------- | ---------: |
| Start date       | 2026-09-01 |
| End date         | 2026-10-10 |
| Starting balance |     ₹5,772 |
| Breakfast weight |         40 |
| Lunch weight     |         70 |
| Snack weight     |         20 |
| Dinner weight    |         70 |

These are fallback values for a new browser profile. Saved localStorage settings are loaded first, and missing fields are filled from these defaults. Ledger dates and opening balance take precedence when a report is imported and applied.

The meal weights are normalized automatically.

`40 : 70 : 20 : 70`

corresponds to:

`20% : 35% : 10% : 35%`

At the start of each day, the daily budget is recalculated from the opening balance:

```text
Balance at the Start of Today
──────────────────────────
Days Remaining Including Today
```

Meal allowances begin using the configured weights. When a meal window ends, its actual spend is settled and any unused allowance is redistributed across the remaining meals in proportion to their weights. Overspending reduces the allowance available to later meals. Any funds left after the final meal remain in the balance and are included in the next day's calculation.

The Eating History tab supports bulk import from pasted report text, including Markdown tables. The importer checks consecutive closing balances, adds debit rows as individual purchases, and skips duplicates matching date, amount, and closing balance. The Dining Period dates and a matching opening credit are authoritative and replace conflicting saved settings when the preview is applied. If the chunk begins with a debit and has no opening credit, its first closing balance plus the debit estimates the balance at the start of that chunk; the preview marks this as uncertain because it may not be the full-period opening balance. Meal estimates use daily purchase counts and voucher-number gaps. Days with fewer than three purchases use historical meal averages when available. Estimates can be changed in History. Since the report has no times, imported purchases retain date-only timestamps.

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

User-specific data does not duplicate food metadata; eating records keep a price snapshot for accurate historical spending.

---

## Minimal Data Model

A deliberate design decision in this project is to keep localStorage compact while preserving purchase-time prices.

An eating record contains:

```js
["0042", "202609011230", 85]
```

where:

```text
0042             → food ID
202609011230     → YYYYMMDDHHMM
85               → price in rupees at the time it was logged
```

Custom purchases use the same record with a custom item ID and a fourth field for the display name:

```js
["custom:lemon-rice", "202609011230", 85, "Lemon Rice"]
```

The application retrieves the food name, nutrition, and category from the CSV by default. The purchase-time price is stored with the eating record so later CSV price changes do not alter past spending. Editing a history record can save a name override and a corrected price for that purchase.

For CSV-backed foods, an eating record does **not** duplicate:

```text
category metadata
nutrition metadata
```

The meal is normally derived from the timestamp and configured meal hours. An optional meal override is stored when a record is manually assigned to a different meal.

Custom purchase records store the entered item name because those items do not have a matching CSV row. The optional fourth field also preserves edited name overrides.

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

Meal timings are configurable through Admin & Settings. Regular purchases are assigned from their timestamps. Ledger imports infer meals from daily purchase counts and voucher-number gaps; sparse days use historical average spend by meal when available. Any meal assignment can be changed in the History editor.

History keeps purchases separate for spending and analytics. Its view groups records by date and meal, showing the items, count, and combined meal total together.

---

## Analytics

The Analytics tab includes spending and balance summaries, plus:

* **Balance Over Time:** expected and actual balance, with a one-week date range and a vertical scale fitted to the relevant balance values.
* **Daily Spending Over Time:** daily totals and an adaptive target line. The target starts from the period's saved starting balance, divides the remaining balance across remaining budget days, and recalculates after each day's actual spending.
* **Spending by Meal** and **Spending by Food Category.** Custom purchases are excluded from the category chart so they do not skew catalog categories.
* **Most Frequently Eaten Foods** and **Favorite Foods.** Custom entries are excluded from these rankings.

Custom purchases still count toward total spending, current balance, daily spending, and meal spending.

---

## Financial Calculation

The financial state is derived from saved settings and eating history rather than stored as a separate total.

```text
Current Balance = Starting Balance − Total Cost of Eaten Items
```

For every eating record, the saved purchase-time price is added to total spending.

This means the application can reconstruct the complete financial state from:

```text
Settings + Eating History
```

Today's budget is based on the balance at the start of the day divided by days remaining, including today. The adaptive target in Analytics starts with the saved starting balance; after each day, it subtracts that day's actual spending and divides what remains across the remaining period days. Meal budgets use configured weights. As a meal window ends, unused funds are redistributed to the meals left that day; overspending reduces those later allowances.

Calculated values such as current balance, daily budget, and meal budgets are not persisted.

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

Daily budgets use:

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
* Stores the price with the eating record
* Updates total spending
* Updates current balance
* Updates today's spending
* Updates meal budget status
* Updates the UI immediately

### Add a Custom Purchase

Use **Add custom amount** to record a purchase missing from the food catalog. Enter its name, amount, date, and time. Custom purchases affect spending and budget calculations but are excluded from catalog food rankings and food-category totals.

### Edit Eating History

Each purchase remains a separate record. Edit its name, price, date, time, or meal assignment. History groups items by date and meal and shows a combined amount for each meal.

---

## Storage Architecture

The application uses browser `localStorage`.

Conceptually:

```js
{
  version: 3,

  settings: {
    startDate: "2026-09-01",
    endDate: "2026-10-10",
    startingBalance: 5772,
    mealWeights: {
      breakfast: 40,
      lunch: 70,
      snack: 20,
      dinner: 70
    }
  },

  settingsProvided: {
    startDate: true,
    endDate: true,
    startingBalance: true
  },

  ratings: {
    "0001": 5,
    "0042": 4
  },

  eaten: [
    ["0042", "202609011230", 85, null, "lunch"],
    ["custom:lemon-rice", "202609011230", 85, "Lemon Rice", "breakfast"]
  ]
}
```

No account or server is required.

`settingsProvided` tracks whether the period dates and starting balance were explicitly saved or filled from fallback defaults. Fallback settings are stored in localStorage during initialization. The ledger import can replace these values when you apply a validated report.

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

### Purchase-time prices

Each eating record stores the item's price when it was logged. Updating the CSV later does not change historical spending. Older records that lack a saved price are migrated using the current CSV price because their original purchase price is unavailable.

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

Chart.js is downloaded from jsDelivr to render analytics. Eating history, ratings, and settings remain in browser localStorage and are not sent to the app server.

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

The app validates:

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

## Running Locally

Because the application loads the CSV using `fetch()`, it should be served through a local HTTP server rather than opened directly with `file://`.

With Python installed:

```bash
python -m http.server
```

Then open the displayed local address in a browser.

The project requires no build step.

The hosted application is available at [abhisindh.github.io/IITM-Food-Court-Tracker](https://abhisindh.github.io/IITM-Food-Court-Tracker/).

---

## Project Structure

```text
iitm-food-court-tracker/
│
├── index.html
├── style.css
├── app.js
├── IITM_Food_Court_Nutrition_Estimates.csv
└── readme.md
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
* Responsive mobile-first layout
* Stable primary-key design
* Data normalization
* Recommendation systems
* Exploration/exploitation strategies
* Ranking algorithms
* Input validation
* Schema versioning
* Defensive programming
* Ledger reconciliation and duplicate detection
* Historical meal inference

The project intentionally avoids a framework to keep the underlying architecture visible and understandable.

---

## Future Improvements

Possible extensions include:

* Export/import of full localStorage data
* Nutrition trends over time
* Food availability tracking
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
