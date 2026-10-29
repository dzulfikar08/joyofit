import * as DocumentPicker from 'expo-document-picker';
import { AppState } from 'react-native';

/** Long enough for Android to put the picker on screen after a tap. */
const OPENING_MS = 2000;

let inFlight: { promise: Promise<DocumentPicker.DocumentPickerResult>; startedAt: number; leftApp: boolean } | null = null;

AppState.addEventListener('change', (state) => {
  if (inFlight && state !== 'active') inFlight.leftApp = true;
});

/**
 * The system file picker. A call made while the picker is still opening (a double tap, two buttons) shares that pick.
 * Once the picker has been on screen and the person is back in the app, or it never opened, a pending pick has lost
 * its result: the new call starts a fresh one, and the patched native module settles the old one as cancelled
 * (patches/expo-document-picker@*.patch).
 */
export function getDocumentAsync(options: DocumentPicker.DocumentPickerOptions): Promise<DocumentPicker.DocumentPickerResult> {
  if (inFlight && !inFlight.leftApp && Date.now() - inFlight.startedAt < OPENING_MS) return inFlight.promise;
  const pick = {
    promise: DocumentPicker.getDocumentAsync(options).finally(() => {
      if (inFlight === pick) inFlight = null;
    }),
    startedAt: Date.now(),
    leftApp: false,
  };
  inFlight = pick;
  return pick.promise;
}
