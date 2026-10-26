import { OfflineMapLabScreen } from '@/features/offlinemaps/OfflineMapLabScreen';

/** The lab draws its own virtualised list (hundreds of maps), so no `Screen` scroll view around it. */
export default function OfflineMapsSettingsScreen() {
  return <OfflineMapLabScreen />;
}
