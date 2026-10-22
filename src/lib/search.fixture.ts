import type { Recipe } from '../types'

// The same recipes and queries are in ios/MealsByMaggieTests (RecipeSearchTests), with the
// results below as expected values, so the Swift port of this search can't drift from it.
export const SEARCH_FIXTURE: Recipe[] = [
  { id: 'alfredo', title: 'Chicken Alfredo', description: 'Creamy weeknight pasta.', tags: ['Pasta', 'dinner'], ingredients: [{ amount: '1 lb', name: 'fettuccine' }, { amount: '2', name: 'chicken breasts' }, { name: 'parmesan cheese' }], instructions: ['Boil the pasta.', 'Simmer the sauce until thick.'], createdByName: 'Chef Mike Drop' },
  { id: 'cookies', title: 'Chocolate Chip Cookies', tags: ['dessert', 'baking'], ingredients: [{ amount: '2', name: 'eggs' }, { amount: '1 cup', name: 'chocolate chips' }], instructions: ['Cream the butter and sugar.', 'Bake at 350°F for 10 minutes.'], createdByName: 'Nana' },
  { id: 'chili', title: 'Crockpot Chili', description: 'Set it and forget it.', tags: ['Dinner', 'slow cooker'], ingredients: [{ amount: '1 lb', name: 'ground beef' }, { amount: '1 can', name: 'kidney beans' }], instructions: ['Brown the beef.', 'Cook on low for 8 hours.'], createdByName: 'Chef Mike Drop' },
  { id: 'pie', title: 'Apple Pie', tags: ['dessert', 'Easy'], ingredients: [{ amount: '6', name: 'apples' }, { name: 'pie crust' }], instructions: ['Slice the apples.'], createdByName: 'Gram' },
  { id: 'salad', title: 'Greek Salad', tags: ['side', 'vegan'], ingredients: [{ name: 'feta' }, { name: 'cucumber' }], createdByName: 'user' },
]

export const SEARCH_CASES: [string, string[]][] = [
  ['chicken', ['alfredo']],
  ['chiken', ['alfredo']],
  ['parmesn', ['alfredo']],
  ['mike', ['alfredo', 'chili']],
  ['chef mike', ['alfredo', 'chili']],
  ['"mike drop"', ['alfredo', 'chili']],
  ['nana', ['cookies']],
  ['gram', ['pie']],
  ['user', []],
  ['chef:mike', ['alfredo', 'chili']],
  ['by:gram', ['pie']],
  ['chef:user', []],
  ['mike dinner', ['alfredo', 'chili']],
  ['mike dessert', []],
  ['tag:dessert', ['cookies', 'pie']],
  ['ing:egg', ['cookies']],
  ['dessert apple', ['pie']],
  ['beans', ['chili']],
  ['350', ['cookies']],
  ['xyzzy', []],
  // Tag aliases (tags.ts): the main tag is added, the original kept.
  ['tag:crockpot', ['chili']],
  ['tag:slow', ['chili']],
  ['tag:vegetarian', ['salad']],
  ['tag:vegan', ['salad']],
  ['vegetarian', ['salad']],
  ['tag:"quick & easy"', ['pie']],
  ['tag:easy', ['pie']],
]
