import { fitFileName } from '@/features/strava/activityFile';

/**
 * Manual Strava upload: the person puts a workout on Strava on strava.com's own upload page, in a web view inside the app, without
 * the Strava API connection (the shared API application has room for a limited number of athletes until Strava approves it). It
 * is the upload a person does on a computer, with one difference: when the page's "Choose files" asks the browser for a file, the
 * app answers with this workout's FIT file instead of opening a picker. Strava's terms forbid automated access (scripts, robots,
 * browser extensions), so the app runs no script in the page, presses nothing and reads nothing from it; every Strava step is the
 * person's own tap. Whether it worked is what the person says ("Already uploaded"), stored on the phone only. Reasoning:
 * docs/strava.md section 7.
 */

/** Strava's own page for uploading a file by hand. Neither the Strava nor the Garmin Connect app takes a file from the share sheet. */
export const STRAVA_UPLOAD_URL = 'https://www.strava.com/upload/select';

/** The FIT file as it goes to Strava's page: the bytes the API upload sends, under the name the API upload gives it. */
export function manualUploadFile(workoutStart: number, bytes: Uint8Array): { name: string; bytes: Uint8Array } {
  return { name: fitFileName(workoutStart), bytes };
}

/** What the page asked for: where it is and what its file input accepts (empty when the input says nothing, and always on iOS). */
export interface PageFileRequest {
  pageUrl: string;
  acceptTypes: readonly string[];
}

/** strava.com's upload pages (`/upload/select`, and whatever else Strava puts under `/upload`), over https only. */
const UPLOAD_PAGE = /^https:\/\/(?:www\.)?strava\.com\/upload(?:[/?#]|$)/i;

/** A picker for photos, video or sound (a profile picture, a post) cannot take a .fit file. */
const MEDIA_ONLY = /^(?:image|video|audio)\//;

/**
 * Whether a file request gets the workout's file: only a file input on Strava's upload page, and only one that does not take media
 * only. Any other request (another site after a link, a photo picker) is cancelled: this screen offers no other upload.
 */
export function takesWorkoutFile(request: PageFileRequest): boolean {
  if (!UPLOAD_PAGE.test(request.pageUrl)) return false;
  const types = request.acceptTypes
    .flatMap((type) => type.split(','))
    .map((type) => type.trim().toLowerCase())
    .filter((type) => type.length > 0);
  return types.length === 0 || !types.every((type) => MEDIA_ONLY.test(type));
}

/** The workout's FIT file, as far as the screen got with it. */
export type ManualFile = { status: 'building' } | { status: 'ready'; uri: string; name: string } | { status: 'failed'; error: string };

/** How a file request is answered: with the file, cancelled, or held until the file is written (the page was faster). */
export type FileRequestAnswer = { kind: 'file'; uri: string } | { kind: 'cancel' } | { kind: 'wait' };

export function answerFileRequest(file: ManualFile, request: PageFileRequest): FileRequestAnswer {
  if (!takesWorkoutFile(request)) return { kind: 'cancel' };
  if (file.status === 'building') return { kind: 'wait' };
  if (file.status === 'failed') return { kind: 'cancel' };
  return { kind: 'file', uri: file.uri };
}

/** The upload screen's state. `handedOver` counts the file requests answered with the file during this visit. */
export interface ManualUploadState {
  file: ManualFile;
  handedOver: number;
  /** Unix seconds the person marked the workout as uploaded; null when not marked. */
  markedAt: number | null;
}

export type ManualUploadEvent =
  | { type: 'fileReady'; uri: string; name: string }
  | { type: 'fileFailed'; error: string }
  | { type: 'handedOver' }
  | { type: 'markLoaded'; markedAt: number | null }
  | { type: 'marked'; at: number }
  | { type: 'unmarked' };

export const initialManualUpload: ManualUploadState = { file: { status: 'building' }, handedOver: 0, markedAt: null };

export function manualUploadReducer(state: ManualUploadState, event: ManualUploadEvent): ManualUploadState {
  switch (event.type) {
    case 'fileReady':
      return { ...state, file: { status: 'ready', uri: event.uri, name: event.name } };
    case 'fileFailed':
      return { ...state, file: { status: 'failed', error: event.error } };
    case 'handedOver':
      // Only a written file can be handed over.
      return state.file.status === 'ready' ? { ...state, handedOver: state.handedOver + 1 } : state;
    case 'markLoaded':
      return { ...state, markedAt: event.markedAt };
    case 'marked':
      return { ...state, markedAt: event.at };
    case 'unmarked':
      return { ...state, markedAt: null };
  }
}
