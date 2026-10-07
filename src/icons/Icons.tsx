import {
  CookingPot, PencilSimpleLine, SignIn, SignOut, Plus, PlusCircle, X, Trash, DownloadSimple,
  MagnifyingGlass, Minus, Heart, BookOpen, Camera, ClipboardText, PencilSimple, CaretLeft, CaretRight,
  Export, Check, Clock, Users, Timer, Sun, Image, Sparkle, WarningCircle, Play, Pause,
  ArrowCounterClockwise, Link, TextAlignLeft, SquaresFour, ListBullets,
} from 'phosphor-react'
import type { IconProps } from 'phosphor-react'
import React from 'react'

export const IconEdit = PencilSimpleLine
export const IconCookMode = CookingPot
export const IconSignIn = SignIn
export const IconSignOut = SignOut
export const IconPlus = Plus
export const IconPlusCircle = PlusCircle
export const IconClose = X
export const IconDelete = Trash
export const IconImport = DownloadSimple

const ICONS = {
  search: MagnifyingGlass,
  plus: Plus,
  minus: Minus,
  heart: Heart,
  book: BookOpen,
  camera: Camera,
  paste: ClipboardText,
  pencil: PencilSimple,
  close: X,
  back: CaretLeft,
  chev: CaretRight,
  share: Export,
  check: Check,
  clock: Clock,
  people: Users,
  timer: Timer,
  sun: Sun,
  photo: Image,
  spark: Sparkle,
  alert: WarningCircle,
  play: Play,
  pause: Pause,
  reset: ArrowCounterClockwise,
  link: Link,
  text: TextAlignLeft,
  trash: Trash,
  signin: SignIn,
  signout: SignOut,
  grid: SquaresFour,
  list: ListBullets,
} as const

export type IconName = keyof typeof ICONS

/** Named icon from the app's phosphor set. `filled` switches to the fill weight (e.g. favorited hearts). */
export function Icon({ name, size = 22, filled, weight, ...rest }: { name: IconName; size?: number; filled?: boolean } & Omit<IconProps, 'size'>) {
  const C = ICONS[name]
  return <C size={size} weight={filled ? 'fill' : weight ?? 'regular'} aria-hidden style={{ flex: 'none' }} {...rest} />
}

export default { IconEdit, IconCookMode, IconSignIn, IconSignOut, IconPlus, IconPlusCircle, IconClose, IconDelete, IconImport }
