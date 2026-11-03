/**
 * Sharing a finished replay MP4 through the same paths as a sticker image: the "Lanjut" Photos pre-prompt on iOS (Android
 * 11+ needs no permission), Instagram's Story composer when the Facebook App ID is set (else the Instagram share target), and
 * the system share sheet.
 */
import * as MediaLibrary from 'expo-media-library';
import Share, { Social } from 'react-native-share';

import { FACEBOOK_APP_ID, OS, ensurePhotosAccess, isShareCancel, type PhotosPrompt } from '@/features/stickers/share/shareImage';
import { instagramRoute, type InstagramRoute } from '@/features/stickers/share/shareTargets';

const VIDEO_TYPE = 'video/mp4';

/** Adds the MP4 to the photo library. */
export async function saveVideo(fileUri: string, prompt: PhotosPrompt): Promise<void> {
  await ensurePhotosAccess('save', prompt);
  await MediaLibrary.Asset.create(fileUri);
}

/** Opens the system share sheet with the MP4; resolves quietly when the person closes it. */
export async function shareVideoFile(fileUri: string, caption: string): Promise<void> {
  try {
    await Share.open({ url: fileUri, type: VIDEO_TYPE, message: caption, failOnCancel: false });
  } catch (error) {
    if (!isShareCancel(error)) throw error;
  }
}

/**
 * Instagram button. With a Facebook App ID the Story composer opens with the video as its background; without one the MP4 goes
 * to the Instagram app's own share target, where the person picks Story, Reel or post. Returns the route taken.
 */
export async function shareVideoToInstagram(fileUri: string, caption: string, prompt: PhotosPrompt): Promise<InstagramRoute> {
  const route = instagramRoute(FACEBOOK_APP_ID, OS, false);
  try {
    if (route === 'stories' && FACEBOOK_APP_ID) {
      await Share.shareSingle({ social: Social.InstagramStories, appId: FACEBOOK_APP_ID, backgroundVideo: fileUri });
    } else if (route === 'instagram') {
      if (OS === 'ios') await ensurePhotosAccess('instagram', prompt);
      await Share.shareSingle({ social: Social.Instagram, url: fileUri, type: VIDEO_TYPE });
    } else {
      await shareVideoFile(fileUri, caption);
    }
  } catch (error) {
    if (!isShareCancel(error)) throw error;
  }
  return route;
}
