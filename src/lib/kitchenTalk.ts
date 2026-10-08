// Kitchen-flavoured copy for status moments: loading, importing, saving, finishing.
// Each moment has a bank of lines; one is picked per event (see usePick) so the app
// feels a little different each time without text changing under you.
//
// Add lines freely. Rules of thumb:
// - Fun goes in headlines, toasts and status text. Instructions, error bodies that say
//   what to do next, recipe content and food-safety text stay plain.
// - {title}, {q} and {name} are filled in by `fill`.
import { useState } from 'react'

export const talk = {
  /** Home, while recipes load. */
  loading: [
    'Simmering…',
    'Preheating the oven…',
    'Raiding the pantry…',
    'Sharpening the knives…',
    'Letting the dough rise…',
    'Stirring the pot…',
  ],
  /** Home, when recipes fail to load (a "Try again" button follows). */
  loadError: [
    "Something's burning in the kitchen. We're on it!",
    'A kitchen mishap! Please try again in a moment.',
    'We dropped the spatula. Try again?',
    "The oven's being moody. Give it a sec and try again.",
  ],

  /** Cook mode finish screen. */
  cookDoneTitle: ['Chef’s kiss!', 'Nailed it!', 'Kitchen hero!', 'Order up!', 'Gordon would be proud', 'Five stars from the kitchen'],
  /** Added to cookDoneTitle when we know the cook's nickname. */
  cookDoneTitleNamed: ['Nice work, Chef {name}!', 'Take a bow, Chef {name}!'],
  cookDoneSub: ['Enjoy your {title}.', '{title} is served.', 'Go ahead, lick the spoon.', 'Time to dig in.'],
  /** Cook header once every step is ticked. */
  cookAllDone: 'All done, hit Finish!',

  /** Import progress title. */
  scanTitle: ['Squinting at the handwriting…', 'Reading your card…', 'Studying the recipe card…'],
  scanTitleTwo: ['Reading both sides…', 'Squinting at the handwriting…', 'Studying your recipe cards…'],
  importTitle: ['Prepping your recipe…', 'Chopping up the page…', 'Importing…'],
  /** Import progress checklist: one entry per step, each a bank of variants. */
  scanSteps: [
    ['Deciphering the handwriting', 'Reading the handwriting'],
    ['Measuring out the ingredients', 'Finding the ingredients'],
    ['Writing out the steps'],
    ['Sprinkling on some tags', 'Suggesting tags'],
  ],
  linkSteps: [
    ['Opening the page'],
    ['Scrolling past the life story', 'Dodging the pop-up ads', 'Skipping the life story'],
    ['Gathering the ingredients', 'Finding the ingredients'],
    ['Writing out the steps'],
  ],
  screenshotSteps: [
    ['Reading the screenshot'],
    ['Measuring out the ingredients', 'Finding the ingredients'],
    ['Writing out the steps'],
    ['Sprinkling on some tags', 'Suggesting tags'],
  ],
  /** Import failed (title only; the body says what to do). */
  importFailTitle: ['That one fell flat', 'Kitchen hiccup', 'That didn’t work'],
  /** Scan unreadable (title only; the tips list follows). */
  scanFailTitle: ['We couldn’t read this one', 'Too smudged to read', 'Foggier than a steamy kitchen window'],

  /** Toasts. */
  savedNew: ['Fresh out of the oven!', 'Into the recipe box it goes', 'Plated and saved'],
  savedEdit: ['Seasoned to perfection', 'Tweaks saved', 'Back in the box'],
  deleted: ['86’d!', 'Off the menu', 'Scraped into the bin'],
  /** Save/delete failures (each says to try again). */
  saveError: [
    'The oven door’s stuck, so we couldn’t save that. Try again in a moment.',
    'That one slid off the plate, so we couldn’t save it. Try again in a moment.',
  ],
  deleteError: [
    'That one’s stuck to the pan, so we couldn’t delete it. Try again.',
    'The bin lid’s jammed, so we couldn’t delete it. Try again.',
  ],

  /** Empty states. */
  noMatch: ['No “{q}” in the pantry.', 'We checked every cupboard: no “{q}”.'],
  favoritesEmpty: 'Your favorites shelf is empty. Tap ♥ on a recipe to keep it here.',
  tipsEmpty: 'No tips for “{q}” yet. Try “eggs” or “steak”.',

  /** Little wins. */
  haveEverything: 'Pantry’s stocked! You have everything',
  /** Review banner subline once every AI flag is resolved (headline stays "All checked"). */
  allChecked: 'Mise en place complete. Save whenever you’re ready.',

  /** Login modal header. */
  loginTitle: ['Welcome back to the kitchen!', 'Aprons on!', 'The kitchen’s open'],
}

export function pick<T>(bank: readonly T[], rand: () => number = Math.random): T {
  return bank[Math.floor(rand() * bank.length) % bank.length]
}

/** Replace {title}, {q}, {name}… in a line. */
export function fill(line: string, vars: Record<string, string | number | undefined>): string {
  return line.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
}

/** Pick one line when the component mounts and keep it (no flicker on re-render). */
export function usePick<T>(bank: readonly T[]): T {
  const [line] = useState(() => pick(bank))
  return line
}

/** One variant per step, picked once per mount. */
export function usePickSteps(steps: readonly (readonly string[])[]): string[] {
  const [lines] = useState(() => steps.map(v => pick(v)))
  return lines
}
