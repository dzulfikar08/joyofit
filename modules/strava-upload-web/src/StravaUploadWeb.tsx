import { requireNativeModule, requireNativeView } from 'expo';
import type { Ref } from 'react';
import type { ViewProps } from 'react-native';

/**
 * A web view for strava.com's own upload page (`StravaUploadWebView.kt`, `StravaUploadWebView.swift`). The person does every
 * step on Strava; JoyoFit runs no script in the page and reads nothing from it. The one hook: when the page's file input asks the
 * browser for a file, the request comes out as `onFileRequest` and waits until `answerFileRequest` gives it a file (or null, which
 * cancels it). Android always asks; iOS only from 18.4 (`answersFileRequests`), before that iOS shows its own picker.
 *
 * The page is requested as a desktop site (Strava offers the file upload only there); cookies stay in the web view's own store.
 */

/** The page's `<input type=file>` asked for a file. */
export interface FileRequest {
  requestId: number;
  /** The page that asked (the web view's address). */
  pageUrl: string;
  /** The input's `accept` list (Android); always empty on iOS, whose open panel does not expose it. */
  acceptTypes: string[];
  multiple: boolean;
}

export interface WebNavigation {
  url: string;
  canGoBack: boolean;
  loading: boolean;
}

/** The main page could not load (offline, DNS, TLS). */
export interface WebLoadError {
  url: string;
  description: string;
}

export interface StravaUploadWebRef {
  /** Answers request `requestId` with a file:// URI, or cancels it with null. Every request must be answered once. */
  answerFileRequest(requestId: number, fileUri: string | null): Promise<void>;
  goBack(): Promise<void>;
  reload(): Promise<void>;
}

export interface StravaUploadWebProps extends ViewProps {
  ref?: Ref<StravaUploadWebRef>;
  sourceUrl: string;
  onFileRequest?: (event: { nativeEvent: FileRequest }) => void;
  onNavigation?: (event: { nativeEvent: WebNavigation }) => void;
  onLoadError?: (event: { nativeEvent: WebLoadError }) => void;
}

export const StravaUploadWebView = requireNativeView<StravaUploadWebProps>('StravaUploadWeb');

/** Whether this phone hands file requests to the app: Android always, iOS from 18.4. */
export const answersFileRequests: boolean = requireNativeModule<{ answersFileRequests: boolean }>('StravaUploadWeb').answersFileRequests;
