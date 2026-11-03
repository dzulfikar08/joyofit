import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import { Linking } from 'react-native';
import Share from 'react-native-share';

import { OS, ensurePhotosAccess, isShareCancel, type PhotosPrompt } from './shareImage';
import { THREADS_PACKAGE, threadsComposerUrl } from './shareThreadsUrl';

export { threadsComposerUrl } from './shareThreadsUrl';

/**
 * Whether the Threads app is on the phone: `true` or `false` on Android (package manager), `null` when it cannot be told.
 * iOS cannot ask: `canOpenURL('threads://')` answers `false` for every scheme not listed in `LSApplicationQueriesSchemes`, and the
 * react-native-share plugin entry of `app.json` lists only Instagram's. Android 11+ hides packages the manifest `<queries>` does
 * not name, so the answer is only as good as that list.
 */
export async function threadsInstalled(): Promise<boolean | null> {
  if (OS === 'ios') return null;
  try {
    return (await Share.isPackageInstalled(THREADS_PACKAGE)).isInstalled;
  } catch {
    return null;
  }
}

/**
 * Opens the system share sheet with every PNG. The caption is NOT sent along: Threads takes the images from a share with
 * images and drops the text (EXTRA_TEXT on Android, the text item on iOS), so passing it would only look like it works. It goes
 * to the clipboard first and the person pastes it in the Threads composer. Resolves quietly when the person closes the sheet.
 */
export async function shareThreadsCarousel(fileUris: readonly string[], caption: string): Promise<void> {
  await Clipboard.setStringAsync(caption);
  try {
    await Share.open({ urls: [...fileUris], type: 'image/png', failOnCancel: false });
  } catch (error) {
    if (!isShareCancel(error)) throw error;
  }
}

/**
 * The route that works everywhere: every PNG goes to the photo library, the caption to the clipboard, and the Threads composer
 * opens with the text filled in; the person taps its photo button and picks the saved images. Throws `PhotosDeniedError` when
 * Photos access is refused.
 */
export async function saveAllAndOpenThreads(fileUris: readonly string[], caption: string, prompt: PhotosPrompt): Promise<void> {
  await ensurePhotosAccess('save', prompt);
  for (const uri of fileUris) await MediaLibrary.Asset.create(uri);
  await Clipboard.setStringAsync(caption);
  await Linking.openURL(threadsComposerUrl(caption));
}
