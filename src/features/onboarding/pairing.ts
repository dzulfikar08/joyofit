import { isLinkUp } from '@/features/device/linkState';
import { canConnect } from '@/features/device/modelSupport';
import { catalogueModelOf } from '@/features/device/watchCatalogue';
import type { BondedDevice, LinkState } from '@/wear';

/**
 * What the setup guide's pairing step shows, as plain functions: the scan cards, the button on each, and when the "confirm on your
 * watch" panel adds its help. The Watch tab's list keeps its own rows; both start from `withActiveWatch`.
 */

/** Seconds of waiting on the watch's accept before the panel says what to check. Huawei Health's own guide took 1 min 44 s once. */
export const CONFIRM_HELP_AFTER_S = 30;

/** The link is being set up: the watch's accept (and on iOS the system pairing) is awaited. The panel covers these states. */
export function isLinkSettingUp(linkState: LinkState): boolean {
  return linkState === 'connecting' || linkState === 'authenticating' || linkState === 'initializing';
}

/** The button on a scan card. `busy`: another watch is being set up, so nothing can start now. */
export type CardAction = 'connect' | 'switch' | 'busy' | 'linked' | 'unsupported';

export function cardAction(device: BondedDevice, linkState: LinkState, activeAddress: string | null): CardAction {
  if (!canConnect(device)) return 'unsupported';
  if (device.address === activeAddress && linkState !== 'disconnected') return isLinkUp(linkState) ? 'linked' : 'busy';
  if (linkState === 'disconnected') return 'connect';
  return linkState === 'connected' ? 'switch' : 'busy';
}

export interface ScanCard {
  device: BondedDevice;
  /** The catalogue model it is, for the title; null when the name is in no list (the card then shows the Bluetooth name). */
  model: string | null;
  /** A model was picked under "Add manually" and this is one. */
  picked: boolean;
}

/**
 * One card per listed watch. With a model picked under "Add manually", the watches of that model come first and are marked, the rest
 * stay below (a codename or an unexpected name must not hide the right watch).
 */
export function scanCards(devices: readonly BondedDevice[], pickedModel: string | null): ScanCard[] {
  const cards = devices.map((device) => {
    const model = catalogueModelOf(device);
    return { device, model, picked: pickedModel !== null && model === pickedModel };
  });
  return pickedModel === null ? cards : [...cards.filter((c) => c.picked), ...cards.filter((c) => !c.picked)];
}
