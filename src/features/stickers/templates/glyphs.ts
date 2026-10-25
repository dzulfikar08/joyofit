/**
 * Pictograms of the sport families the shared core has no icon for, drawn as `shape: path` layers (24 x 24 viewBox). Material
 * Design Icons (Pictogrammers, Apache-2.0, https://pictogrammers.com/library/mdi/, @mdi/svg 7.4.47), the set the core's sport
 * icons and the app's `SportIcon` come from: `run-fast` (cardio), `yoga` (flow), `whistle` (court: the referee's whistle reads
 * for football, basketball and badminton alike, a racket would not).
 */
export const FAMILY_GLYPHS = {
  cardio:
    'M16.5,5.5A2,2 0 0,0 18.5,3.5A2,2 0 0,0 16.5,1.5A2,2 0 0,0 14.5,3.5A2,2 0 0,0 16.5,5.5M12.9,19.4L13.9,15L16,17V23H18V15.5L15.9,13.5L16.5,10.5C17.89,12.09 19.89,13 22,13V11C20.24,11.03 18.6,10.11 17.7,8.6L16.7,7C16.34,6.4 15.7,6 15,6C14.7,6 14.5,6.1 14.2,6.1L9,8.3V13H11V9.6L12.8,8.9L11.2,17L6.3,16L5.9,18L12.9,19.4M4,9A1,1 0 0,1 3,8A1,1 0 0,1 4,7H7V9H4M5,5A1,1 0 0,1 4,4A1,1 0 0,1 5,3H10V5H5M3,13A1,1 0 0,1 2,12A1,1 0 0,1 3,11H7V13H3Z',
  flow: 'M13 2C11.9 2 11 2.9 11 4C11 5.11 11.9 6 13 6C14.11 6 15 5.11 15 4C15 2.9 14.11 2 13 2M4 7V9H10V15L4.93 20.07L6.34 21.5L13.06 14.77L17 17.13V21H19V16.57C19 16.21 18.82 15.89 18.5 15.71L15 13.6V9H21V7H4Z',
  court:
    'M8.5,9A6.5,6.5 0 0,0 2,15.5A6.5,6.5 0 0,0 8.5,22A6.5,6.5 0 0,0 15,15.5V13.91L22,12V9H11V11H9V9H8.5M11,2V7H9V2H11M6.35,7.28C5.68,7.44 5.04,7.68 4.43,8L2.14,4.88L3.76,3.7L6.35,7.28M17.86,4.88L16.32,7H13.85L16.24,3.7L17.86,4.88Z',
} as const;

export type FamilyGlyph = keyof typeof FAMILY_GLYPHS;
