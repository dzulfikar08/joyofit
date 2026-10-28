import { isIos } from '@/components/IosUnavailable';

import { withoutBrand } from './watchName';

/** A watch, band or scale name as the screens show it: the iPhone app carries no maker's brand (see `withoutBrand`); Android shows it whole. */
export function shownName(name: string): string;
export function shownName(name: string | null | undefined): string | null;
export function shownName(name: string | null | undefined): string | null {
  if (name == null) return null;
  return isIos ? withoutBrand(name) : name;
}
